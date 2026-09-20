import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Demo mode: allow the local application to run without Supabase Auth.
  // Real authentication will be enabled when Supabase is connected.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return response;
  }

  // Do not perform authentication here until the Supabase
  // server client is configured with real credentials.
  //
  // Production authentication will be added during the
  // database/authentication phase.

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};