import type { Metadata } from "next";
import Link from "next/link";
import { Wrench, CalendarClock, FileWarning } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  StatCard,
  StatusPill,
  formatDate,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Maintenance | TruckOps AI" };

const DAY = 24 * 60 * 60 * 1000;

/**
 * There is no dedicated maintenance table in the schema, so this view surfaces
 * the signals the fleet already carries: trucks flagged `maintenance`, driver
 * licences expiring, and compliance documents lapsing.
 */
export default async function MaintenancePage() {
  const user = await requirePageUser();
  const in30 = new Date(Date.now() + 30 * DAY);
  const in90 = new Date(Date.now() + 90 * DAY);

  const [shopTrucks, shopTruckCount, licenceExpiring, complianceExpiring, complianceCount] =
    await Promise.all([
      prisma.truck.findMany({
        where: { userId: user.id, status: "maintenance" },
        orderBy: { truckNumber: "asc" },
        // Capped: `shopTrucks.length` was rendered as "Trucks in shop", and an
        // unbounded read is a lot of rows to pull for a maintenance list.
        take: 200,
        include: { _count: { select: { loads: true } } },
      }),
      prisma.truck.count({ where: { userId: user.id, status: "maintenance" } }),
      prisma.driver.findMany({
        where: { userId: user.id, licenseExpiry: { not: null, lte: in90 } },
        orderBy: { licenseExpiry: "asc" },
        // Bounded by the 90-day window and the take below; `upcoming` merges
        // these two lists, so a cap here is what keeps the page predictable.
        take: 200,
        include: { assignedTruck: { select: { truckNumber: true } } },
      }),
      prisma.complianceDocument.findMany({
        where: { userId: user.id, expiryDate: { not: null, lte: in90 } },
        orderBy: { expiryDate: "asc" },
        take: 200,
      }),
      prisma.complianceDocument.count({ where: { userId: user.id } }),
    ]);

  const upcoming = [
    ...licenceExpiring.map((d) => ({
      key: `lic-${d.id}`,
      item: `${d.fullName} — driver licence`,
      expires: d.licenseExpiry!,
      link: "/dashboard/drivers",
    })),
    ...complianceExpiring.map((c) => ({
      key: `doc-${c.id}`,
      item: `${c.title} (${c.documentType.replace(/_/g, " ")})`,
      expires: c.expiryDate!,
      link: "/dashboard/compliance",
    })),
  ].sort((a, b) => a.expires.getTime() - b.expires.getTime());

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Maintenance & Service"
        subtitle="Vehicles in the shop and credentials that need renewing"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Trucks in maintenance"
          value={shopTruckCount}
          icon={<Wrench className="h-4 w-4 text-amber-400" />}
        />
        <StatCard
          label="Licences expiring ≤90d"
          value={licenceExpiring.length}
          hint={
            licenceExpiring.length === 200 ? "showing the first 200" : undefined
          }
          icon={<CalendarClock className="h-4 w-4 text-cyan-400" />}
        />
        <StatCard
          label="Compliance docs tracked"
          value={complianceCount}
          icon={<FileWarning className="h-4 w-4 text-sky-400" />}
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">In the shop</h3>
        {shopTrucks.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
            No trucks are currently flagged for maintenance.
          </p>
        ) : (
          <DataTable head={["Truck #", "Vehicle", "Plate", "Lifetime loads", "Status"]}>
            {shopTrucks.map((truck) => (
              <TableRow key={truck.id}>
                <td className="px-4 py-3 font-medium text-white">{truck.truckNumber}</td>
                <Cell>{[truck.make, truck.model].filter(Boolean).join(" ") || "—"}</Cell>
                <Cell>{truck.licensePlate ?? "—"}</Cell>
                <Cell>{truck._count.loads}</Cell>
                <td className="px-4 py-3">
                  <StatusPill value={truck.status} />
                </td>
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Renewals due within 90 days</h3>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
            Nothing expiring in the next 90 days.
          </p>
        ) : (
          <DataTable head={["Item", "Expires", "Days left", "Status", ""]}>
            {upcoming.map(({ key, item, expires, link }) => {
              const days = Math.ceil((expires.getTime() - Date.now()) / DAY);
              const state =
                days < 0 ? "expired" : days <= 30 ? "expiring_soon" : "valid";
              return (
                <TableRow key={key}>
                  <td className="px-4 py-3 font-medium text-white">{item}</td>
                  <Cell>{formatDate(expires)}</Cell>
                  <Cell>{days < 0 ? `${Math.abs(days)} days ago` : `${days} days`}</Cell>
                  <td className="px-4 py-3">
                    <StatusPill value={state} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={link} className="text-xs text-cyan-400 hover:underline">
                      Review
                    </Link>
                  </td>
                </TableRow>
              );
            })}
          </DataTable>
        )}
      </section>
    </div>
  );
}
