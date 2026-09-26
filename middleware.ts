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

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Fail closed when Supabase is not configured. Returning `next()` here would
  // let every request past this gate; requireUser() would still reject them, so
  // this only decides whether the failure surfaces as a redirect or a 500.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Supabase is not configured",
          code: "auth_not_configured",
        },
        { status: 500 },
      );
    }
    return new NextResponse("Supabase is not configured", { status: 500 });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
