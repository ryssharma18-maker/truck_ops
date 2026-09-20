import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { loginSchema, magicLinkSchema } from "@/lib/validation";
import { ApiError, json, withErrorHandling, serialize } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/login
 *
 * Two modes:
 *   { email, password }  -> password sign-in, sets session cookies
 *   { email, magicLink: true } -> emails a one-time link
 *
 * Both failure paths return the same generic message so this endpoint
 * cannot be used to enumerate which email addresses have accounts.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const raw = await req.json();
  const supabase = await createSupabaseServerClient();

  if (raw?.magicLink === true) {
    const { email } = magicLinkSchema.parse(raw);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    if (error) console.error("[auth] magic link error:", error.message);
    // Always report success — do not reveal whether the account exists.
    return json({ sent: true });
  }

  const body = loginSchema.parse(raw);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error || !data.user) {
    throw new ApiError(401, "Incorrect email or password", "invalid_credentials");
  }

  const profile = await prisma.user.findUnique({ where: { id: data.user.id } });
  return json({ user: profile ? serialize(profile) : null });
});
