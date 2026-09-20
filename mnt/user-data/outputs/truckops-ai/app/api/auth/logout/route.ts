import { createSupabaseServerClient } from "@/lib/supabase/server";
import { json, withErrorHandling } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/auth/logout — clears the session cookies. */
export const POST = withErrorHandling(async () => {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return json({ ok: true });
});
