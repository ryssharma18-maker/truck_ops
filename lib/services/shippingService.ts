import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/errors";

const DAY = 86400000;

export async function shippingSummary(userId: string) {
  const soon = new Date(Date.now() + 30 * DAY);
  const [vessels, bookings, containers, docsPending, expiringDocs, byStatus] =
    await Promise.all([
      prisma.shippingVessel.count({ where: { userId } }),
      prisma.shippingBooking.count({ where: { userId } }),
      prisma.shippingContainer.count({ where: { userId } }),
      prisma.shippingDocument.count({
        where: { userId, extractionStatus: { in: ["pending", "processing"] } },
      }),
      prisma.shippingDocument.count({
        where: { userId, expiresAt: { lte: soon } },
      }),
      prisma.shippingBooking.groupBy({
        by: ["status"],
        where: { userId },
        _count: { _all: true },
      }),
    ]);
  return {
    vessels,
    bookings,
    containers,
    docsPending,
    expiringDocs,
    bookingsByStatus: Object.fromEntries(
      byStatus.map((r) => [r.status, r._count._all]),
    ),
  };
}

export async function bookingDetail(userId: string, id: string) {
  const b = await prisma.shippingBooking.findFirst({
    where: { id, userId },
    include: {
      vessel: true,
      portOfLoading: true,
      portOfDischarge: true,
      containers: true,
      manifests: true,
      invoices: true,
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!b) throw new HttpError(404, "Booking not found");
  return b;
}
