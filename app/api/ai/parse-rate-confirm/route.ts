import type { NextRequest } from "next/server";
import { handle, ok, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { extractDocument } from "@/lib/services/aiService";
import { enforceRateLimit } from "@/lib/rateLimit";
import { parseMultipartFormData, readValidatedUpload } from "@/lib/uploadSecurity";

export const dynamic = "force-dynamic";

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
 * before the body is read. The application also counts the request stream
 * before parsing multipart data; the per-file limit is checked immediately
 * after parsing and is not an upstream ingress limit.
 */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  await enforceRateLimit("parseRateConfirm", user.id);

  const form = await parseMultipartFormData(req);
  const file = form.get("file");
  if (!(file instanceof File)) return fail("No file uploaded", 400, "missing_file");
  const { bytes, mimeType } = await readValidatedUpload(file);

  const result = await extractDocument(
    bytes,
    mimeType,
    "rate_confirmation",
  );

  return ok(result);
});
