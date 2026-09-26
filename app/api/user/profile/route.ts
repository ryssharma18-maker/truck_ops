import type { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { requireUser, serialize } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateProfileSchema } from "@/lib/validation";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET /api/user/profile — the caller's carrier profile. */
export const GET = handle(async () => {
  const user = await requireUser();
  return ok(serialize(user));
});

/** PATCH /api/user/profile — update the carrier profile fields. */
export const PATCH = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const body = updateProfileSchema.parse(await req.json());

  // subscriptionPlan, email and inboxEmail are deliberately not editable here:
  // plan changes go through the Stripe webhook, the rest through Supabase auth.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(body.fullName !== undefined && { fullName: body.fullName }),
      ...(body.companyName !== undefined && { companyName: body.companyName }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.dotNumber !== undefined && { dotNumber: body.dotNumber }),
      ...(body.mcNumber !== undefined && { mcNumber: body.mcNumber }),
      ...(body.truckCount !== undefined && { truckCount: body.truckCount }),
    },
  });

  if (!updated) throw new HttpError(404, "Profile not found", "not_found");
  return ok(serialize(updated));
});
