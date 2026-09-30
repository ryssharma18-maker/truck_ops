import type { Metadata } from "next";
import Link from "next/link";
import { Route, Boxes } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LoadStatusActions } from "@/components/LoadStatusActions";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  EmptyState,
  StatCard,
  StatusPill,
  formatDate,
  formatMoney,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trips | TruckOps AI" };

export default async function TripsPage() {
  const user = await requirePageUser();

  const [loads, total, inTransit, pendingCount, revenue] = await Promise.all([
    prisma.load.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        truck: { select: { id: true, truckNumber: true } },
        driver: { select: { id: true, fullName: true } },
        broker: { select: { id: true, companyName: true } },
        _count: { select: { documents: true, invoices: true } },
      },
    }),
    prisma.load.count({ where: { userId: user.id } }),
    prisma.load.count({ where: { userId: user.id, status: "in_transit" } }),
    prisma.load.count({ where: { userId: user.id, status: "pending" } }),
    prisma.load.aggregate({ where: { userId: user.id }, _sum: { rateAmount: true } }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Trips & Dispatch"
        subtitle="Every load from rate confirmation through proof of delivery"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Loads"
          value={total}
          hint={total > loads.length ? `showing the ${loads.length} most recent` : undefined}
          icon={<Boxes className="h-4 w-4 text-sky-400" />}
        />
        <StatCard label="In transit" value={inTransit} icon={<Route className="h-4 w-4 text-cyan-400" />} />
        <StatCard
          label="Booked rate value"
          value={formatMoney(revenue._sum.rateAmount?.toNumber() ?? 0)}
          hint={`${pendingCount} awaiting pickup`}
        />
      </div>

      {loads.length === 0 ? (
        <EmptyState
          title="No loads yet"
          body="Upload a rate confirmation in the Document Inbox to create your first load."
        />
      ) : (
        <DataTable
          head={["Load #", "Broker", "Truck", "Driver", "Pickup", "Delivery", "Rate", "Status", ""]}
        >
          {loads.map((load) => (
            <TableRow key={load.id}>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/dashboard/trips/${load.id}`}
                      className="text-cyan-400 hover:underline"
                    >
                      {load.loadNumber}
                    </Link>
                  </td>
              <Cell>{load.broker?.companyName ?? "—"}</Cell>
              <Cell>{load.truck?.truckNumber ?? "—"}</Cell>
              <Cell>{load.driver?.fullName ?? "—"}</Cell>
              <Cell>{formatDate(load.pickupDate)}</Cell>
              <Cell>{formatDate(load.deliveryDate)}</Cell>
              <Cell>{formatMoney(load.rateAmount.toNumber())}</Cell>
              <td className="px-4 py-3">
                <StatusPill value={load.status} />
              </td>
              <td className="px-4 py-3">
                <LoadStatusActions loadId={load.id} status={load.status} />
              </td>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
