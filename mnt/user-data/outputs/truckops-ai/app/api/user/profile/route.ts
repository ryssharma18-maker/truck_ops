import { prisma } from "@/lib/prisma";
import { updateProfileSchema } from "@/lib/validation";
import { json, serialize, withAuth } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/user/profile */
export const GET = withAuth(async (user) => json(serialize(user)));

/**
 * PUT /api/user/profile
 * Note the explicit `where: { id: user.id }` — the pattern every mutating
 * route in this codebase must follow, since Prisma bypasses RLS.
 */
export const PUT = withAuth(async (user, req) => {
  const body = updateProfileSchema.parse(await req.json());

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: body,
  });

  return json(serialize(updated));
});
