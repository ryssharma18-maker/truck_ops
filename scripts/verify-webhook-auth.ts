/**
 * Runtime checks for webhook signature verification. Run with:
 *
 *   npx tsx scripts/verify-webhook-auth.ts
 */

import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../lib/services/webhookAuth";
import { HttpError } from "../lib/errors";

let failures = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  [ok]   ${name}`);
  } else {
    failures++;
    console.error(`  [FAIL] ${name}`);
  }
}

const SECRET = "test-secret-value";
const BODY = Buffer.from("From: a@b.test\r\nTo: fleet@inbox.truckops.ai\r\n\r\nhello", "utf8");
const SIG = createHmac("sha256", SECRET).update(BODY).digest("hex");

function req(sig: string | null): Request {
  return new Request("https://app.test/api/webhooks/inbound-email", {
    method: "POST",
    headers: sig ? { "x-resend-signature": sig } : {},
  });
}

function run(r: Request, secret = SECRET): string {
  try {
    verifyWebhookSignature(r, BODY, {
      secret,
      header: "x-resend-signature",
      provider: "Resend",
    });
    return "accepted";
  } catch (e) {
    return e instanceof HttpError ? `${e.status}:${e.code ?? ""}` : "threw";
  }
}

console.log("HMAC signature verification");
check("valid signature accepted", run(req(SIG)) === "accepted");
check("sha256= prefix stripped", run(req(`sha256=${SIG}`)) === "accepted");
check("missing header rejected", run(req(null)) === "401:missing_signature");
check("wrong signature rejected", run(req("deadbeef")) === "401:invalid_signature");
check("truncated signature rejected", run(req(SIG.slice(0, 32))) === "401:invalid_signature");
check(
  "body tampering rejected",
  run(req(createHmac("sha256", SECRET).update(Buffer.from("tampered")).digest("hex"))) ===
    "401:invalid_signature",
);
check("wrong secret rejected", run(req(SIG), "another-secret") === "401:invalid_signature");
check(
  "unconfigured secret is 503 not 401",
  (() => {
    try {
      verifyWebhookSignature(req(SIG), BODY, {
        secret: undefined,
        header: "x-resend-signature",
        provider: "Resend",
      });
      return false;
    } catch (e) {
      return e instanceof HttpError && e.status === 503 && e.code === "webhook_not_configured";
    }
  })(),
);

console.log("signed-fields variant (timestamp + body)");
{
  const ts = "1758460000";
  const expected = createHmac("sha256", SECRET)
    .update(ts + BODY.toString("utf8"))
    .digest("hex");
  const r = new Request("https://app.test/x", {
    headers: { "x-sig": expected, "x-ts": ts },
  });
  const attempt = (req: Request) => {
    try {
      verifyWebhookSignature(req, BODY, {
        secret: SECRET,
        header: "x-sig",
        provider: "Test",
        signedFields: (q) => [q.headers.get("x-ts") ?? ""],
      });
      return "accepted";
    } catch (e) {
      return e instanceof HttpError ? `${e.status}` : "threw";
    }
  };
  check("valid signed-fields accepted", attempt(r) === "accepted");
  check("missing signed field rejected", attempt(new Request("https://app.test/x", { headers: { "x-sig": expected } })) === "401");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
