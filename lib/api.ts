import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/auth";

export { HttpError } from "@/lib/errors";
export type { HttpError as HttpErrorType } from "@/lib/errors";

/** 200/201 JSON success envelope. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Client-error envelope. Prefer `throw new HttpError(...)` for anything that
 * should abort the handler; use `fail()` when you want to return early.
 */
export function fail(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json({ error: message, code: code ?? null }, { status });
}

/**
 * Wraps a route handler so thrown `HttpError`s, Zod failures and Prisma
 * unique-constraint violations become tidy JSON responses instead of 500s.
 *
 * The handler is responsible for its own auth — call `requireUser()` (or the
 * `withAuth` wrapper in lib/auth) and scope every query by the returned
 * `user.id`. Prisma connects as the database owner and bypasses RLS, so
 * user-scoping in the query is the only thing enforcing tenant isolation.
 */
export function handle<Ctx = unknown>(
  fn: (req: NextRequest, ctx: Ctx) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
