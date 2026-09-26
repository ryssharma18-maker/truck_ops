import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createCheckoutSession, findPlan, StripeError } from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: z.enum(["lite", "pro", "enterprise"]),
  truckCount: z.coerce.number().int().min(1).max(10_000).default(1),
});

/**
 * Creates a Stripe Checkout session and returns its URL.
 *
 * Scoped to the caller's own account: the customer, quantity and client
 * reference all come from the session, never the request body, so one tenant
 * cannot start a checkout against another's Stripe customer.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();

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

  // Current fleet size is the sensible default and the honest starting point
  // for a metered per-truck charge.
  const fleetSize = await prisma.truck.count({ where: { userId: user.id } });
  const truckCount = parsed.truckCount || fleetSize || 1;

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
