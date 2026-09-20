import { NextResponse } from "next/server";
import type { User } from "@prisma/client";

// ─── Error class ─────────────────────────────────────────────────────────────

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

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Verifies the caller's Supabase session and returns their public.users row.
 * In demo mode (no real Supabase credentials) returns a synthetic demo user
 * so API routes can operate without a live database.
 */
export async function requireUser(): Promise<User> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isDemo =
    !url || url.includes("placeholder") || process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  if (isDemo) {
    // Return a synthetic demo user that satisfies the Prisma User type shape.
    return demoUser();
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
  if (err instanceof ApiError) {
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

// ─── Demo user ────────────────────────────────────────────────────────────────

function demoUser(): User {
  return {
    id: "d0000000-0000-0000-0000-000000000001",
    email: "demo@truckops.ai",
    fullName: "Marcus Vance",
    companyName: "Rolling Pines Transport LLC",
    phone: "+1 (555) 014-2889",
    dotNumber: "3842119",
    mcNumber: "MC-998231",
    stripeCustomerId: null,
    subscriptionPlan: "trial",
    truckCount: 3,
    inboxEmail: "fleet-rollingpines@inbox.truckops.ai",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date(),
  } as User;
}

