import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createCheckoutSession, findPlan, StripeError } from "@/lib/services/stripeService";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * `truckCount` is deliberately NOT in this schema.
 *
 * It used to be, and the client sent a hardcoded 1 from the pricing page, which
 * made the `|| fleetSize` fallback below unreachable and the fleet query
 * pointless: a 12-truck fleet was quoted and invoiced for one truck. The billed
 * quantity is now derived from the caller's own trucks and cannot be supplied
 * by the caller, so it is not part of the request contract at all.
 */
const bodySchema = z.object({
  plan: z.enum(["lite", "pro", "enterprise"]),
});

/**
 * Creates a Stripe Checkout session and returns its URL.
 *
 * Scoped to the caller's own account: the customer, quantity and client
 * reference all come from the session and the database, never the request body,
 * so one tenant cannot start a checkout against another's Stripe customer.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  // Each call creates a real Checkout Session in the Stripe account.
  await enforceRateLimit("billingCheckout", user.id);

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    return fail(
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : "Invalid request body",
      422,
      "validation_error",
    );
  }

  const spec = findPlan(parsed.plan);
  if (!spec) return fail(`Unknown plan "${parsed.plan}"`, 400, "unknown_plan");

  // What the customer will actually be billed for, per truck, is the number of
  // trucks they have. A brand-new account with none still has to be able to
  // subscribe, so that floors at 1 rather than failing.
  const fleetSize = await prisma.truck.count({ where: { userId: user.id } });
  const truckCount = Math.max(1, fleetSize);

  if (spec.maxTrucks !== null && truckCount > spec.maxTrucks) {
    return fail(
      `${spec.label} covers up to ${spec.maxTrucks} trucks. You have ${truckCount}.`,
      400,
      "plan_too_small",
    );
  }

  try {
    const session = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      plan: parsed.plan,
      truckCount,
      stripeCustomerId: user.stripeCustomerId,
    });
    return ok({ url: session.url, truckCount, plan: parsed.plan });
  } catch (err) {
    if (err instanceof StripeError) {
      return fail(err.message, err.status >= 500 ? 502 : err.status, "stripe_error");
    }
    // A missing key is a configuration problem, not a client error.
    if (err instanceof Error && /not configured/.test(err.message)) {
      return fail(err.message, 503, "billing_not_configured");
    }
    throw err;
  }
});
