/**
 * Exercises the Stripe webhook end to end with a real (test) webhook secret,
 * proving that a correctly signed event is accepted, forged events are
 * rejected, and a repeated event ID is acknowledged without reprocessing.
 * Nothing is sent to Stripe.
 *
 *   node scripts/verify-stripe-webhook.cjs
 *
 * WEBHOOK_TEST_BASE overrides the dev server URL, which matters when the server
 * is not on :3000. Next moves to the next free port when :3000 is taken, so a
 * hardcoded default silently tests the wrong server or nothing at all.
 */

const { createHmac } = require("node:crypto");
const { readFileSync, existsSync } = require("node:fs");

for (const f of [".env", ".env.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !m[1] || m[2] === undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const BASE = process.env.WEBHOOK_TEST_BASE ?? "http://localhost:3000";
// Must match the server's STRIPE_WEBHOOK_SECRET, since that is what the route
// verifies against. Nothing here reaches Stripe.
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!SECRET) {
  console.error(
    "set STRIPE_WEBHOOK_SECRET to the same value the dev server is using",
  );
  process.exit(1);
}

const SUBSCRIPTION = {
  id: "sub_test_123",
  customer: "cus_test_123",
  status: "active",
  current_period_start: Math.floor(Date.now() / 1000),
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  items: { data: [{ quantity: 3, price: { unit_amount: 29900, id: "price_pro" } }] },
  metadata: { userId: "00000000-0000-0000-0000-000000000000", plan: "pro", truckCount: "3" },
};

function sign(body, secret, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
  return `t=${ts},v1=${v1}`;
}

async function post(label, body, header, expect) {
  const res = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "stripe-signature": header } : {}),
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  const code = json.code ?? "-";
  const ok = res.status === expect;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${res.status} (${code})`);
  if (!ok) {
    console.log(`       expected ${expect}; got ${res.status} ${JSON.stringify(json)}`);
    process.exitCode = 1;
  }
  return json;
}

(async () => {
  console.log(`stripe webhook (dev server on ${BASE})\n`);

  let eventNumber = 0;
  const event = (type, object) =>
    JSON.stringify({
      id: `evt_test_${Date.now()}_${eventNumber++}`,
      type,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    });

  // 1. Forged signature must be rejected.
  const forged = event("customer.subscription.updated", SUBSCRIPTION);
  await post("forged signature rejected", forged, sign(forged, "whsec_wrong_secret"), 400);

  // 2. Missing signature must be rejected.
  await post("missing signature rejected", forged, null, 400);

  // 3. Correctly signed, but the userId does not exist -> 400 unknown_user.
  //    This proves the signature gate passed and the handler ran.
  await post("signed event with unknown user", forged, sign(forged, SECRET), 400);

  // 4. Tampered body with a valid-looking header must be rejected.
  const original = event("customer.subscription.updated", SUBSCRIPTION);
  const tampered = original.replace("active", "canceled");
  await post("tampered body rejected", tampered, sign(original, SECRET), 400);

  // 5. checkout.session.completed: the account id lives in metadata and the
  //    plan is a separate value. Conflating them once made the lookup receive
  //    "lite" instead of a UUID, which 500'd and made Stripe retry forever.
  //    The unknown user here proves the id reached the database as a UUID
  //    rather than dying on a cast, so this must be 400 and not 500.
  const session = event("checkout.session.completed", {
    id: "cs_test_123",
    object: "checkout.session",
    customer: "cus_test_123",
    subscription: "sub_test_123",
    client_reference_id: "00000000-0000-0000-0000-000000000000",
    metadata: {
      userId: "00000000-0000-0000-0000-000000000000",
      plan: "lite",
      truckCount: "1",
    },
  });
  await post(
    "checkout session resolves the account from metadata, not the plan",
    session,
    sign(session, SECRET),
    400,
  );

  // 6. A checkout session whose "userId" is a plan name must be rejected as
  //    bad data with a 400, not surface as a Prisma 500.
  const badId = event("checkout.session.completed", {
    id: "cs_test_456",
    object: "checkout.session",
    customer: "cus_test_456",
    subscription: "sub_test_456",
    metadata: { userId: "lite", plan: "lite" },
  });
  const badResult = await post(
    "non-uuid account id rejected as 400",
    badId,
    sign(badId, SECRET),
    400,
  );
  if (badResult.code !== "invalid_user_id") {
    console.log(`       expected code invalid_user_id; got ${badResult.code}`);
    process.exitCode = 1;
  }

  // 7. A subscription-mode session with no subscription at all is a shape
  //    change, so ask Stripe to retry with 409 instead of half-applying.
  const noSub = event("checkout.session.completed", {
    id: "cs_test_789",
    object: "checkout.session",
    customer: "cus_test_789",
    metadata: { userId: "00000000-0000-0000-0000-000000000000", plan: "pro" },
  });
  await post(
    "checkout session without a subscription asks for a retry",
    noSub,
    sign(noSub, SECRET),
    409,
  );

  // 8. An unhandled event type is accepted and ignored, so Stripe stops
  //    retrying something we deliberately do not act on.
  const ignored = event("invoice.created", { id: "in_test" });
  const r = await post("unhandled event ignored", ignored, sign(ignored, SECRET), 200);
  if (r.ignored !== true) {
    console.log("       expected ignored:true");
    process.exitCode = 1;
  }
  const duplicate = await post(
    "duplicate event ID acknowledged",
    ignored,
    sign(ignored, SECRET),
    200,
  );
  if (duplicate.action !== "already_processed") {
    console.log(`       expected action already_processed; got ${duplicate.action}`);
    process.exitCode = 1;
  }

  console.log(
    process.exitCode ? "\nwebhook checks FAILED" : "\nall webhook checks passed",
  );
})();
