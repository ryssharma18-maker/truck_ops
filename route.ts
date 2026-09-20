import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { signupSchema } from "@/lib/validation";
import { ApiError, json, withErrorHandling, serialize } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/signup
 *
 * Creates the Supabase auth user. The `on_auth_user_created` trigger then
 * inserts the matching public.users row with a generated inbox address.
 * We wait briefly for that row so the client gets a complete profile back.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const body = signupSchema.parse(await req.json());
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      data: {
        full_name: body.fullName,
        company_name: body.companyName,
        phone: body.phone ?? "",
        truck_count: body.truckCount,
      },
    },
  });

  if (error) {
    // Supabase returns 400 for "already registered" and for weak passwords.
    throw new ApiError(error.status ?? 400, error.message, "signup_failed");
  }
  if (!data.user) {
    throw new ApiError(500, "Signup returned no user", "signup_failed");
  }

  // The trigger fires in the same transaction as the auth insert, but
  // replication to the read path can lag by a few ms. Poll briefly.
  let profile = null;
  for (let attempt = 0; attempt < 5 && !profile; attempt++) {
    profile = await prisma.user.findUnique({ where: { id: data.user.id } });
    if (!profile) await new Promise((r) => setTimeout(r, 120));
  }

  return json(
    {
      user: profile ? serialize(profile) : { id: data.user.id, email: data.user.email },
      // When email confirmation is ON, session is null until they click the link.
      needsEmailConfirmation: data.session === null,
    },
    201,
  );
});
