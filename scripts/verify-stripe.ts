/**
 * Runtime checks for the Stripe signature verifier and plan guards.
 *
 *   npm run verify:stripe
 *
 * The signature check is the one piece of billing that must be exactly right:
 * getting it wrong means either rejecting real webhooks or, far worse, accepting
 * forged ones and granting a paid plan for free.
 */

import { createHmac } from "node:crypto";
import {
  findPlan,
  mapSubscriptionStatus,
  verifyStripeSignature,
  PLANS,
  stripeEventDisposition,
} from "../lib/services/stripeService";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? " - " + detail : ""}`);
  }
}

const SECRET = "whsec_test_secret_0123456789";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

function sign(body: string, timestamp: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

const NOW = 1_700_000_000_000;
const NOW_SEC = Math.floor(NOW / 1000);

console.log("stripe signature verification");

check(
  "accepts a valid signature",
  verifyStripeSignature({ header: sign(BODY, NOW_SEC), rawBody: BODY, secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects a missing header",
  !verifyStripeSignature({ header: null, rawBody: BODY, secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects an empty header",
  !verifyStripeSignature({ header: "", rawBody: BODY, secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects a wrong secret",
  !verifyStripeSignature({ header: sign(BODY, NOW_SEC, "whsec_other"), rawBody: BODY, secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects a tampered body",
  !verifyStripeSignature({ header: sign(BODY, NOW_SEC), rawBody: BODY + " ", secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects a missing timestamp",
  !verifyStripeSignature({ header: "v1=deadbeef", rawBody: BODY, secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects a missing v1",
  !verifyStripeSignature({ header: `t=${NOW_SEC}`, rawBody: BODY, secret: SECRET, nowMs: NOW }).ok,
);

check(
  "rejects a stale timestamp outside tolerance",
  !verifyStripeSignature({
    header: sign(BODY, NOW_SEC - 3600),
    rawBody: BODY,
    secret: SECRET,
    nowMs: NOW,
  }).ok,
);

check(
  "accepts a timestamp just inside tolerance",
  verifyStripeSignature({
    header: sign(BODY, NOW_SEC - 120),
    rawBody: BODY,
    secret: SECRET,
    nowMs: NOW,
  }).ok,
);

check(
  "rejects a replayed timestamp from the future",
  !verifyStripeSignature({
    header: sign(BODY, NOW_SEC + 3600),
    rawBody: BODY,
    secret: SECRET,
    nowMs: NOW,
  }).ok,
);

check(
  "accepts a rotated secret among several v1 values",
  verifyStripeSignature({
    header: `t=${NOW_SEC},v1=${createHmac("sha256", "old").update(`${NOW_SEC}.${BODY}`).digest("hex")},v1=${createHmac("sha256", SECRET).update(`${NOW_SEC}.${BODY}`).digest("hex")}`,
    rawBody: BODY,
    secret: SECRET,
    nowMs: NOW,
  }).ok,
);

check(
  "rejects a header with no secret configured",
  !verifyStripeSignature({ header: sign(BODY, NOW_SEC), rawBody: BODY, secret: "", nowMs: NOW }).ok,
);

check(
  "tolerates extra whitespace in the header",
  verifyStripeSignature({
    header: ` t=${NOW_SEC} , v1=${createHmac("sha256", SECRET).update(`${NOW_SEC}.${BODY}`).digest("hex")} `,
    rawBody: BODY,
    secret: SECRET,
    nowMs: NOW,
  }).ok,
);

check(
  "a truncated signature is rejected, not crashed on",
  !verifyStripeSignature({
    header: `t=${NOW_SEC},v1=abc123`,
    rawBody: BODY,
    secret: SECRET,
    nowMs: NOW,
  }).ok,
);

console.log("\nplan catalog");

check("lite resolves", findPlan("lite")?.label === "Lite");
check("pro resolves", findPlan("pro")?.label === "Pro");
check("enterprise resolves", findPlan("enterprise")?.label === "Enterprise");
check("trial is not purchasable", findPlan("trial") === undefined);
check("unknown plan resolves to nothing", findPlan("platinum") === undefined);

check(
  "every plan is priced in integer cents",
  PLANS.every((p) => Number.isInteger(p.unitAmount) && p.unitAmount > 0),
);

check(
  "every plan reads its price id from the environment",
  PLANS.every((p) => p.priceIdEnv.startsWith("STRIPE_PRICE_")),
);

check(
  "no plan hardcodes a price id",
  PLANS.every((p) => !/^price_/.test(p.unitAmount as unknown as string)),
);

console.log("\nstatus mapping");

check("active maps to active", mapSubscriptionStatus("active") === "active");
check("trialing maps to trialing", mapSubscriptionStatus("trialing") === "trialing");
check("past_due maps to past_due", mapSubscriptionStatus("past_due") === "past_due");
check("unpaid maps to past_due", mapSubscriptionStatus("unpaid") === "past_due");
check("canceled maps to canceled", mapSubscriptionStatus("canceled") === "canceled");
check(
  "incomplete fails closed to past_due, not active",
  mapSubscriptionStatus("incomplete") === "past_due",
);
check(
  "incomplete_expired fails closed",
  mapSubscriptionStatus("incomplete_expired") === "past_due",
);
check("paused fails closed", mapSubscriptionStatus("paused") === "past_due");
check(
  "an unknown status fails closed to past_due",
  mapSubscriptionStatus("something_new_from_stripe") === "past_due",
);
check(
  "an empty status fails closed",
  mapSubscriptionStatus("") === "past_due",
);
check(
  "only enum-valid values are ever produced",
  ["active", "trialing", "past_due", "canceled", "incomplete", "unpaid", "weird"]
    .map(mapSubscriptionStatus)
    .every((v) => ["active", "trialing", "past_due", "canceled"].includes(v)),
);

console.log("\nsubscription webhook ordering and idempotency");

check(
  "a new subscription event is applied",
  stripeEventDisposition({
    eventId: "evt_new",
    eventCreated: 200,
    lastAppliedCreated: 199,
  }) === "apply",
);
check(
  "an out-of-order older event is ignored",
  stripeEventDisposition({
    eventId: "evt_old",
    eventCreated: 199,
    lastAppliedCreated: 200,
  }) === "stale",
);
check(
  "an event at the already-applied timestamp is ignored",
  stripeEventDisposition({
    eventId: "evt_same_second",
    eventCreated: 200,
    lastAppliedCreated: 200,
  }) === "stale",
);
check(
  "a duplicate Stripe event ID is ignored regardless of timestamp",
  stripeEventDisposition({
    eventId: "evt_replay",
    recordedEventId: "evt_replay",
    eventCreated: 300,
    lastAppliedCreated: 200,
  }) === "duplicate",
);

console.log(`\n${checks - failures}/${checks} checks passed.`);

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
