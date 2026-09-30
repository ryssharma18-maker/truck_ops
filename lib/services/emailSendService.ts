import { requireEnv, anyConfigured } from "@/lib/env";

/**
 * Outbound transactional email: invoices and compliance notices.
 *
 * Two providers, no SDK. Resend and SendGrid are both a single JSON POST, and
 * an SDK for two calls is a dependency that can break the build for no gain.
 * Resend is preferred because it has the cleaner response shape.
 *
 * Every send is recorded in `email_logs` with direction=outbound, so a carrier
 * can see what was sent and when. A send that fails is logged as an attempt
 * with `processed=false` rather than vanishing, because "we emailed the broker"
 * is a claim a collections workflow may depend on.
 */

export type EmailKind = "invoice" | "compliance" | "receipt";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/** Which provider is live, or null when neither is configured. */
export function activeProvider(): "resend" | "sendgrid" | null {
  if (anyConfigured("RESEND_API_KEY")) return "resend";
  if (anyConfigured("SENDGRID_API_KEY")) return "sendgrid";
  return null;
}

/**
 * The From header on outbound mail.
 *
 * A per-call `override` wins, then OUTBOUND_FROM_EMAIL/OUTBOUND_FROM_NAME.
 * The hardcoded fallback is a placeholder: a carrier that has not configured a
 * verified sender domain will have its mail rejected by SPF/DMARC, so the
 * invoices page says so rather than pretending the send worked.
 */
export function fromAddress(override?: string): string {
  if (override) return override;

  const email = process.env.OUTBOUND_FROM_EMAIL?.trim();
  if (!email) return "TruckOps AI <billing@truckops.ai>";

  const name = process.env.OUTBOUND_FROM_NAME?.trim() || "TruckOps AI";
  return `"${name.replace(/"/g, "")}" <${email}>`;
}

async function sendViaResend(o: SendEmailOptions): Promise<SendResult> {
  const key = requireEnv("RESEND_API_KEY", "outbound email");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(o.from),
      to: [o.to],
      subject: o.subject,
      html: o.html,
      text: o.text,
      reply_to: o.replyTo,
      attachments: o.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
  };

  if (!res.ok) {
    return { ok: false, error: json.message ?? `Resend returned ${res.status}` };
  }
  return { ok: true, providerMessageId: json.id };
}

async function sendViaSendGrid(o: SendEmailOptions): Promise<SendResult> {
  const key = requireEnv("SENDGRID_API_KEY", "outbound email");

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: o.to }] }],
      from: parseFromAddress(fromAddress(o.from)),
      reply_to: o.replyTo ? parseFromAddress(o.replyTo) : undefined,
      subject: o.subject,
      content: [
        { type: "text/plain", value: o.text ?? stripHtml(o.html) },
        { type: "text/html", value: o.html },
      ],
      attachments: o.attachments?.map((a) => ({
        filename: a.filename,
        type: a.contentType ?? "application/octet-stream",
        content: a.content.toString("base64"),
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: body || `SendGrid returned ${res.status}` };
  }
  // SendGrid returns the message id in a header, not the body.
  return { ok: true, providerMessageId: res.headers.get("x-message-id") ?? undefined };
}

async function send(o: SendEmailOptions): Promise<SendResult> {
  const provider = activeProvider();
  if (!provider) {
    return {
      ok: false,
      error:
        "No outbound email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.",
    };
  }
  try {
    return provider === "resend" ? await sendViaResend(o) : await sendViaSendGrid(o);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface LoggedSend extends SendEmailOptions {
  userId: string;
  kind: EmailKind;
  relatedLoadId?: string | null;
  relatedInvoiceId?: string | null;
}

/**
 * Sends an email and records the attempt. Never throws on a provider failure:
 * a bounced invoice email should surface as a failed send the caller can
 * report, not a 500 that hides why.
 *
 * The log write is also non-fatal. The email has already left the building by
 * then, so letting a logging failure propagate would report an error for a
 * send that succeeded — and a caller that retries on error would send the
 * broker a duplicate invoice.
 */
export async function sendAndLog(
  o: LoggedSend,
): Promise<SendResult & { logId: string | null; logged: boolean }> {
  const { prisma } = await import("@/lib/prisma");

  const result = await send(o);

  let logId: string | null = null;
  try {
    const log = await prisma.emailLog.create({
      data: {
        userId: o.userId,
        direction: "outbound",
        fromEmail: fromAddress(o.from),
        toEmail: o.to,
        subject: o.subject,
        bodyPreview: (o.text ?? stripHtml(o.html)).slice(0, 500),
        relatedLoadId: o.relatedLoadId ?? null,
        relatedInvoiceId: o.relatedInvoiceId ?? null,
        attachmentsCount: o.attachments?.length ?? 0,
        processed: result.ok,
      },
    });
    logId = log.id;
  } catch (err) {
    console.error("[email] sent but could not log:", err);
  }

  return { ...result, logId, logged: logId !== null };
}

// ─── Templates ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function layout(title: string, bodyHtml: string): string {
  // Inline styles only: email clients strip <style> blocks and most class
  // names. Anything that renders an invoice has to survive Outlook.
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#0f172a;padding:20px 28px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">TruckOps AI</span>
        </td></tr>
        <tr><td style="padding:28px;color:#0f172a;">
          <h1 style="margin:0 0 16px;font-size:20px;">${esc(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
          Sent by TruckOps AI on behalf of your carrier.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export interface InvoiceEmailData {
  invoiceNumber: string;
  /** Legal entity being billed, e.g. "Coyote Logistics". */
  brokerName: string;
  /** Person to greet. Falls back to brokerName when absent. */
  contactName?: string | null;
  brokerEmail: string;
  amountDue: number;
  currency?: string;
  issuedOn: string;
  dueOn: string;
  reference: string;
  loadNumber?: string | null;
}

/** Rate con / invoice request to a broker. */
export function renderInvoiceRequest(d: InvoiceEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Invoice ${d.invoiceNumber} - ${money(d.amountDue)} due ${d.dueOn}`;
  const greeting = d.contactName?.trim() || d.brokerName;

  const html = layout(
    `Invoice ${esc(d.invoiceNumber)}`,
    `<p style="margin:0 0 16px;color:#334155;">Hi ${esc(greeting)},</p>
     <p style="margin:0 0 20px;color:#334155;">Please find invoice
       <strong>${esc(d.invoiceNumber)}</strong> for the completed load.</p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;font-size:14px;">
       <tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Invoice</td>
           <td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">${esc(d.invoiceNumber)}</td></tr>
       <tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Issued</td>
           <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f1f5f9;">${esc(d.issuedOn)}</td></tr>
       <tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Due</td>
           <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f1f5f9;">${esc(d.dueOn)}</td></tr>
       ${d.loadNumber ? `<tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Load</td>
           <td style="padding:8px 0;text-align:right;border-bottom:1px solid #f1f5f9;">${esc(d.loadNumber)}</td></tr>` : ""}
       <tr><td style="padding:12px 0;color:#0f172a;font-weight:700;">Amount due</td>
           <td style="padding:12px 0;text-align:right;font-weight:700;">${esc(money(d.amountDue))}</td></tr>
     </table>
     <p style="margin:0 0 20px;color:#334155;">
       Reference for payment: <strong>${esc(d.reference)}</strong>
     </p>
     <p style="margin:0;color:#64748b;font-size:13px;">
       Reply to this email if anything looks wrong and we will correct it before the due date.
     </p>`,
  );

  const text = [
    `Hi ${greeting},`,
    "",
    `Invoice ${d.invoiceNumber}`,
    "",
    `Broker:     ${d.brokerName}`,
    `Issued:     ${d.issuedOn}`,
    `Due:        ${d.dueOn}`,
    d.loadNumber ? `Load:        ${d.loadNumber}` : "",
    "",
    `Amount due: ${money(d.amountDue)}`,
    `Reference:  ${d.reference}`,
    "",
    "Reply to this email if anything looks wrong.",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

export interface ComplianceEmailData {
  documentTitle: string;
  expiresOn: string;
  daysRemaining: number;
  vehicle?: string | null;
}

/** Expiry reminder. Wording changes with urgency so a real deadline stands out. */
export function renderComplianceReminder(d: ComplianceEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const urgent = d.daysRemaining <= 14;
  const critical = d.daysRemaining <= 7;

  const subject = urgent
    ? `URGENT: ${d.documentTitle} expires in ${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"}`
    : `${d.documentTitle} expires on ${d.expiresOn}`;

  const banner = urgent
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:${critical ? "#dc2626" : "#d97706"};color:#ffffff;padding:12px 16px;border-radius:8px;font-weight:600;">
        ${critical ? "This will block dispatch." : "Renewal needed soon."}
       </td></tr></table>`
    : "";

  const html = layout(
    "Compliance renewal due",
    `${banner}
     <p style="margin:0 0 16px;color:#334155;">
       <strong>${esc(d.documentTitle)}</strong>${d.vehicle ? ` on ${esc(d.vehicle)}` : ""}
       expires on <strong>${esc(d.expiresOn)}</strong>, in ${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"}.
     </p>
     <p style="margin:0;color:#64748b;font-size:13px;">
       Renew in the compliance vault and upload the replacement so the next audit has it on file.
     </p>`,
  );

  const text = [
    `Compliance renewal due`,
    ``,
    `Document: ${d.documentTitle}`,
    d.vehicle ? `Vehicle:   ${d.vehicle}` : ``,
    `Expires:   ${d.expiresOn}`,
    `Remaining: ${d.daysRemaining} day${d.daysRemaining === 1 ? "" : "s"}`,
    ``,
    `Renew in the compliance vault and upload the replacement.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return { subject, html, text };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** SendGrid wants { email, name }, not RFC 5322. */
function parseFromAddress(s: string): { email: string; name?: string } {
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<?([^<>]+)>?\s*$/.exec(s);
  const email = m?.[2]?.trim();
  // The regex guarantees group 2 for anything it matches, but an unparsable
  // header must not send `undefined` to the provider.
  if (!email) return { email: s.trim() };
  const name = (m?.[1] ?? "").trim();
  return { email, ...(name ? { name } : {}) };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
