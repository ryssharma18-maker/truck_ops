import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail, HttpError } from "@/lib/api";
import { ingestInboundEmail } from "@/lib/services/emailService";
import { verifyWebhookSignature, verifySvixSignature, readRawBody, constantTimeEqual } from "@/lib/services/webhookAuth";
import { parseEmail } from "@/lib/services/emailParser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/inbound-email
 *
 * Terminal for the per-tenant inbound addresses. Accepts either a raw
 * `message/rfc822` body (Resend, generic MTA) or a JSON envelope with the raw
 * message inline (`to`, `from`, `subject`, `raw`, SendGrid Inbound Parse).
 *
 * Authentication is the provider's HMAC signature — see
 * `lib/services/webhookAuth`. Returns 202 as soon as the message is durably
 * logged, and reports per-attachment outcomes so the provider can be retried
 * only for genuine failures.
 */

const JSON_ENVELOPE = z.object({
  to: z.union([z.string(), z.array(z.string())]).optional(),
  from: z.string().optional(),
  subject: z.string().optional(),
  /** Base64 or raw RFC 822 message. */
  raw: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().optional(),
        name: z.string().optional(),
        content: z.string(), // base64
        content_type: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
});

function headerSecret(
  req: NextRequest,
  name: string,
): string | undefined {
  return req.headers.get(name) ?? undefined;
}

/** Build a synthetic RFC 822 message from a JSON envelope that has no `raw`. */
function synthesizeRaw(envelope: z.infer<typeof JSON_ENVELOPE>): Buffer {
  const to = Array.isArray(envelope.to) ? envelope.to.join(", ") : (envelope.to ?? "");
  const parts = [
    `From: ${envelope.from ?? ""}`,
    `To: ${to}`,
    `Subject: ${envelope.subject ?? ""}`,
    "MIME-Version: 1.0",
  ];

  if (!envelope.attachments?.length) {
    parts.push('Content-Type: text/plain; charset="utf-8"', "", envelope.text ?? "");
    return Buffer.from(parts.join("\r\n"), "utf8");
  }

  // A single attachment -> simple body. Several -> multipart/mixed, since that
  // is what the parser expects to walk.
  if (envelope.attachments.length === 1) {
    const a = envelope.attachments[0]!;
    parts.push(
      `Content-Type: ${a.content_type ?? a.type ?? "application/octet-stream"}`,
      "Content-Transfer-Encoding: base64",
      "",
      a.content,
    );
    return Buffer.from(parts.join("\r\n"), "utf8");
  }

  const boundary = `----truckops${Date.now().toString(36)}`;
  parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
  if (envelope.text) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "",
      envelope.text,
    );
  }
  for (const a of envelope.attachments) {
    const name = a.filename ?? a.name ?? "attachment";
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.content_type ?? a.type ?? "application/octet-stream"}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      a.content,
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf8");
}

export const POST = handle(async (req: NextRequest) => {
  // Capped read: this endpoint is unauthenticated, so an attacker could
  // otherwise force an unbounded allocation before we even check the signature.
  const rawBody = await readRawBody(req);
  if (rawBody.length === 0) return fail("Empty request body", 400);

  const contentType = req.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const sendgridSecret = headerSecret(req, "x-inbound-secret");
  const resendSecret = headerSecret(req, "x-resend-signature");
  // Resend/Svix sends three headers; SendGrid Inbound Parse uses a static token.
  const svixSigned =
    req.headers.get("svix-id") !== null &&
    req.headers.get("svix-timestamp") !== null &&
    req.headers.get("svix-signature") !== null;

  if (isJson) {
    if (svixSigned) {
      verifySvixSignature(req, rawBody, {
        secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
      });
    } else if (resendSecret) {
      verifyWebhookSignature(req, rawBody, {
        secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
        header: "x-resend-signature",
        provider: "Resend",
      });
    } else if (sendgridSecret) {
      const expected = process.env.SENDGRID_INBOUND_WEBHOOK_SECRET;
      if (!expected) {
        throw new HttpError(503, "Inbound email is not configured", "webhook_not_configured");
      }
      // constantTimeEqual, like the raw branch below. This used to be a plain
      // `!==`, which leaks the length and a byte-at-a-time match prefix of the
      // shared token to anyone who can time the response.
      if (!constantTimeEqual(sendgridSecret, expected)) {
        throw new HttpError(401, "Invalid webhook secret", "invalid_signature");
      }
    } else {
      throw new HttpError(
        401,
        "Inbound webhook requires a signature header",
        "missing_signature",
      );
    }

    const envelope = JSON_ENVELOPE.parse(JSON.parse(rawBody.toString("utf8")));
    const raw = envelope.raw
      ? Buffer.from(envelope.raw, "utf8")
      : synthesizeRaw(envelope);

    // Prefer the parsed To header; fall back to the envelope's own field.
    const parsed = parseEmail(raw);
    const recipient = parsed.to[0] ?? (Array.isArray(envelope.to) ? envelope.to[0] : envelope.to);
    if (!recipient) return fail("Could not determine the recipient address", 400);

    const result = await ingestInboundEmail(raw, recipient);
    return ok(result, 202);
  }

  // Raw message/rfc822.
  const secretHeader = headerSecret(req, "x-inbound-secret");
  if (secretHeader) {
    const expected = process.env.SENDGRID_INBOUND_WEBHOOK_SECRET;
    if (!expected) {
      throw new HttpError(503, "Inbound email is not configured", "webhook_not_configured");
    }
    if (!constantTimeEqual(secretHeader, expected)) {
      throw new HttpError(401, "Invalid webhook secret", "invalid_signature");
    }
  } else if (svixSigned) {
    verifySvixSignature(req, rawBody, {
      secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
    });
  } else {
    verifyWebhookSignature(req, rawBody, {
      secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
      header: "x-resend-signature",
      provider: "Resend",
    });
  }

  const parsed = parseEmail(rawBody);
  const recipient = parsed.to[0];
  if (!recipient) return fail("Could not determine the recipient address", 400);

  const result = await ingestInboundEmail(rawBody, recipient);
  return ok(result, 202);
});
