import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

/**
 * Stripe integration over the REST API.
 *
 * No `stripe` npm package: two endpoints and a webhook do not justify the
 * dependency, and the signature check is the only part that must be exact, so
 * that is implemented and tested explicitly below rather than abstracted away.
 *
 * Amounts are integer cents everywhere. `Decimal` never touches a Stripe
 * amount — see AGENTS.md.
 */

const API = "https://api.stripe.com/v1";

export type Plan = "trial" | "lite" | "pro" | "enterprise";

export interface PlanSpec {
  plan: Exclude<Plan, "trial">;
  label: string;
  /** Cents per truck per month. */
  unitAmount: number;
  currency: string;
  priceIdEnv: string;
  maxTrucks: number | null;
}

/**
 * Price IDs are per-account configuration, never hardcoded: a test-mode and a
 * live-mode price are different objects, and mixing them silently charges the
 * wrong amount or fails at checkout.
 */
export const PLANS: PlanSpec[] = [
  { plan: "lite", label: "Lite", unitAmount: 15000, currency: "usd", priceIdEnv: "STRIPE_PRICE_LITE", maxTrucks: 5 },
  { plan: "pro", label: "Pro", unitAmount: 29900, currency: "usd", priceIdEnv: "STRIPE_PRICE_PRO", maxTrucks: 20 },
  { plan: "enterprise", label: "Enterprise", unitAmount: 49900, currency: "usd", priceIdEnv: "STRIPE_PRICE_ENTERPRISE", maxTrucks: null },
];

export function findPlan(plan: string): PlanSpec | undefined {
  return PLANS.find((p) => p.plan === plan);
}

// ─── REST helper ──────────────────────────────────────────────────────────────

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

async function stripe<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = requireEnv("STRIPE_SECRET_KEY", "Stripe billing");

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const err = json.error as { message?: string; type?: string } | undefined;
    throw new StripeError(
      err?.message ?? `Stripe returned ${res.status}`,
      res.status,
      err?.type,
    );
  }

  return json as T;
}

function appUrl(): string {
  return requireEnv("NEXT_PUBLIC_APP_URL", "Stripe redirect URLs");
}

// ─── Public operations ─────────────────────────────────────────────────────────

export interface CheckoutSession {
  id: string;
  url: string;
}

/**
 * Creates a Checkout session for a plan. `truckCount` drives the quantity so
 * the customer is charged per truck, which is how the pricing page quotes.
 */
export async function createCheckoutSession(opts: {
  userId: string;
  email: string;
  plan: Exclude<Plan, "trial">;
  truckCount: number;
  stripeCustomerId?: string | null;
  trialDays?: number;
}): Promise<CheckoutSession> {
  const spec = findPlan(opts.plan);
  if (!spec) throw new StripeError(`Unknown plan "${opts.plan}"`, 400);

  if (spec.maxTrucks !== null && opts.truckCount > spec.maxTrucks) {
    throw new StripeError(
      `${spec.label} covers up to ${spec.maxTrucks} trucks; ${opts.truckCount} were requested.`,
      400,
    );
  }
  if (opts.truckCount < 1) {
    throw new StripeError("At least one truck is required.", 400);
  }

  const priceId = requireEnv(spec.priceIdEnv, `Stripe billing for the ${spec.label} plan`);

  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": String(opts.truckCount),
    success_url: `${appUrl()}/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/pricing?billing=cancelled`,
    client_reference_id: opts.userId,
    // Echoed back on the webhook so the subscription row can be tied to the
    // account without trusting the email.
    "metadata[userId]": opts.userId,
    "metadata[plan]": opts.plan,
    "metadata[truckCount]": String(opts.truckCount),
    "subscription_data[metadata][userId]": opts.userId,
    "subscription_data[metadata][plan]": opts.plan,
    "subscription_data[metadata][truckCount]": String(opts.truckCount),
  };

  if (opts.stripeCustomerId) {
    // Stripe rejects a session that carries both `customer` and
    // `customer_email`, so the id wins when we already have one. The email is
    // still recorded above in metadata for the webhook to cross-check.
    params.customer = opts.stripeCustomerId;
  } else {
    params.customer_email = opts.email;
  }

  if (opts.trialDays && opts.trialDays > 0) {
    params["subscription_data[trial_period_days]"] = String(opts.trialDays);
  }

  const session = await stripe<CheckoutSession>("/checkout/sessions", params);
  if (!session.url) {
    throw new StripeError("Stripe did not return a checkout URL", 502);
  }
  return session;
}

/** Billing portal session, so a customer can change or cancel their plan. */
export async function createPortalSession(opts: {
  stripeCustomerId: string;
  returnUrl?: string;
}): Promise<{ url: string }> {
  const session = await stripe<{ url: string }>("/billing_portal/sessions", {
    customer: opts.stripeCustomerId,
    return_url: opts.returnUrl ?? `${appUrl()}/dashboard/settings`,
  });
  return session;
}

/** Unsubscribes at period end rather than immediately, so access is not cut off. */
export async function cancelAtPeriodEnd(
  subscriptionId: string,
): Promise<{ status: string; cancel_at_period_end: boolean }> {
  return stripe("/subscriptions/" + encodeURIComponent(subscriptionId), {
    cancel_at_period_end: "true",
  });
}

// ─── Webhook signature verification ────────────────────────────────────────────

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verifies a `Stripe-Signature` header.
 *
 * Format: `t=<unix>,v1=<hmac>[,v1=<hmac>...]` where the signed payload is
 * `${timestamp}.${rawBody}`. The timestamp is part of the signature, so it
 * cannot be swapped, and it is also checked against a tolerance to blunt
 * replay of a captured request.
 *
 * The comparison is constant time. The header is parsed by hand rather than
 * with a split-and-map so a malformed header cannot throw its way past the
 * caller.
 */
export function verifyStripeSignature(opts: {
  header: string | null | undefined;
  /** The exact bytes as received. A Buffer is preferred; a string is utf8-encoded. */
  rawBody: string | Buffer;
  secret: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): SignatureResult {
  const tolerance = opts.toleranceSeconds ?? 300;

  if (!opts.header) return { ok: false, reason: "missing signature header" };
  if (!opts.secret) return { ok: false, reason: "no webhook secret configured" };

  let timestamp: number | undefined;
  const candidates: string[] = [];

  for (const part of opts.header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === "v1" && value.length > 0) {
      candidates.push(value);
    }
  }

  if (timestamp === undefined) return { ok: false, reason: "no t= timestamp in header" };
  if (candidates.length === 0) return { ok: false, reason: "no v1 signature in header" };

  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const age = Math.abs(nowSec - timestamp);
  if (age > tolerance) {
    return { ok: false, reason: `timestamp outside ${tolerance}s tolerance` };
  }

  const prefix = Buffer.from(`${timestamp}.`, "utf8");
  const body =
    typeof opts.rawBody === "string"
      ? Buffer.from(opts.rawBody, "utf8")
      : opts.rawBody;
  const expected = createHmac("sha256", opts.secret)
    .update(Buffer.concat([prefix, body]))
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");

  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (
      candidateBuf.length === expectedBuf.length &&
      timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "no matching v1 signature" };
}

// ─── Webhook event shapes (only the fields we use) ─────────────────────────────

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  items?: {
    data?: Array<{
      quantity?: number | null;
      price?: { unit_amount?: number | null; id?: string };
    }>;
  };
  metadata?: Record<string, string>;
}

export interface StripeEvent<T = unknown> {
  id: string;
  type: string;
  created: number;
  data: { object: T };
}

export type StripeEventDisposition = "apply" | "duplicate" | "stale";

/**
 * Decide whether a verified webhook event may update subscription state.
 * Stripe event IDs are globally unique; the account timestamp protects state
 * from events delivered after a newer subscription change.
 */
export function stripeEventDisposition(opts: {
  eventId: string;
  recordedEventId?: string | null;
  eventCreated: number;
  lastAppliedCreated: number;
}): StripeEventDisposition {
  if (opts.recordedEventId === opts.eventId) return "duplicate";
  if (opts.eventCreated <= opts.lastAppliedCreated) return "stale";
  return "apply";
}

/**
 * Maps Stripe subscription statuses onto our `SubscriptionStatus` enum
 * (active, canceled, past_due, trialing).
 *
 * Anything that is not a known-good state maps to `past_due` rather than
 * `active`, so an unrecognised value fails closed and never grants access.
 * Stripe's `incomplete` means the initial payment did not succeed, so it lands
 * there too: the customer owes money and gets nothing.
 */
export function mapSubscriptionStatus(
  status: string,
): "active" | "trialing" | "past_due" | "canceled" {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "canceled":
      return "canceled";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
    default:
      return "past_due";
  }
}
