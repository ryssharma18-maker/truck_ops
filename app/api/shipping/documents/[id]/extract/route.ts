import { NextRequest } from "next/server";
import { handle, ok, HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractDocument, type ExtractableDocType } from "@/lib/services/aiService";
import { downloadFile } from "@/lib/services/storageService";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const AI_TYPES: ExtractableDocType[] = [
  "bill_of_lading",
  "commercial_invoice",
  "packing_list",
  "other",
];

/**
 * ShippingDocument has no mimeType column, so the Gemini inline part is typed
 * from the file extension.
 */
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

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Run Gemini extraction over a stored shipping document and persist the result
 * on the ShippingDocument row. The row is claimed with a `processing` status so
 * concurrent requests cannot double-run the model.
 */
export const POST = handle(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser();
    // Each call is a billed Gemini request.
    await enforceRateLimit("aiParse", user.id);

    const doc = await prisma.shippingDocument.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!doc) throw new HttpError(404, "Document not found");

    if (doc.extractionStatus === "processing") {
      throw new HttpError(409, "Extraction already in progress", "extraction_in_progress");
    }
    if (!doc.fileUrl) {
      throw new HttpError(422, "Document has no stored file", "document_missing_file");
    }

    const documentType = (
      AI_TYPES.includes(doc.documentType as ExtractableDocType)
        ? doc.documentType
        : "other"
    ) as ExtractableDocType;

    await prisma.shippingDocument.update({
      where: { id: doc.id },
      data: { extractionStatus: "processing" },
    });

    try {
      const bytes = await downloadFile(doc.fileUrl);
      const result = await extractDocument(bytes, mimeFromName(doc.fileName), documentType);

      const updated = await prisma.shippingDocument.update({
        where: { id: doc.id },
        data: {
          extractionStatus: "completed",
          extractedData: result.data as never,
          confidence: result.confidence,
        },
      });

      return ok({
        document: updated,
        confidence: result.confidence,
        data: result.data,
      });
    } catch (err) {
      await prisma.shippingDocument.update({
        where: { id: doc.id },
        data: { extractionStatus: "failed" },
      });
      throw err instanceof HttpError
        ? err
        : new HttpError(502, "Extraction failed", "extraction_failed");
    }
  },
);
