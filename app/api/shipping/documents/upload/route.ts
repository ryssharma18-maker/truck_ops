import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail, HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/services/storageService";
import { storageKey } from "@/lib/storageKey";
import { enforceRateLimit } from "@/lib/rateLimit";

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

const MAX_BYTES = 15 * 1024 * 1024;

/** Upload a maritime document to Storage and register a ShippingDocument row. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  // Before formData(), because formData() buffers the whole upload in memory.
  await enforceRateLimit("shippingDocumentUpload", user.id);
  const form = await req.formData();

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Missing file", 400);
  if (file.size > MAX_BYTES) return fail("File too large (max 15 MB)", 413, "file_too_large");

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

  const buf = Buffer.from(await file.arrayBuffer());
  const path = storageKey(user.id, "shipping", file.name);
  const fileUrl = await uploadFile(path, buf, file.type || "application/octet-stream");

  const doc = await prisma.shippingDocument.create({
    data: {
      userId: user.id,
      bookingId: parsed.bookingId,
      documentType: parsed.documentType,
      fileName: file.name,
      fileUrl,
      source: "manual_upload",
      extractionStatus: "pending",
    },
  });

  return ok(doc, 201);
});
