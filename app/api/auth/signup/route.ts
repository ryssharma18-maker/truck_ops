import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { signupSchema } from "@/lib/validation";
import { ApiError, json, withErrorHandling, serialize } from "@/lib/auth";
import {
  isDuplicateSignupUser,
  waitForProvisionedProfile,
} from "@/lib/authProvisioning";
import { clientIp, enforceRateLimit } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/auth/signup
 *
 * Creates the Supabase auth user. The `on_auth_user_created` trigger then
 * inserts the matching public.users row with a generated inbox address.
 * We wait for that row so the client only gets success with a complete profile.
 *
 * Rate limited per IP because this is the one write endpoint reachable without
 * a session, and each call creates a real auth user and a real public.users row.
 * Supabase applies its own limits to the auth call, but not to the row.
 *
 * Sign-in deliberately has no equivalent here: the login page calls
 * supabase.auth.signInWithPassword from the browser, so there is no server
 * route to limit. Rate limiting sign-in attempts needs either a server-side
 * auth route or Supabase's own rate limits, not a policy in lib/rateLimit.ts.
 */
export const POST = withErrorHandling(async (req: Request) => {
  await enforceRateLimit("signup", clientIp(req as NextRequest));
  const body = signupSchema.parse(await req.json());
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      data: {
        full_name: body.fullName ?? "",
        company_name: body.companyName ?? "",
        phone: body.phone ?? "",
        truck_count: body.truckCount,
      },
    },
  });

  if (error) {
    const serviceFailure = (error.status ?? 0) >= 500 || error.status === 429;
    console.warn("[signup] Supabase rejected account creation", {
      status: error.status,
      code: error.code,
    });
    throw new ApiError(
      error.status === 403 ? 403 : serviceFailure ? 503 : 400,
      serviceFailure
        ? "Signup service is temporarily unavailable"
        : error.status === 403
          ? "Account creation is not permitted"
          : "Unable to create an account with the supplied details",
      serviceFailure ? "signup_service_unavailable" : "signup_failed",
    );
  }
  const authUser = data.user;
  if (!authUser) {
    throw new ApiError(503, "Signup service is temporarily unavailable", "signup_service_unavailable");
  }
  if (isDuplicateSignupUser(authUser)) {
    throw new ApiError(
      400,
      "Unable to create an account with the supplied details",
      "signup_failed",
    );
  }

  // The auth trigger is the sole profile creator. Never report success until
  // that idempotently provisioned row is available to authenticated requests.
  const profile = await waitForProvisionedProfile(() =>
    prisma.user.findUnique({ where: { id: authUser.id } }),
  );

  return json(
    {
      user: serialize(profile),
      // When email confirmation is ON, session is null until they click the link.
      needsEmailConfirmation: data.session === null,
    },
    201,
  );
});
