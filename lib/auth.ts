import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { HttpError } from "@/lib/errors";

export { HttpError };

// ─── Error class ─────────────────────────────────────────────────────────────

/** Historical name for {@link HttpError}, kept so existing imports keep working. */
export class ApiError extends HttpError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, code);
    this.name = "ApiError";
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Authentication is always real: a Supabase session backed by a `public.users`
 * row. There is no synthetic-user path.
 *
 * If Supabase is not configured we fail closed with a 500 rather than
 * inventing a user. Silently accepting every request as a demo account looks
 * exactly like a working app and is an authentication bypass, so a missing
 * variable has to be loud.
 */
function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Verifies the caller's Supabase session and returns their public.users row.
 */
export async function requireUser(): Promise<User> {
  if (!supabaseConfigured()) {
    throw new ApiError(
      500,
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      "auth_not_configured",
    );
  }

  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const { prisma } = await import("@/lib/prisma");
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new ApiError(401, "Not authenticated", "unauthenticated");
    const user = await prisma.user.findUnique({ where: { id: data.user.id } });
    if (!user)
      throw new ApiError(
        500,
        "Account profile missing. Run supabase/rls-policies.sql to install the auth trigger.",
        "profile_missing",
      );
    return user;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, "Not authenticated", "unauthenticated");
  }
}

/** Higher-order handler: resolves user, catches ApiError, returns JSON. */
export function withAuth<T>(
  handler: (user: User, req: Request, ctx: T) => Promise<Response>,
) {
  return async (req: Request, ctx: T): Promise<Response> => {
    try {
      const user = await requireUser();
      return await handler(user, req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Same wrapper for routes that don't need a session (webhooks, public). */
export function withErrorHandling<T>(
  handler: (req: Request, ctx: T) => Promise<Response>,
) {
  return async (req: Request, ctx: T): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(
      { error: err.message, code: err.code ?? null },
      { status: err.status },
    );
  }
  // Zod validation errors
  if (
    typeof err === "object" &&
    err !== null &&
    "issues" in err
  ) {
    return NextResponse.json(
      { error: "Invalid request", code: "validation_error", issues: (err as { issues: unknown }).issues },
      { status: 422 },
    );
  }
  // Prisma unique constraint
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  ) {
    return NextResponse.json(
      { error: "That record already exists", code: "duplicate" },
      { status: 409 },
    );
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json(
    { error: "Something went wrong", code: "internal_error" },
    { status: 500 },
  );
}

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Prisma Decimal columns don't survive JSON.stringify cleanly.
 * Normalise before returning from an API route.
 */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "object" &&
      v !== null &&
      "toNumber" in v &&
      typeof (v as { toNumber: () => number }).toNumber === "function"
        ? (v as { toNumber: () => number }).toNumber()
        : v,
    ),
  );
}

// ─── Page helper ──────────────────────────────────────────────────────────────

/** For server components/pages: redirect to /login instead of throwing a 500 when logged out. */
export async function requirePageUser(): Promise<User> {
  const { redirect } = await import("next/navigation");
  try {
    return await requireUser();
  } catch (e) {
    const err = e as any;
    const unauth = err?.status === 401 || err?.statusCode === 401 || err?.code === "unauthenticated" || /not authenticated/i.test(String(err?.message ?? ""));
    if (unauth) redirect("/login");
    throw e;
  }
}