import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireUser, serialize } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — the caller's public.users profile. */
export const GET = handle(async (_req: NextRequest) => {
  const user = await requireUser();
  return ok(
    serialize({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      companyName: user.companyName,
      phone: user.phone,
      dotNumber: user.dotNumber,
      mcNumber: user.mcNumber,
      subscriptionPlan: user.subscriptionPlan,
      truckCount: user.truckCount,
      inboxEmail: user.inboxEmail,
    }),
  );
});
