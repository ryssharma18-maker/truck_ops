import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Edge middleware: enforces authentication and keeps Supabase auth cookies
 * fresh.
 *
 * This is a first gate, not the only one. Every page calls `requirePageUser()`
 * and every API route calls `requireUser()`, because middleware alone cannot
 * see which tenant a request belongs to — and Prisma connects as the database
 * owner, so it bypasses RLS. Never rely on this file for tenant isolation; it
 * only stops unauthenticated traffic before it reaches a page render.
 */

const PUBLIC_PREFIXES = ["/login", "/signup", "/pricing", "/auth/callback"];

/** Endpoints that authenticate by provider signature, not by session. */
const PUBLIC_API = [
  "/api/auth/signup",
  "/api/webhooks/inbound-email",
  "/api/webhooks/stripe",
];

const isPublic = (pathname: string) =>
  PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
  PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`));

function isDemoMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return (
    !url ||
    url.includes("placeholder") ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Demo/local mode has no real Supabase project, so there is no session to
  // check. Server-side `requireUser()` still gates data access.
  if (isDemoMode()) {
    return NextResponse.next();
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  // Do not skip this: getUser() revalidates the JWT with Supabase Auth and is
  // what triggers the cookie refresh in the `set` callbacks above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const login = new URL("/login", request.url);
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Not authenticated", code: "unauthenticated" },
        { status: 401 },
      );
    }
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. API routes are
     * included on purpose so unauthenticated calls get a 401 envelope rather
     * than a redirect that fetch() cannot follow.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
