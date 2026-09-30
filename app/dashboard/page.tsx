import type { Metadata } from "next";
import Link from "next/link";
import {
  Truck,
  Users,
  Route,
  Bell,
  Wrench,
  DollarSign,
  Ship,
  ArrowRight,
  FileText,
} from "lucide-react";
import { Prisma } from "@prisma/client";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shippingSummary } from "@/lib/services/shippingService";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  StatCard,
  StatusPill,
  formatDate,
  formatMoney,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard | TruckOps AI" };

const DAY = 24 * 60 * 60 * 1000;

export default async function DashboardPage() {
  const user = await requirePageUser();
  const userId = user.id;
  const in30 = new Date(Date.now() + 30 * DAY);

  const [
    truckCount,
    activeTrucks,
    maintenanceTrucks,
    driverCount,
    activeTrips,
    unreadAlerts,
    openInvoices,
    outstanding,
    recentLoads,
    pendingExtraction,
    complianceExpiring,
    shipping,
  ] = await Promise.all([
    prisma.truck.count({ where: { userId } }),
    prisma.truck.count({ where: { userId, status: "active" } }),
    prisma.truck.count({ where: { userId, status: "maintenance" } }),
    prisma.driver.count({ where: { userId } }),
    prisma.load.count({ where: { userId, status: { in: ["pending", "in_transit"] } } }),
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.invoice.count({
      where: { userId, status: { in: ["draft", "sent", "submitted_to_factor", "overdue"] } },
    }),
    prisma.invoice.aggregate({
      where: { userId, status: { in: ["sent", "submitted_to_factor", "overdue", "disputed"] } },
      _sum: { totalAmount: true },
    }),
    prisma.load.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        truck: { select: { id: true, truckNumber: true } },
        driver: { select: { id: true, fullName: true } },
        broker: { select: { id: true, companyName: true } },
      },
    }),
    prisma.document.count({ where: { userId, aiExtractedData: { equals: Prisma.DbNull } } }),
    prisma.complianceDocument.count({ where: { userId, expiryDate: { lte: in30 } } }),
    shippingSummary(userId),
  ]);

  return (
    <div className="space-y-8 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Fleet Command Center"
        subtitle={`Welcome back${user.fullName ? `, ${user.fullName}` : ""}. Here is your operation at a glance.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Trucks"
          value={truckCount}
          hint={`${activeTrucks} active · ${maintenanceTrucks} in maintenance`}
          icon={<Truck className="h-4 w-4 text-sky-400" />}
        />
        <StatCard
          label="Drivers"
          value={driverCount}
          icon={<Users className="h-4 w-4 text-cyan-400" />}
        />
        <StatCard
          label="Active loads"
          value={activeTrips}
          icon={<Route className="h-4 w-4 text-emerald-400" />}
        />
        <StatCard
          label="Outstanding receivables"
          value={formatMoney(outstanding._sum.totalAmount?.toNumber() ?? 0)}
          hint={`${openInvoices} open invoice${openInvoices === 1 ? "" : "s"}`}
          icon={<DollarSign className="h-4 w-4 text-amber-400" />}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/dashboard/alerts"
          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700"
        >
          <span className="flex items-center gap-3">
            <Bell className="h-4 w-4 text-rose-400" />
            <span className="text-sm text-slate-300">Unread notifications</span>
          </span>
          <span className="text-lg font-bold text-white">{unreadAlerts}</span>
        </Link>
        <Link
          href="/dashboard/documents"
          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700"
        >
          <span className="flex items-center gap-3">
            <FileText className="h-4 w-4 text-cyan-400" />
            <span className="text-sm text-slate-300">Docs awaiting extraction</span>
          </span>
          <span className="text-lg font-bold text-white">{pendingExtraction}</span>
        </Link>
        <Link
          href="/dashboard/maintenance"
          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700"
        >
          <span className="flex items-center gap-3">
            <Wrench className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-slate-300">Compliance expiring ≤30d</span>
          </span>
          <span className="text-lg font-bold text-white">{complianceExpiring}</span>
        </Link>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Recent loads</h2>
          <Link href="/dashboard/trips" className="text-sm font-medium text-cyan-400 hover:underline">
            View all
          </Link>
        </div>

        {recentLoads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center">
            <p className="font-semibold text-slate-300">No loads yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Upload a rate confirmation in the{" "}
              <Link href="/dashboard/documents" className="text-cyan-400 hover:underline">
                Document Inbox
              </Link>{" "}
              to create your first load.
            </p>
          </div>
        ) : (
          <DataTable head={["Load #", "Broker", "Truck", "Driver", "Pickup", "Rate", "Status"]}>
            {recentLoads.map((load) => (
              <TableRow key={load.id}>
                <td className="px-4 py-3 font-medium text-white">{load.loadNumber}</td>
                <Cell>{load.broker?.companyName ?? "—"}</Cell>
                <Cell>{load.truck?.truckNumber ?? "—"}</Cell>
                <Cell>{load.driver?.fullName ?? "—"}</Cell>
                <Cell>{formatDate(load.pickupDate)}</Cell>
                <Cell>{formatMoney(load.rateAmount.toNumber())}</Cell>
                <td className="px-4 py-3">
                  <StatusPill value={load.status} />
                </td>
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Ship className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Shipping operations</h2>
              <p className="text-sm text-slate-400">
                {shipping.bookings} booking{shipping.bookings === 1 ? "" : "s"} ·{" "}
                {shipping.vessels} vessel{shipping.vessels === 1 ? "" : "s"} ·{" "}
                {shipping.containers} container{shipping.containers === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/shipping"
            className="inline-flex items-center gap-1 text-sm font-medium text-cyan-400 hover:underline"
          >
            Shipping Command <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
