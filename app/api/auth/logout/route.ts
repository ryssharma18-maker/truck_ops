import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * Signs the user out server-side so the auth cookies are cleared. The Supabase
 * client normally refreshes these from middleware, but an explicit sign-out
 * avoids a stale session on the next navigation.
 */
export const POST = handle(async (_req: NextRequest) => {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new HttpError(500, "Could not sign out", "logout_failed");
  }
  return ok({ signedOut: true });
});
