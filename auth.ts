import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

/**
 * WHY THIS FILE MATTERS
 *
 * Prisma talks to Postgres over the direct connection as the database
 * owner, which bypasses Row Level Security. RLS in supabase/rls-policies.sql
 * only protects clients using the anon key (i.e. the browser). So for every
 * Prisma query issued from an API route, tenant isolation is enforced HERE,
 * in application code, by threading `user.id` into the `where` clause.
 *
 * Rule for the whole codebase: no Prisma query on a user-owned table may be
 * written without `userId` in its `where`. Use requireUser() to get it.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Verifies the caller's session against Supabase Auth and returns their
 * `users` row. Throws ApiError(401) if unauthenticated.
 *
 * Uses getUser(), not getSession(): getSession() reads the cookie without
 * validating the JWT signature against the auth server, so it is not
 * trustworthy on the server side.
 */
export async function requireUser(): Promise<User> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new ApiError(401, "Not authenticated", "unauthenticated");
  }

  const user = await prisma.user.findUnique({ where: { id: data.user.id } });

  if (!user) {
    // Auth user exists but the profile row does not — the on_auth_user_created
    // trigger did not run. Surface it loudly instead of silently 401ing.
    throw new ApiError(
      500,
      "Account profile missing. Re-run supabase/rls-policies.sql to install the auth trigger.",
      "profile_missing",
    );
  }

  return user;
}

/**
 * Wraps a route handler: resolves the user, catches ApiError and anything
 * else, and returns consistent JSON. Keeps handlers free of try/catch noise.
 */
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

/** Same wrapper for routes that do not need a session (webhooks, public). */
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

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, code: err.code ?? null },
      { status: err.status },
    );
  }

  // Zod validation errors carry an `issues` array.
  if (typeof err === "object" && err !== null && "issues" in err) {
    return NextResponse.json(
      { error: "Invalid request", code: "validation_error", issues: (err as { issues: unknown }).issues },
      { status: 422 },
    );
  }

  // Prisma unique-constraint violation.
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
    return NextResponse.json(
      { error: "That record already exists", code: "duplicate" },
      { status: 409 },
    );
  }

  console.error("[api] unhandled error:", err);
  return NextResponse.json(
    { error: "Something went wrong on our end", code: "internal_error" },
    { status: 500 },
  );
}

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Decimal columns come back as Prisma.Decimal, which does not survive
 * JSON.stringify cleanly. Normalise before returning from an API route.
 */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "object" && v !== null && "toNumber" in v && typeof v.toNumber === "function"
        ? (v as { toNumber: () => number }).toNumber()
        : v,
    ),
  );
}


/** For server components/pages: redirect to /login instead of throwing a 500 when logged out. */
export async function requirePageUser(): Promise<Awaited<ReturnType<typeof requireUser>>> {
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