import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { handle, ok, fail } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { readRawBody } from "@/lib/services/webhookAuth";
import {
  mapSubscriptionStatus,
  verifyStripeSignature,
  type StripeEvent,
  type StripeSubscription,
  type Plan,
  stripeEventDisposition,
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

class DuplicateStripeEventError extends Error {}

/** Stripe retries anything that is not a 2xx. */

/**
 * Records the subscription and links the Stripe customer to the account.
 *
 * Idempotent: Stripe redelivers until it sees a 2xx, and `stripeSubscriptionId`
 * is unique, so an update is an upsert rather than an insert.
 */
async function syncSubscription(
  tx: Prisma.TransactionClient,
  userId: string,
  sub: StripeSubscription,
  planHint: string | undefined,
  eventCreated: number,
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
      lastStripeSubscriptionEventCreated: eventCreated,
    },
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
  // readRawBody caps the size: this route is unauthenticated, so the read is
  // the only thing standing between an anonymous caller and a big allocation.
  const rawBody = await readRawBody(req, 1024 * 1024);

  const verdict = verifyStripeSignature({
    header: req.headers.get("stripe-signature"),
    rawBody,
    secret,
  });

  if (!verdict.ok) {
    console.warn("[stripe] rejected event:", verdict.reason);
    // 400, not 401/403: Stripe treats 4xx other than 400/409 as retryable and
    // would hammer a route that will never accept the event.
    //
    // The verdict reason is logged but NOT returned. This route is
    // unauthenticated, so the body is read by whoever is calling. One of the
    // reasons is "no webhook secret configured", which would tell a prober the
    // deployment is misconfigured; the rest are a free map of the verifier's
    // internals. Stripe only needs to see that the event was rejected.
    return fail("Invalid signature", 400, "invalid_signature");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as StripeEvent;
  } catch {
    return fail("Body is not valid JSON", 400, "invalid_payload");
  }

  if (typeof event.id !== "string" || event.id.length === 0) {
    // Without an id there is nothing to deduplicate on, and Stripe does not
    // guarantee a retry for a 400, so a duplicate delivery would be applied
    // twice with no way to tell. Refuse it.
    return fail("Event has no id", 400, "invalid_payload");
  }
  if (!Number.isSafeInteger(event.created) || event.created <= 0) {
    return fail("Event has no valid creation time", 400, "invalid_payload");
  }

  if (!HANDLED.has(event.type)) {
    try {
      await prisma.stripeEvent.create({
        data: { id: event.id, type: event.type, userId: null, ignored: true },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return ok({ received: true, type: event.type, action: "already_processed" });
      }
      throw err;
    }
    return ok({ received: true, ignored: true, type: event.type });
  }

  const object = event.data.object as Record<string, unknown>;

  // checkout.session.completed carries a session, not a subscription.
  let subscription: StripeSubscription | undefined;
  // The account id and the plan are both "hints" that arrive on different event
  // shapes, and they are different values. Sharing one variable meant the plan
  // overwrote the user id, and the lookup below then failed on a non-UUID.
  let userIdHint: string | undefined;
  let planHint: string | undefined;

  const meta = (object.metadata ?? {}) as Record<string, string>;

  if (event.type === "checkout.session.completed") {
    // Prefer metadata.userId (set by the Checkout session), then the
    // client_reference_id we also stamped. Never the customer's email.
    userIdHint = meta.userId ?? (object.client_reference_id as string | undefined);
    planHint = meta.plan;

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
    subscription = { id: subId, customer: (object.customer as string) ?? "", status: "active" };
  } else {
    subscription = object as unknown as StripeSubscription;
    userIdHint = subscription.metadata?.userId;
    planHint = subscription.metadata?.plan;
  }

  const userId = userIdHint ?? (event as unknown as { metadata?: Record<string, string> }).metadata?.userId;

  if (!userId) {
    // Without an owner we cannot apply the change. Refusing is the safe
    // outcome; a retry cannot fix it, so 400.
    return fail("Event has no userId metadata", 400, "missing_user_id");
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    // A non-UUID here means a field we treat as an account id actually held
    // something else. 400 rather than 500: a retry will not fix bad data, and
    // letting Prisma throw makes Stripe redeliver forever.
    return fail("Event userId is not a valid account id", 400, "invalid_user_id");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return fail(`No account for user ${userId}`, 400, "unknown_user");
  }

  let action = "synced";
  try {
    await prisma.$transaction(async (tx) => {
      // Serialize all billing-state updates for this account. The event claim,
      // timestamp check, state change, and ledger entry commit together.
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE
      `);

      const previouslySeen = await tx.stripeEvent.findUnique({
        where: { id: event.id },
        select: { id: true },
      });
      const lockedUser = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          stripeCustomerId: true,
          lastStripeSubscriptionEventCreated: true,
        },
      });
      if (!lockedUser) {
        throw new Error("Stripe event account disappeared during processing");
      }

      const disposition = stripeEventDisposition({
        eventId: event.id,
        recordedEventId: previouslySeen?.id,
        eventCreated: event.created,
        lastAppliedCreated: Number(lockedUser.lastStripeSubscriptionEventCreated),
      });
      if (disposition === "duplicate") {
        action = "already_processed";
        return;
      }

      if (event.type.startsWith("customer.subscription.")) {
        if (disposition === "stale") {
          action = "stale_event";
          await createStripeEvent(tx, event.id, event.type, user.id);
          return;
        }
      }

      if (event.type === "customer.subscription.deleted") {
        await tx.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id, userId: user.id },
          data: { status: "canceled" },
        });
        await tx.user.update({
          where: { id: user.id },
          data: {
            subscriptionPlan: "trial",
            lastStripeSubscriptionEventCreated: event.created,
          },
        });
        action = "canceled";
      } else if (event.type === "checkout.session.completed") {
        await tx.user.update({
          where: { id: user.id },
          data: {
            stripeCustomerId:
              (object.customer as string | undefined) ?? lockedUser.stripeCustomerId,
          },
        });
        action = "customer_linked";
      } else {
        await syncSubscription(tx, user.id, subscription, planHint, event.created);
      }

      await createStripeEvent(tx, event.id, event.type, user.id);
    });
  } catch (err) {
    if (err instanceof DuplicateStripeEventError) {
      return ok({ received: true, type: event.type, action: "already_processed" });
    }
    throw err;
  }

  return ok({ received: true, type: event.type, action });
});

async function createStripeEvent(
  tx: Prisma.TransactionClient,
  id: string,
  type: string,
  userId: string,
): Promise<void> {
  try {
    await tx.stripeEvent.create({ data: { id, type, userId } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateStripeEventError();
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/** Stripe only ever calls POST; a GET should not look like a healthy webhook. */
export const GET = handle(async () =>
  fail("Stripe webhooks are POST-only", 405, "method_not_allowed"),
);
