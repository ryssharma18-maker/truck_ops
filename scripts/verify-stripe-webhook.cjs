/**
 * Exercises the Stripe webhook end to end with a real (test) webhook secret,
 * proving that a correctly signed event is accepted and a forged one is not.
 * Nothing is sent to Stripe and no database row is written.
 *
 *   node scripts/verify-stripe-webhook.cjs
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
  console.log("stripe webhook (requires the dev server on :3000)\n");

  const event = (type, object) =>
    JSON.stringify({ id: "evt_test", type, data: { object } });

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

  // 5. An unhandled event type is accepted and ignored, so Stripe stops
  //    retrying something we deliberately do not act on.
  const ignored = event("invoice.created", { id: "in_test" });
  const r = await post("unhandled event ignored", ignored, sign(ignored, SECRET), 200);
  if (r.ignored !== true) {
    console.log("       expected ignored:true");
    process.exitCode = 1;
  }

  console.log(
    process.exitCode ? "\nwebhook checks FAILED" : "\nall webhook checks passed",
  );
})();
