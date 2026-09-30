/**
 * Runtime checks for webhook signature verification. Run with:
 *
 *   npx tsx scripts/verify-webhook-auth.ts
 */

import { createHmac } from "node:crypto";
import { verifyWebhookSignature, verifySvixSignature, readRawBody } from "../lib/services/webhookAuth";
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

// ---------------------------------------------------------------------------
// Svix / Resend inbound.
//
// The checks above only prove the bare hex-HMAC variant. Resend delivers
// inbound through Svix, which differs in five ways, and getting any of them
// wrong yields a 401 on every legitimate delivery. The negative checks below
// are the point: each one signs a request the way the OLD implementation would
// have and asserts it is now rejected.
// ---------------------------------------------------------------------------

console.log("Svix signature verification");

/** A syntactically valid `whsec_` secret: 32 random-ish bytes, base64. */
const SVIX_SECRET = "whsec_" + Buffer.from("0123456789abcdefghijklmnopqrstuv").toString("base64");
const SVIX_KEY = Buffer.from("0123456789abcdefghijklmnopqrstuv", "utf8");
const SVIX_ID = "msg_2abcDEF456ghi789";
const NOW_MS = 1_758_460_000_000;
const NOW_SEC = String(Math.floor(NOW_MS / 1000));

/** Independent implementation of Svix's documented scheme, used to build
 *  fixtures. Deliberately does not call into lib/services/webhookAuth. */
function svixDigest(opts: {
  key?: Buffer;
  id?: string;
  timestamp?: string;
  body: Buffer;
  prefixIdAndTimestamp?: boolean;
  encoding?: "base64" | "hex";
}): string {
  const key = opts.key ?? SVIX_KEY;
  const id = opts.id ?? SVIX_ID;
  const ts = opts.timestamp ?? NOW_SEC;
  const content = opts.prefixIdAndTimestamp === false
    ? opts.body
    : Buffer.concat([Buffer.from(`${id}.${ts}.`, "utf8"), opts.body]);
  const mac = createHmac("sha256", key).update(content);
  return opts.encoding === "hex" ? mac.digest("hex") : mac.digest("base64");
}

function svixReq(headers: Record<string, string>): Request {
  return new Request("https://app.test/api/webhooks/inbound-email", {
    method: "POST",
    headers,
  });
}

function svixRun(
  headers: Record<string, string>,
  body: Buffer = BODY,
  secret: string | null = SVIX_SECRET,
  toleranceSeconds?: number,
  nowMs: number = NOW_MS,
): string {
  try {
    verifySvixSignature(svixReq(headers), body, {
      secret: secret === null ? undefined : secret,
      toleranceSeconds,
      now: nowMs,
    });
    return "accepted";
  } catch (e) {
    return e instanceof HttpError ? `${e.status}:${e.code ?? ""}` : "threw";
  }
}

const goodSig = svixDigest({ body: BODY });
const goodHeaders = {
  "svix-id": SVIX_ID,
  "svix-timestamp": NOW_SEC,
  "svix-signature": `v1,${goodSig}`,
};

check("digest is 44-char base64 (not hex)", /^[A-Za-z0-9+/]{43}=$/.test(goodSig));
check("valid Svix signature accepted", svixRun(goodHeaders) === "accepted");

// --- the B2 defect class: each of these was accepted by the old code -------
check(
  "OLD SCHEME hex-over-body-only is rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,${createHmac("sha256", SVIX_SECRET).update(BODY).digest("hex")}`,
  }) === "401:invalid_signature",
);
check(
  "raw secret string as key is rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,${svixDigest({ key: Buffer.from(SVIX_SECRET, "utf8"), body: BODY })}`,
  }) === "401:invalid_signature",
);
check(
  "undecoded key with base64 digest is rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,${svixDigest({ key: Buffer.from(SVIX_SECRET, "utf8"), body: BODY })}`,
  }) === "401:invalid_signature",
);
check(
  "hex digest instead of base64 is rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,${svixDigest({ body: BODY, encoding: "hex" })}`,
  }) === "401:invalid_signature",
);
check(
  "omitting the id.timestamp prefix is rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,${svixDigest({ body: BODY, prefixIdAndTimestamp: false })}`,
  }) === "401:invalid_signature",
);
check(
  "swapped id (signature from another message) is rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,${svixDigest({ body: BODY, id: "msg_someOtherId000" })}`,
  }) === "401:invalid_signature",
);
check(
  "legacy x-resend-signature header is not honoured",
  svixRun({
    "x-resend-signature": createHmac("sha256", SVIX_SECRET).update(BODY).digest("hex"),
  }) === "401:missing_signature",
);

// --- tolerance ------------------------------------------------------------
check(
  "timestamp 6 minutes stale is rejected",
  svixRun({
    ...goodHeaders,
    "svix-timestamp": String(Number(NOW_SEC) - 360),
    "svix-signature": `v1,${svixDigest({ timestamp: String(Number(NOW_SEC) - 360), body: BODY })}`,
  }) === "401:timestamp_out_of_tolerance",
);
check(
  "timestamp 6 minutes in the future is rejected",
  svixRun({
    ...goodHeaders,
    "svix-timestamp": String(Number(NOW_SEC) + 360),
    "svix-signature": `v1,${svixDigest({ timestamp: String(Number(NOW_SEC) + 360), body: BODY })}`,
  }) === "401:timestamp_out_of_tolerance",
);
check(
  "timestamp 60s stale is accepted (inside tolerance)",
  svixRun({
    ...goodHeaders,
    "svix-timestamp": String(Number(NOW_SEC) - 60),
    "svix-signature": `v1,${svixDigest({ timestamp: String(Number(NOW_SEC) - 60), body: BODY })}`,
  }) === "accepted",
);
check(
  "non-numeric timestamp rejected",
  svixRun({ ...goodHeaders, "svix-timestamp": "not-a-number" }) === "401:invalid_timestamp",
);

// --- secret rotation: the header can carry several v1 values ---------------
check(
  "second of two v1 signatures accepted (secret rotation)",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1,${goodSig}`,
  }) === "accepted",
);
check(
  "two invalid v1 signatures rejected",
  svixRun({
    ...goodHeaders,
    "svix-signature": `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v1,BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=`,
  }) === "401:invalid_signature",
);
check(
  "bare digest with no v1, prefix is still accepted",
  svixRun({ ...goodHeaders, "svix-signature": goodSig }) === "accepted",
);

// --- missing headers / unconfigured --------------------------------------
check("missing svix-id rejected", svixRun({ "svix-timestamp": NOW_SEC, "svix-signature": `v1,${goodSig}` }) === "401:missing_signature");
check("missing svix-timestamp rejected", svixRun({ "svix-id": SVIX_ID, "svix-signature": `v1,${goodSig}` }) === "401:missing_signature");
check("missing svix-signature rejected", svixRun({ "svix-id": SVIX_ID, "svix-timestamp": NOW_SEC }) === "401:missing_signature");
check("unconfigured secret is 503 not 401", svixRun(goodHeaders, BODY, null) === "503:webhook_not_configured");

// --- prefix handling ------------------------------------------------------
const SVIX_BARE = SVIX_SECRET.slice("whsec_".length);
check(
  "whsec_ prefix is stripped, not part of the key",
  svixRun(goodHeaders, BODY, SVIX_BARE) === "accepted",
);
check(
  "whsec_-prefixed and bare secrets behave identically",
  svixRun(goodHeaders, BODY, SVIX_SECRET) === svixRun(goodHeaders, BODY, SVIX_BARE),
);
check(
  "body tampering rejected",
  svixRun(goodHeaders, Buffer.from("From: evil@x.test\r\n\r\nbody")) === "401:invalid_signature",
);

// ---------------------------------------------------------------------------
// Capped body reads
//
// Wrapped in a function because this package is CJS, so top-level await is not
// available under tsx.
// ---------------------------------------------------------------------------

async function checkBodyCap() {
  console.log("Body size cap");

  async function readBody(
    req: Request,
    maxBytes?: number,
  ): Promise<{ ok: boolean; code?: string; length?: number; value?: string }> {
    try {
      const buf = await readRawBody(req, maxBytes);
      return { ok: true, length: buf.length, value: buf.toString("utf8") };
    } catch (e) {
      return { ok: false, code: e instanceof HttpError ? e.code : "threw" };
    }
  }

  const small = await readBody(
    new Request("https://app.test/x", { method: "POST", body: "hello" }),
    1024,
  );
  check("normal body passes the cap", small.ok && small.value === "hello");
  check("byte length is exact", small.length === 5);

  const empty = await readBody(
    new Request("https://app.test/x", { method: "POST", body: "" }),
    1024,
  );
  check("empty body allowed (caller decides)", empty.ok && empty.length === 0);

  const declaredTooBig = await readBody(
    new Request("https://app.test/x", {
      method: "POST",
      body: "hello",
      headers: { "content-length": "999999999" },
    }),
    1024,
  );
  check(
    "oversized Content-Length rejected without reading",
    !declaredTooBig.ok && declaredTooBig.code === "payload_too_large",
  );

  const lyingHeader = await readBody(
    new Request("https://app.test/x", {
      method: "POST",
      body: "x".repeat(5000),
      headers: { "content-length": "5" },
    }),
    1024,
  );
  check(
    "understated Content-Length still caught by the stream counter",
    !lyingHeader.ok && lyingHeader.code === "payload_too_large",
  );

  const noHeaderStream = await readBody(
    new Request("https://app.test/x", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(600));
          c.enqueue(new Uint8Array(600));
          c.close();
        },
      }),
      // @ts-expect-error - duplex is required by undici for a stream body
      duplex: "half",
    }),
    1024,
  );
  check(
    "chunked body over the cap rejected with no Content-Length",
    !noHeaderStream.ok && noHeaderStream.code === "payload_too_large",
  );

  const exactly = await readBody(
    new Request("https://app.test/x", { method: "POST", body: "x".repeat(64) }),
    64,
  );
  check("body exactly at the cap is allowed", exactly.ok && exactly.length === 64);

  const binary = await readBody(
    new Request("https://app.test/x", {
      method: "POST",
      body: new Uint8Array([0xff, 0xfe, 0x00, 0x80]),
    }),
    1024,
  );
  check("binary bytes survive the read", binary.ok && binary.length === 4);
}

checkBodyCap()
  .catch((e) => {
    failures++;
    console.error(`  [FAIL] body-cap section threw: ${e}`);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
