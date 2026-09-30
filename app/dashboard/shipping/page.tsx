import type { Metadata } from "next";
import Link from "next/link";
import { Ship, Anchor, Box, FileText, Receipt, ScrollText } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { totalsByCurrency } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shipping Command | TruckOps AI" };

const tiles = [
  { href: "/dashboard/shipping/vessels", label: "Vessel Fleet", icon: Anchor, key: "vessels" },
  { href: "/dashboard/shipping/bookings", label: "Bookings", icon: Ship, key: "bookings" },
  { href: "/dashboard/shipping/containers", label: "Containers", icon: Box, key: "containers" },
  { href: "/dashboard/shipping/documents", label: "Documents", icon: FileText, key: "docsPending" },
  { href: "/dashboard/shipping/invoices", label: "Invoices", icon: Receipt, key: "openInvoices" },
  { href: "/dashboard/shipping/compliance", label: "Compliance", icon: ScrollText, key: "expiringDocs" },
] as const;

export default async function ShippingDashboard() {
  const user = await requirePageUser();
  const userId = user.id;
  // 60 days, to match the window /dashboard/shipping/compliance actually lists.
  // It was 30 here, so the tile showed a smaller number than the page you land
  // on, and the label said nothing about a window at all.
  const soon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  const [
    vessels,
    atSeaVessels,
    bookings,
    activeBookings,
    containers,
    docsPending,
    openInvoices,
    openInvoiceAmount,
    expiringDocs,
    byStatus,
  ] = await Promise.all([
    prisma.shippingVessel.count({ where: { userId } }),
    prisma.shippingVessel.count({ where: { userId, status: "at_sea" } }),
    prisma.shippingBooking.count({ where: { userId } }),
    prisma.shippingBooking.count({
      where: { userId, status: { in: ["confirmed", "loaded", "in_transit", "arrived"] } },
    }),
    prisma.shippingContainer.count({ where: { userId } }),
    prisma.shippingDocument.count({
      where: { userId, extractionStatus: { in: ["pending", "processing"] } },
    }),
    prisma.shippingInvoice.count({ where: { userId, status: { in: ["sent", "overdue"] } } }),
    prisma.shippingInvoice.groupBy({
      by: ["currency"],
      where: { userId, status: { in: ["sent", "overdue"] } },
      _sum: { amount: true },
    }),
    prisma.shippingDocument.count({ where: { userId, expiresAt: { lte: soon } } }),
    prisma.shippingBooking.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } }),
  ]);

  const counts: Record<string, number | string> = {
    vessels,
    bookings,
    containers,
    docsPending,
    openInvoices,
    expiringDocs,
  };

  // Was `_sum.amount` across every open invoice, labelled "$". With more than
  // one currency in play that was euros added to dollars. See lib/money.ts.
  const receivables = totalsByCurrency(openInvoiceAmount);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight text-white">Shipping Command Center</h2>
        <p className="mt-1 text-sm text-slate-400">
          {atSeaVessels} vessel{atSeaVessels === 1 ? "" : "s"} at sea · {activeBookings} active
          booking{activeBookings === 1 ? "" : "s"}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.slice(0, 4).map(({ href, label, icon: Icon, key }) => (
          <Link
            key={key}
            href={href}
            className="rounded-lg border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700"
          >
            <div className="flex items-start justify-between">
              <span className="text-sm font-medium text-slate-400">{label}</span>
              <Icon className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white">{counts[key]}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-300">Bookings by status</h3>
          {byStatus.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No bookings yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {byStatus.map((row) => (
                <li key={row.status} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">
                    {row.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <span className="font-medium text-white">{row._count._all}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-300">Receivables</h3>
          <div className="mt-4 text-2xl font-bold text-white">{receivables.text}</div>
          <p className="mt-1 text-sm text-slate-500">
            {receivables.mixed
              ? `${receivables.hint} · `
              : ""}
            {openInvoices} open shipping invoice{openInvoices === 1 ? "" : "s"} ·{" "}
            <Link href="/dashboard/shipping/invoices" className="text-cyan-400 hover:underline">
              Review
            </Link>
          </p>
          <p className="mt-3 text-sm text-slate-500">
            {expiringDocs} document{expiringDocs === 1 ? "" : "s"} expiring within 60 days ·{" "}
            <Link href="/dashboard/shipping/compliance" className="text-cyan-400 hover:underline">
              Compliance
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
