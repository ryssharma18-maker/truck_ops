import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail, HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile, withUploadCleanup } from "@/lib/services/storageService";
import { storageKey } from "@/lib/storageKey";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  MAX_UPLOAD_FILE_BYTES,
  parseMultipartFormData,
  readValidatedUpload,
} from "@/lib/uploadSecurity";

export const dynamic = "force-dynamic";

const DOC_TYPES = [
  "bill_of_lading",
  "commercial_invoice",
  "packing_list",
  "certificate_of_origin",
  "customs_declaration",
  "other",
] as const;

const meta = z.object({
  documentType: z.enum(DOC_TYPES),
  bookingId: z.string().uuid().optional(),
});

/** Upload a maritime document to Storage and register a ShippingDocument row. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  await enforceRateLimit("shippingDocumentUpload", user.id);
  const form = await parseMultipartFormData(req);

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Missing file", 400);
  if (file.size > MAX_UPLOAD_FILE_BYTES) return fail("File too large (max 15 MB)", 413, "file_too_large");
  const { bytes, mimeType } = await readValidatedUpload(file);

  const parsed = meta.parse({
    documentType: form.get("documentType") || undefined,
    bookingId: form.get("bookingId") || undefined,
  });

  if (
    parsed.bookingId &&
    !(await prisma.shippingBooking.count({ where: { id: parsed.bookingId, userId: user.id } }))
  ) {
    throw new HttpError(400, "Invalid bookingId");
  }

  const path = storageKey(user.id, "shipping", file.name);
  const fileUrl = await uploadFile(path, bytes, mimeType);

  const doc = await withUploadCleanup(fileUrl, () =>
    prisma.shippingDocument.create({
      data: {
        userId: user.id,
        bookingId: parsed.bookingId,
        documentType: parsed.documentType,
        fileName: file.name,
        fileUrl,
        source: "manual_upload",
        extractionStatus: "pending",
      },
    }),
  );

  return ok(doc, 201);
});
