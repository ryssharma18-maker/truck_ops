import { HttpError } from "@/lib/errors";

const AUTH_FAILURE_CODES = new Set([
  "bad_jwt",
  "invalid_token",
  "session_not_found",
  "refresh_token_not_found",
]);

function property(error: unknown, name: "status" | "code" | "name"): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return name in error ? (error as Record<string, unknown>)[name] : undefined;
}

/** Convert Supabase session-verification failures to safe HTTP errors. */
export function supabaseAuthFailure(error: unknown): HttpError {
  const status = property(error, "status");
  const code = property(error, "code");
  const name = property(error, "name");

  if (
    status === 401 ||
    name === "AuthSessionMissingError" ||
    (typeof code === "string" && AUTH_FAILURE_CODES.has(code))
  ) {
    return new HttpError(401, "Not authenticated", "unauthenticated");
  }
  if (status === 403) {
    return new HttpError(403, "Access denied", "forbidden");
  }

  return new HttpError(
    503,
    "Authentication service is temporarily unavailable",
    "auth_service_unavailable",
  );
}
