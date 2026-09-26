import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail, HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/services/storageService";

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
  const form = await req.formData();

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Missing file", 400);
  if (file.size > MAX_BYTES) return fail("File too large (max 15 MB)", 400);

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
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/shipping/${Date.now()}-${safeName}`;
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
