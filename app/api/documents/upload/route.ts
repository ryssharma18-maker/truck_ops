import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail, HttpError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/services/storageService";
import { storageKey } from "@/lib/storageKey";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const DOC_TYPES = ["rate_confirmation", "bill_of_lading", "proof_of_delivery", "lumper_receipt", "fuel_receipt", "insurance_certificate", "w9", "mc_authority", "driver_license", "other"] as const;
const meta = z.object({ documentType: z.enum(DOC_TYPES), loadId: z.string().uuid().optional() });
const MAX_BYTES = 15 * 1024 * 1024;

export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  // Before formData(), because formData() buffers the whole upload in memory.
  await enforceRateLimit("documentUpload", user.id);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Missing file", 400);
  if (file.size > MAX_BYTES) return fail("File too large (max 15 MB)", 413, "file_too_large");
  const parsed = meta.parse({ documentType: form.get("documentType") || undefined, loadId: form.get("loadId") || undefined });

  if (parsed.loadId && !(await prisma.load.count({ where: { id: parsed.loadId, userId: user.id } }))) {
    throw new HttpError(400, "Invalid loadId");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const path = storageKey(user.id, "documents", file.name);
  const fileUrl = await uploadFile(path, buf, file.type || "application/octet-stream");

  const doc = await prisma.document.create({
    data: {
      userId: user.id,
      loadId: parsed.loadId,
      documentType: parsed.documentType,
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      uploadedVia: "manual_upload",
    },
  });
  return ok(doc, 201);
});