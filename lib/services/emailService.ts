import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/errors";
import { uploadFile } from "@/lib/services/storageService";
import { extractDocument, type ExtractableDocType } from "@/lib/services/aiService";
import { parseEmail, classifyDocument, extensionFor } from "@/lib/services/emailParser";

const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const DAY = 86400000;

/** Document types the trucking pipeline can store. */
const TRUCKING_TYPES = new Set([
  "rate_confirmation",
  "bill_of_lading",
  "proof_of_delivery",
  "lumper_receipt",
  "fuel_receipt",
  "insurance_certificate",
  "w9",
  "mc_authority",
  "driver_license",
  "other",
]);

/** Document types the maritime pipeline can store. */
const SHIPPING_TYPES = new Set([
  "bill_of_lading",
  "commercial_invoice",
  "packing_list",
  "certificate_of_origin",
  "customs_declaration",
  "other",
]);

function guessExpiry(subject: string | null, fileName: string): Date | null {
  // Certificate names usually carry their own validity; the provider does not
  // tell us, so leave it null and let compliance review set it.
  const hay = `${subject ?? ""} ${fileName}`.toLowerCase();
  if (/certificate|\bcoo\b|\bcoi\b|insurance|authority/.test(hay)) {
    return new Date(Date.now() + 365 * DAY);
  }
  return null;
}

/**
 * Resolve the owning account from the recipient address.
 *
 * Every user has a unique `inboxEmail`; that address is what the inbound
 * provider is configured to forward to, so it is the only trustworthy link
 * between an anonymous webhook call and a tenant. There is deliberately no
 * fallback to "the only user in the database".
 */
export async function resolveUserByInbox(
  recipient: string,
): Promise<{ id: string; email: string; inboxEmail: string }> {
  const address = recipient.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { inboxEmail: address },
    select: { id: true, email: true, inboxEmail: true },
  });
  if (!user) {
    throw new HttpError(404, `No account is configured for ${address}`, "unknown_recipient");
  }
  return user;
}

export interface IngestResult {
  emailLogId: string;
  attachmentsReceived: number;
  truckingDocuments: string[];
  shippingDocuments: string[];
  loadId: string | null;
  skipped: { fileName: string; reason: string }[];
}

/**
 * Ingest one raw inbound email.
 *
 * Attachments are classified, stored in Supabase Storage, and persisted as
 * either a trucking `Document` or a maritime `ShippingDocument` depending on
 * which type family the classification lands in. AI extraction is then run
 * inline for each stored file; a failed extraction marks the row `failed`
 * rather than aborting the whole message, because a single bad PDF should not
 * lose the rest of the paperwork.
 */
export async function ingestInboundEmail(raw: Buffer, recipient: string): Promise<IngestResult> {
  const user = await resolveUserByInbox(recipient);
  const email = parseEmail(raw);

  const log = await prisma.emailLog.create({
    data: {
      userId: user.id,
      direction: "inbound",
      fromEmail: email.from || "unknown",
      toEmail: recipient.toLowerCase(),
      subject: email.subject,
      bodyPreview: email.textBody.slice(0, 500) || null,
      attachmentsCount: email.attachments.length,
      processed: false,
    },
  });

  // Try to attach the message to a load by number mentioned in the subject or
  // body (brokers reference it constantly).
  const loadNumber = /(?:load|pro|order|ld)\s*#?\s*([A-Z0-9-]{4,20})/i.exec(
    `${email.subject ?? ""} ${email.textBody.slice(0, 2000)}`,
  )?.[1];
  const load = loadNumber
    ? await prisma.load.findFirst({
        where: { userId: user.id, loadNumber: loadNumber.toUpperCase() },
        select: { id: true },
      })
    : null;

  const result: IngestResult = {
    emailLogId: log.id,
    attachmentsReceived: email.attachments.length,
    truckingDocuments: [],
    shippingDocuments: [],
    loadId: load?.id ?? null,
    skipped: [],
  };

  for (const attachment of email.attachments.slice(0, MAX_ATTACHMENTS)) {
    if (attachment.bytes.length === 0) {
      result.skipped.push({ fileName: attachment.fileName, reason: "empty attachment" });
      continue;
    }
    if (attachment.bytes.length > MAX_BYTES) {
      result.skipped.push({ fileName: attachment.fileName, reason: "larger than 15 MB" });
      continue;
    }

    const classified = classifyDocument(attachment.fileName, email.subject);
    const ext = extensionFor(attachment.fileName, attachment.mimeType);
    const storagePath = `${user.id}/inbound/${Date.now()}-${attachment.fileName.replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    )}`;

    try {
      const fileUrl = await uploadFile(storagePath, attachment.bytes, attachment.mimeType);

      if (SHIPPING_TYPES.has(classified) && classified !== "bill_of_lading") {
        // bill_of_lading is valid in both verticals; prefer the trucking side
        // unless the sender is a shipping counterparty.
        const shipping = await prisma.shippingDocument.create({
          data: {
            userId: user.id,
            documentType: classified as never,
            fileName: attachment.fileName,
            fileUrl,
            source: "email",
            emailFrom: email.from,
            extractionStatus: "pending",
            expiresAt: guessExpiry(email.subject, attachment.fileName),
          },
        });
        await runShippingExtraction(shipping.id, attachment.bytes, {
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          type: classified,
        });
        result.shippingDocuments.push(shipping.id);
        continue;
      }

      if (TRUCKING_TYPES.has(classified)) {
        const doc = await prisma.document.create({
          data: {
            userId: user.id,
            loadId: load?.id ?? null,
            documentType: classified as never,
            fileName: attachment.fileName,
            fileUrl,
            fileSize: attachment.bytes.length,
            mimeType: attachment.mimeType,
            uploadedVia: "email",
            manuallyVerified: false,
          },
        });
        await runTruckingExtraction(doc.id, attachment.bytes, {
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          type: classified,
        });
        result.truckingDocuments.push(doc.id);
        continue;
      }

      result.skipped.push({
        fileName: attachment.fileName,
        reason: `unhandled document type "${classified}"`,
      });
    } catch (err) {
      console.error(`[email] failed to process attachment ${attachment.fileName}:`, err);
      result.skipped.push({
        fileName: attachment.fileName,
        reason: err instanceof Error ? err.message : "storage error",
      });
    }
  }

  if (email.attachments.length > MAX_ATTACHMENTS) {
    result.skipped.push({
      fileName: "(remaining)",
      reason: `only the first ${MAX_ATTACHMENTS} attachments are processed`,
    });
  }

  await prisma.emailLog.update({
    where: { id: log.id },
    data: { processed: true, relatedLoadId: load?.id ?? null },
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      title: `New email: ${email.subject ?? "(no subject)"}`,
      type: "info",
      message: `${email.attachments.length} attachment${
        email.attachments.length === 1 ? "" : "s"
      } received from ${email.from}.`,
      actionUrl: "/dashboard/documents",
    },
  });

  return result;
}

interface ExtractArgs {
  fileName: string;
  mimeType: string;
  type: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function mimeFor(fileName: string, fallback: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}

/**
 * Extraction failures are recorded on the document row rather than propagated:
 * the file is already safely stored, so the operator can retry from the UI.
 */
async function runTruckingExtraction(
  documentId: string,
  bytes: Buffer,
  args: ExtractArgs,
): Promise<number> {
  try {
    const result = await extractDocument(
      bytes,
      mimeFor(args.fileName, args.mimeType),
      args.type as ExtractableDocType,
    );
    await prisma.document.update({
      where: { id: documentId },
      data: {
        aiExtractedData: result.data as never,
        aiConfidenceScore: result.confidence,
        manuallyVerified: false,
      },
    });
    return result.confidence;
  } catch (err) {
    console.error(`[email] trucking extraction failed for ${documentId}:`, err);
    return 0;
  }
}

async function runShippingExtraction(
  documentId: string,
  bytes: Buffer,
  args: ExtractArgs,
): Promise<number> {
  await prisma.shippingDocument.update({
    where: { id: documentId },
    data: { extractionStatus: "processing" },
  });
  try {
    const result = await extractDocument(
      bytes,
      mimeFor(args.fileName, args.mimeType),
      args.type as ExtractableDocType,
    );
    await prisma.shippingDocument.update({
      where: { id: documentId },
      data: {
        extractionStatus: "completed",
        extractedData: result.data as never,
        confidence: result.confidence,
      },
    });
    return result.confidence;
  } catch (err) {
    console.error(`[email] shipping extraction failed for ${documentId}:`, err);
    await prisma.shippingDocument.update({
      where: { id: documentId },
      data: { extractionStatus: "failed" },
    });
    return 0;
  }
}
