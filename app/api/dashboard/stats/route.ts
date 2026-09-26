import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { shippingSummary } from "@/lib/services/shippingService";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/stats — headline counts for the caller's trucking fleet. */
export const GET = handle(async () => {
  const user = await requireUser();
  const userId = user.id;
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalTrucks,
    activeTrucks,
    inMaintenanceTrucks,
    totalDrivers,
    activeDrivers,
    activeTrips,
    deliveredLoads,
    openInvoices,
    overdueInvoices,
    receivables,
    documentsPendingExtraction,
    expiringCompliance,
    shipping,
  ] = await Promise.all([
    prisma.truck.count({ where: { userId } }),
    prisma.truck.count({ where: { userId, status: "active" } }),
    prisma.truck.count({ where: { userId, status: "maintenance" } }),
    prisma.driver.count({ where: { userId } }),
    prisma.driver.count({ where: { userId, status: "active" } }),
    prisma.load.count({ where: { userId, status: { in: ["in_transit", "pending"] } } }),
    prisma.load.count({ where: { userId, status: "delivered" } }),
    prisma.invoice.count({ where: { userId, status: { in: ["draft", "sent", "submitted_to_factor"] } } }),
    prisma.invoice.count({ where: { userId, status: "overdue" } }),
    prisma.invoice.aggregate({
      where: { userId, status: { in: ["sent", "submitted_to_factor", "overdue", "disputed"] } },
      _sum: { totalAmount: true },
    }),
    prisma.document.count({
      where: {
        userId,
        aiExtractedData: { equals: Prisma.DbNull },
        documentType: { not: "other" },
      },
    }),
    prisma.complianceDocument.count({
      where: { userId, expiryDate: { lte: thirtyDaysOut } },
    }),
    shippingSummary(userId),
  ]);

  return ok({
    trucks: { total: totalTrucks, active: activeTrucks, inMaintenance: inMaintenanceTrucks },
    drivers: { total: totalDrivers, active: activeDrivers },
    loads: { active: activeTrips, delivered: deliveredLoads },
    invoices: {
      open: openInvoices,
      overdue: overdueInvoices,
      outstandingAmount: receivables._sum.totalAmount?.toNumber() ?? 0,
    },
    documents: { pendingExtraction: documentsPendingExtraction },
    compliance: { expiringSoon: expiringCompliance },
    shipping,
    generatedAt: now.toISOString(),
  });
});
