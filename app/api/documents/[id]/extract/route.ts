import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/services/storageService";
import { extractDocument, type ExtractableDocType } from "@/lib/services/aiService";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const extractable = z.enum([
  "rate_confirmation",
  "bill_of_lading",
  "proof_of_delivery",
  "commercial_invoice",
  "packing_list",
  "lumper_receipt",
  "fuel_receipt",
  "insurance_certificate",
  "w9",
  "mc_authority",
  "driver_license",
  "other",
]);

/**
 * POST /api/documents/[id]/extract
 *
 * Re-runs AI extraction over an already-uploaded document. The stored type is
 * used as the field contract unless the caller overrides it, which is how a
 * user corrects a mis-classified upload.
 */
export const POST = handle(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser();

    const doc = await prisma.document.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!doc) throw new HttpError(404, "Document not found", "not_found");

    const override = new URL(req.url).searchParams.get("documentType");
    const documentType: ExtractableDocType = override
      ? extractable.parse(override)
      : ((doc.documentType as ExtractableDocType) ?? "other");

    // Mark the row as "in flight" so a concurrent UI poll can show progress.
    await prisma.document.update({
      where: { id: doc.id },
      data: { manuallyVerified: false },
    });

    const bytes = await downloadFile(doc.fileUrl);
    const result = await extractDocument(bytes, doc.mimeType, documentType);

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        documentType: result.documentType as never,
        aiExtractedData: result.data as never,
        aiConfidenceScore: result.confidence,
      },
    });

    return ok({ document: updated, extracted: result.data, confidence: result.confidence });
  },
);
