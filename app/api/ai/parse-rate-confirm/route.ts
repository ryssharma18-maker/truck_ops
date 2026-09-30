import type { NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { extractDocument } from "@/lib/services/aiService";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * POST /api/ai/parse-rate-confirm
 *
 * Stateless extraction: parses an uploaded rate confirmation and returns the
 * fields without persisting a Document row. Use /api/documents/upload followed
 * by /api/documents/[id]/extract when the document should be kept.
 *
 * This is the most expensive route in the app: every call is a Gemini request
 * billed to us, and a 15 MB upload is accepted per call. The per-tenant
 * limiter is the only thing between a script and a large bill, so it runs
 * before the body is read.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  await enforceRateLimit("parseRateConfirm", user.id);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file uploaded", 400, "missing_file");
  if (file.size > MAX_BYTES) {
    return fail("File too large (max 15 MB)", 413, "file_too_large");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await extractDocument(
    bytes,
    file.type || "application/pdf",
    "rate_confirmation",
  );

  return ok(result);
});
