import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/errors";

/**
 * Signature verification and body reading for inbound provider webhooks.
 *
 * The inbound endpoints are unauthenticated by necessity — the provider is a
 * mail or payments server, not a logged-in user — so these checks are the only
 * thing standing between the internet and a write path into tenant data.
 */

/** 25 MiB. Generous for a signed JSON envelope with base64 attachments, small
 * enough that a single anonymous request cannot exhaust a serverless instance. */
export const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

/** Svix tolerance for the `svix-timestamp` header. 5 minutes is Svix's default. */
export const DEFAULT_SVIX_TOLERANCE_SECONDS = 300;

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

/**
 * Read the request body as a Buffer, refusing anything over `maxBytes`.
 *
 * Signature verification needs the exact bytes, so the body cannot be streamed
 * into a JSON parser instead. That makes this the one place an anonymous caller
 * can force an allocation, so it is capped two ways: a `Content-Length` header
 * is rejected up front without reading a byte, and the stream is counted while
 * it is consumed so a lying (or absent) header cannot bypass the limit.
 */
export async function readRawBody(
  req: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Buffer> {
  const declared = req.headers.get("content-length");
  if (declared) {
    const n = Number(declared);
    // A non-numeric Content-Length is itself suspicious; fall through and let
    // the streaming counter enforce the limit.
    if (Number.isFinite(n) && n > maxBytes) {
      throw new HttpError(
        413,
        `Request body exceeds the ${maxBytes} byte limit`,
        "payload_too_large",
      );
    }
  }

  const body = req.body;
  if (!body) {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new HttpError(
        413,
        `Request body exceeds the ${maxBytes} byte limit`,
        "payload_too_large",
      );
    }
    return buf;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling. The peer may still be sending, so drop the connection.
        await reader.cancel().catch(() => {});
        throw new HttpError(
          413,
          `Request body exceeds the ${maxBytes} byte limit`,
          "payload_too_large",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

// ---------------------------------------------------------------------------
// Svix / Resend inbound email
// ---------------------------------------------------------------------------

/**
 * Verify a Svix webhook signature.
 *
 * Resend delivers inbound email through Svix, which is a different scheme from
 * the plain hex-HMAC used elsewhere in this file. The differences are easy to
 * get wrong and each one produces a 401 on legitimate traffic:
 *
 *   - three separate headers, not one: `svix-id`, `svix-timestamp`,
 *     `svix-signature`
 *   - the key is the base64-DECODED bytes of the secret with the `whsec_`
 *     prefix removed, not the secret string itself
 *   - the signed content is `${svix_id}.${svix_timestamp}.${body}` — the id and
 *     timestamp are prepended, not appended
 *   - the digest is BASE64, not hex
 *   - the timestamp is checked against a tolerance, so a captured request
 *     cannot be replayed indefinitely
 *   - the header can carry several `v1,` values during a secret rotation and
 *     all of them must be tried
 */
export function verifySvixSignature(
  req: Request,
  rawBody: Buffer,
  {
    secret,
    toleranceSeconds = DEFAULT_SVIX_TOLERANCE_SECONDS,
    now = Date.now(),
  }: {
    secret: string | undefined;
    toleranceSeconds?: number;
    /** Injectable for tests. */
    now?: number;
  },
): void {
  if (!secret) {
    throw new HttpError(
      503,
      "Inbound email is not configured — set the Resend webhook signing secret",
      "webhook_not_configured",
    );
  }

  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");

  if (!id || !timestamp || !signature) {
    throw new HttpError(401, "Missing Svix signature headers", "missing_signature");
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw new HttpError(401, "Invalid webhook timestamp", "invalid_timestamp");
  }
  // Compare in seconds; both sides are seconds since epoch.
  const ageSeconds = Math.abs(now / 1000 - ts);
  if (ageSeconds > toleranceSeconds) {
    throw new HttpError(
      401,
      "Webhook timestamp outside the tolerance window",
      "timestamp_out_of_tolerance",
    );
  }

  const key = svixKeyBytes(secret);
  const signedContent = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`, "utf8"),
    rawBody,
  ]);
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  // Svix sends `v1,<base64>` and may send several space-separated entries while
  // a secret is being rotated. Any one matching is sufficient.
  const candidates = signature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part));

  if (!candidates.some((candidate) => safeEqual(candidate, expected))) {
    throw new HttpError(401, "Invalid webhook signature", "invalid_signature");
  }
}

/** `whsec_<base64>` → raw key bytes. A secret without the prefix is treated as
 * already-decoded key material so a misconfigured env var fails to verify
 * rather than silently hashing the literal string. */
function svixKeyBytes(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const decoded = Buffer.from(raw, "base64");
  // Buffer.from is permissive: it does not throw on invalid base64, it just
  // returns whatever it decoded. If nothing was decoded, fall back to the
  // literal string so we never sign with a zero-length key.
  return decoded.length > 0 ? decoded : Buffer.from(raw, "utf8");
}

// ---------------------------------------------------------------------------
// Generic HMAC (Stripe uses its own scheme; see lib/services/stripeService.ts)
// ---------------------------------------------------------------------------

function hmacHex(secret: string, payload: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Length-safe constant-time comparison. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Exported for comparing a shared token (e.g. SendGrid Inbound Parse) where
 * the "signature" is the secret itself. `!==` leaks length and prefix. */
export function constantTimeEqual(a: string, b: string): boolean {
  return safeEqual(a, b);
}

/** Strip the `sha256=` prefix some providers add to the digest. */
function normalize(value: string): string {
  return value.trim().replace(/^sha256=/i, "");
}

export interface WebhookSignatureOptions {
  /** Required. Rejects the request with 503 if absent. */
  secret: string | undefined;
  /** Header carrying the digest. */
  header: string;
  /** Extra fields the provider signs alongside the body, in provider order. */
  signedFields?: (req: Request) => string[];
  /** Human label used in the error message. */
  provider: string;
}

/**
 * Verify a plain hex-HMAC-over-the-raw-bytes provider signature, or throw.
 * Returns silently on success so the caller reads as a straight line.
 *
 * Prefer `verifySvixSignature` for anything Resend or Svix touches; this is for
 * providers whose scheme is genuinely a bare hex HMAC.
 */
export function verifyWebhookSignature(
  req: Request,
  rawBody: Buffer,
  { secret, header, signedFields, provider }: WebhookSignatureOptions,
): void {
  if (!secret) {
    throw new HttpError(
      503,
      `Inbound email is not configured — set the ${provider} webhook secret`,
      "webhook_not_configured",
    );
  }

  const provided = req.headers.get(header);
  if (!provided) {
    throw new HttpError(401, "Missing webhook signature", "missing_signature");
  }

  const expected = signedFields
    ? createHmac("sha256", secret)
        .update(signedFields(req).join("") + rawBody.toString("utf8"))
        .digest("hex")
    : hmacHex(secret, rawBody);

  if (!safeEqual(normalize(provided), expected)) {
    throw new HttpError(401, "Invalid webhook signature", "invalid_signature");
  }
}
