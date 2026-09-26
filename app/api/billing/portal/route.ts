import { NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createPortalSession, StripeError } from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

/**
 * Returns a Stripe billing portal URL so a customer can change plan, update
 * card, or cancel without support.
 *
 * Requires an existing Stripe customer. Returns a clear 409 rather than a
 * generic failure for an account that has never checked out.
 */
export const POST = handle(async (_req: NextRequest) => {
  const user = await requireUser();

  if (!user.stripeCustomerId) {
    return fail(
      "No billing account yet. Choose a plan to start a subscription first.",
      409,
      "no_stripe_customer",
    );
  }

  try {
    const session = await createPortalSession({
      stripeCustomerId: user.stripeCustomerId,
    });
    return ok({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError) {
      return fail(err.message, err.status >= 500 ? 502 : err.status, "stripe_error");
    }
    if (err instanceof Error && /not configured/.test(err.message)) {
      return fail(err.message, 503, "billing_not_configured");
    }
    throw err;
  }
});
