import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { handle, ok, fail } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  mapSubscriptionStatus,
  verifyStripeSignature,
  type StripeEvent,
  type StripeSubscription,
  type Plan,
} from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/stripe
 *
 * The only place a Stripe event turns into local state. Authenticated by
 * `Stripe-Signature`, not by session — see `verifyStripeSignature`.
 *
 * Fails closed: with no webhook secret configured the endpoint returns 503 and
 * changes nothing, rather than accepting unsigned events. A forged
 * `customer.subscription.updated` would otherwise hand an attacker a paid plan.
 *
 * The user is resolved from `metadata.userId`, which was set when the Checkout
 * session was created. It is never taken from the event's email address, and
 * the metadata is only trusted after the signature check has passed.
 */

/** Events that change what the account may do. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
]);

/** Stripe retries anything that is not a 2xx. */

/**
 * Records the subscription and links the Stripe customer to the account.
 *
 * Idempotent: Stripe redelivers until it sees a 2xx, and `stripeSubscriptionId`
 * is unique, so an update is an upsert rather than an insert.
 */
async function syncSubscription(
  userId: string,
  sub: StripeSubscription,
  planHint: string | undefined,
): Promise<void> {
  const status = mapSubscriptionStatus(sub.status);

  // The subscription's own metadata is authoritative; the Checkout session's is
  // the fallback for the first event, which may not carry it.
  const plan =
    (sub.metadata?.plan as Plan | undefined) ??
    (planHint as Plan | undefined) ??
    "lite";

  const quantity = sub.items?.data?.[0]?.quantity ?? null;
  const truckCount = sub.metadata?.truckCount
    ? Number.parseInt(sub.metadata.truckCount, 10)
    : (quantity ?? 1);

  const monthlyAmount = sub.items?.data?.[0]?.price?.unit_amount ?? 0;

  const periodStart = sub.current_period_start
    ? new Date(sub.current_period_start * 1000)
    : new Date();
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      create: {
        userId,
        stripeSubscriptionId: sub.id,
        plan,
        truckCount: Number.isFinite(truckCount) && truckCount > 0 ? truckCount : 1,
        monthlyAmount: new Prisma.Decimal(
          ((monthlyAmount ?? 0) * Math.max(truckCount ?? 1, 1)) / 100,
        ),
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
      update: {
        plan,
        truckCount: Number.isFinite(truckCount) && truckCount > 0 ? truckCount : 1,
        monthlyAmount: new Prisma.Decimal(
          ((monthlyAmount ?? 0) * Math.max(truckCount ?? 1, 1)) / 100,
        ),
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        stripeCustomerId: sub.customer ?? undefined,
        subscriptionPlan: plan,
      },
    });
  });
}

export const POST = handle(async (req: NextRequest) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secret || secret.startsWith("whsec_placeholder") || secret.length < 16) {
    return fail(
      "STRIPE_WEBHOOK_SECRET is not configured, so the webhook cannot verify " +
        "signatures and is refusing to process events.",
      503,
      "webhook_not_configured",
    );
  }

  // The signature covers the exact bytes, so read the raw body. Parsing first
  // and re-serialising would change whitespace and fail verification.
  const rawBody = await req.text();

  const verdict = verifyStripeSignature({
    header: req.headers.get("stripe-signature"),
    rawBody,
    secret,
  });

  if (!verdict.ok) {
    console.warn("[stripe] rejected event:", verdict.reason);
    // 400, not 401/403: Stripe treats 4xx other than 400/409 as retryable and
    // would hammer a route that will never accept the event.
    return fail(`Invalid signature: ${verdict.reason}`, 400, "invalid_signature");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return fail("Body is not valid JSON", 400, "invalid_payload");
  }

  if (!HANDLED.has(event.type)) {
    return ok({ received: true, ignored: true, type: event.type });
  }

  const object = event.data.object as Record<string, unknown>;

  // checkout.session.completed carries a session, not a subscription.
  let subscription: StripeSubscription | undefined;
  let planHint: string | undefined;

  if (event.type === "checkout.session.completed") {
    planHint = (object.client_reference_id as string | undefined) ?? undefined;
    const subId =
      (object.subscription as string | undefined) ??
      (typeof object.subscription === "object" && object.subscription
        ? (object.subscription as { id?: string }).id
        : undefined);

    if (!subId) {
      // Subscription-mode sessions always have one; a missing value means the
      // event shape changed, so ask Stripe to retry rather than half-applying.
      return fail("Checkout session has no subscription", 409, "missing_subscription");
    }
    planHint = (object.metadata as Record<string, string> | undefined)?.plan ?? planHint;
    subscription = { id: subId, customer: (object.customer as string) ?? "", status: "active" };
  } else {
    subscription = object as unknown as StripeSubscription;
  }

  // Prefer the subscription's metadata userId, then the session's
  // client_reference_id, then the event's own metadata.
  const userId =
    subscription.metadata?.userId ??
    planHint ??
    (event as unknown as { metadata?: Record<string, string> }).metadata?.userId;

  if (!userId) {
    // Without an owner we cannot apply the change. Refusing is the safe
    // outcome; a retry cannot fix it, so 400.
    return fail("Event has no userId metadata", 400, "missing_user_id");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return fail(`No account for user ${userId}`, 400, "unknown_user");
  }

  if (event.type === "customer.subscription.deleted") {
    await prisma.$transaction([
      prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscription.id, userId: user.id },
        data: { status: "canceled" },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { subscriptionPlan: "trial" },
      }),
    ]);
    return ok({ received: true, type: event.type, action: "canceled" });
  }

  // For checkout.session.completed the object is the session, which has no
  // period fields; the subscription details arrive on the
  // customer.subscription.* event that follows.
  if (event.type === "checkout.session.completed") {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeCustomerId: (object.customer as string | undefined) ?? user.stripeCustomerId,
      },
    });
    return ok({ received: true, type: event.type, action: "customer_linked" });
  }

  await syncSubscription(user.id, subscription, planHint);

  return ok({ received: true, type: event.type, action: "synced" });
});

/** Stripe only ever calls POST; a GET should not look like a healthy webhook. */
export const GET = handle(async () =>
  fail("Stripe webhooks are POST-only", 405, "method_not_allowed"),
);
