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

const DOC_TYPES = ["rate_confirmation", "bill_of_lading", "proof_of_delivery", "lumper_receipt", "fuel_receipt", "insurance_certificate", "w9", "mc_authority", "driver_license", "other"] as const;
const meta = z.object({ documentType: z.enum(DOC_TYPES), loadId: z.string().uuid().optional() });

export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  await enforceRateLimit("documentUpload", user.id);
  const form = await parseMultipartFormData(req);
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Missing file", 400);
  if (file.size > MAX_UPLOAD_FILE_BYTES) return fail("File too large (max 15 MB)", 413, "file_too_large");
  const { bytes, mimeType } = await readValidatedUpload(file);
  const parsed = meta.parse({ documentType: form.get("documentType") || undefined, loadId: form.get("loadId") || undefined });

  if (parsed.loadId && !(await prisma.load.count({ where: { id: parsed.loadId, userId: user.id } }))) {
    throw new HttpError(400, "Invalid loadId");
  }

  const path = storageKey(user.id, "documents", file.name);
  const fileUrl = await uploadFile(path, bytes, mimeType);

  const doc = await withUploadCleanup(fileUrl, () =>
    prisma.document.create({
      data: {
        userId: user.id,
        loadId: parsed.loadId,
        documentType: parsed.documentType,
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        uploadedVia: "manual_upload",
      },
    }),
  );
  return ok(doc, 201);
});