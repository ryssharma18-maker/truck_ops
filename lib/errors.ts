/**
 * Canonical HTTP error type for API routes and services.
 *
 * `lib/auth.ts` re-exports it as `ApiError` for backwards compatibility, and
 * `errorResponse()` maps it to a JSON body. Throwing `HttpError` from anywhere
 * inside a handler wrapped by `handle()` / `withAuth()` produces a clean
 * response instead of a 500.
 */
export class HttpError extends Error {
  /**
   * `headers` is merged into the error response by `errorResponse()`. It exists
   * for the cases where a status code alone is not actionable — a 429 without
   * `Retry-After` leaves the client guessing, and a 401 without
   * `WWW-Authenticate` is not spec-compliant. Omit it for everything else.
   */
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 400 — the request body or params failed validation. */
export class ValidationError extends HttpError {
  constructor(message = "Invalid request", code = "validation_error") {
    super(400, message, code);
    this.name = "ValidationError";
  }
}

/** 401 — no valid Supabase session on the request. */
export class UnauthorizedError extends HttpError {
  constructor(message = "Not authenticated") {
    super(401, message, "unauthenticated");
    this.name = "UnauthorizedError";
  }
}

/** 404 — the row does not exist, or does not belong to the caller. */
export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message, "not_found");
    this.name = "NotFoundError";
  }
}

/** 409 — uniqueness or state conflict (e.g. duplicate booking number). */
export class ConflictError extends HttpError {
  constructor(message = "Conflict", code = "conflict") {
    super(409, message, code);
    this.name = "ConflictError";
  }
}
