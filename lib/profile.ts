/**
 * The carrier profile fields this endpoint is allowed to expose.
 *
 * An allowlist, not "serialize the row". The `User` model also carries
 * `stripeCustomerId` and `inboxEmail`, and `serialize()` is a blanket JSON-safe
 * conversion rather than a filter — passing the row straight through published
 * the Stripe customer id (a handle on the tenant's billing account) and the
 * inbound mailbox address to any authenticated client. Adding a sensitive column
 * to the model would have silently widened the response, which is why the shape
 * is pinned by a test in scripts/verify-workflow.ts.
 *
 * Lives in lib/ rather than in the route so the test can assert on the real
 * returned keys instead of grepping source text.
 */
export interface ProfileUser {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  phone: string | null;
  dotNumber: string | null;
  mcNumber: string | null;
  subscriptionPlan: string;
  truckCount: number;
  inboxEmail: string;
  stripeCustomerId: string | null;
}

export interface PublicProfile {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  phone: string | null;
  dotNumber: string | null;
  mcNumber: string | null;
  subscriptionPlan: string;
  truckCount: number;
  inboxEmail: string;
  /**
   * A boolean, because the settings page only needs to know whether to offer the
   * billing portal — it never needs the Stripe id itself.
   */
  hasBillingAccount: boolean;
}

export function publicProfile(user: ProfileUser): PublicProfile {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    companyName: user.companyName,
    phone: user.phone,
    dotNumber: user.dotNumber,
    mcNumber: user.mcNumber,
    subscriptionPlan: user.subscriptionPlan,
    truckCount: user.truckCount,
    inboxEmail: user.inboxEmail,
    hasBillingAccount: Boolean(user.stripeCustomerId),
  };
}
