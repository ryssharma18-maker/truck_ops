import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  activeProvider,
  renderInvoiceRequest,
  sendAndLog,
} from "@/lib/services/emailSendService";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  invoiceId: z.string().uuid(),
  note: z.string().max(2000).optional(),
});

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * POST /api/invoices/[id]/send
 *
 * Emails an invoice to the broker it is billed to and records the send.
 *
 * Tenant isolation: the invoice is fetched with `userId: user.id` in the where
 * clause, so another carrier's invoice id returns 404 rather than its contents.
 * Prisma bypasses RLS, so that clause is the only boundary.
 */
export const POST = handle(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    const user = await requireUser();
    // Without this, a loop against one invoice id mails a broker the same
    // invoice hundreds of times.
    await enforceRateLimit("invoiceSend", user.id);

    if (!activeProvider()) {
      return fail(
        "No outbound email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.",
        503,
        "email_not_configured",
      );
    }

    const parsed = bodySchema.safeParse({
      invoiceId: ctx.params.id,
      ...(await req.json().catch(() => ({}))),
    });

    if (!parsed.success) {
      return fail("Invalid invoice id", 422, "validation_error");
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: parsed.data.invoiceId, userId: user.id },
      include: {
        broker: true,
        load: { select: { loadNumber: true } },
      },
    });

    // 404 rather than 403: a cross-tenant id should be indistinguishable from
    // one that does not exist.
    if (!invoice) return fail("Invoice not found", 404, "not_found");

    if (!invoice.broker) {
      return fail(
        "This invoice has no broker to bill. Set the bill-to broker first.",
        409,
        "no_broker",
      );
    }

    const broker = invoice.broker;
    if (!broker.email) {
      return fail(
        `${broker.companyName} has no email address on file.`,
        409,
        "no_broker_email",
      );
    }

    const amountDue = invoice.totalAmount.toNumber();
    const rendered = renderInvoiceRequest({
      invoiceNumber: invoice.invoiceNumber,
      brokerName: broker.companyName,
      contactName: broker.contactName,
      brokerEmail: broker.email,
      amountDue,
      issuedOn: isoDate(invoice.invoiceDate),
      dueOn: isoDate(invoice.dueDate),
      reference: invoice.load.loadNumber ?? invoice.invoiceNumber,
      loadNumber: invoice.load.loadNumber,
    });

    const result = await sendAndLog({
      userId: user.id,
      kind: "invoice",
      to: broker.email,
      subject: rendered.subject,
      html: rendered.html,
      text: parsed.data.note
        ? `${rendered.text}\n\n---\n${parsed.data.note}`
        : rendered.text,
      relatedInvoiceId: invoice.id,
      relatedLoadId: invoice.loadId,
    });

    if (!result.ok) {
      // 502: the request was valid, the upstream provider was not.
      return fail(result.error ?? "Email provider rejected the send", 502, "send_failed");
    }

    // Only stamp sentAt / move out of draft once the provider accepted it, so a
    // failed send does not leave an invoice that looks like it was delivered.
    const isReminder = invoice.status === "sent" || invoice.reminderCount > 0;
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        sentAt: new Date(),
        status: "sent",
        reminderCount: isReminder ? { increment: 1 } : undefined,
        lastReminderSentAt: isReminder ? new Date() : undefined,
      },
    });

    return ok({
      sent: true,
      logged: result.logged,
      to: broker.email,
      subject: rendered.subject,
    });
  },
);
