import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/errors";

/**
 * Signature verification for inbound provider webhooks.
 *
 * The inbound endpoint is unauthenticated by necessity — the provider is a
 * mail server, not a logged-in user — so the shared secret is the only thing
 * standing between the internet and a write path into tenant data. Every
 * supported provider is HMAC-SHA256 over the raw request bytes; they differ
 * only in header name and digest encoding.
 */

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
 * Verify a provider signature or throw. Returns silently on success so the
 * caller reads as a straight line.
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
