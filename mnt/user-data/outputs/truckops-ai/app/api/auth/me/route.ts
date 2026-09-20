import { prisma } from "@/lib/prisma";
import { json, serialize, withAuth } from "@/lib/auth";

export const runtime = "nodejs";

/** GET /api/auth/me — current profile plus a light subscription summary. */
export const GET = withAuth(async (user) => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return json(
    serialize({
      user,
      subscription,
      inboxEmail: user.inboxEmail,
    }),
  );
});
