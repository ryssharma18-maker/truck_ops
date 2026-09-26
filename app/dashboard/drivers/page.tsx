import type { Metadata } from "next";
import { Users, UserCheck } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddDriverModal } from "@/components/AddDriverModal";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  EmptyState,
  StatCard,
  StatusPill,
  formatDate,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Drivers | TruckOps AI" };

export default async function DriversPage() {
  const user = await requirePageUser();

  const [drivers, active, expiringSoon] = await Promise.all([
    prisma.driver.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        assignedTruck: { select: { id: true, truckNumber: true } },
        _count: { select: { loads: true } },
      },
    }),
    prisma.driver.count({ where: { userId: user.id, status: "active" } }),
    prisma.driver.count({
      where: {
        userId: user.id,
        licenseExpiry: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Drivers"
        subtitle={`${drivers.length} driver${drivers.length === 1 ? "" : "s"} on file`}
        action={<AddDriverModal />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total drivers" value={drivers.length} icon={<Users className="h-4 w-4 text-sky-400" />} />
        <StatCard label="Active" value={active} icon={<UserCheck className="h-4 w-4 text-emerald-400" />} />
        <StatCard
          label="License expiring ≤30d"
          value={expiringSoon}
          hint="Renew to stay compliant"
        />
      </div>

      {drivers.length === 0 ? (
        <EmptyState
          title="No drivers registered yet"
          body="Add your first driver to assign them to trucks and loads."
        />
      ) : (
        <DataTable head={["Name", "Phone", "License", "Expires", "Assigned truck", "Loads", "Status"]}>
          {drivers.map((driver) => (
            <TableRow key={driver.id}>
              <td className="px-4 py-3">
                <div className="font-medium text-white">{driver.fullName}</div>
                {driver.email ? (
                  <div className="text-xs text-slate-500">{driver.email}</div>
                ) : null}
              </td>
              <Cell>{driver.phone ?? "—"}</Cell>
              <Cell>{driver.licenseNumber ?? "—"}</Cell>
              <Cell>{formatDate(driver.licenseExpiry)}</Cell>
              <Cell>{driver.assignedTruck?.truckNumber ?? "—"}</Cell>
              <Cell>{driver._count.loads}</Cell>
              <td className="px-4 py-3">
                <StatusPill value={driver.status} />
              </td>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
