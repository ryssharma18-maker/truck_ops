import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddBookingModal } from "@/components/AddBookingModal";
import { StatusPill, PageHeader, EmptyState } from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shipping Bookings | TruckOps AI" };

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

export default async function ShippingBookingsPage() {
  const user = await requirePageUser();

  // The pickers in the new-booking form are populated here rather than fetched
  // client-side, so the Server Component stays the only place that touches
  // Prisma. Both lists are already scoped to this tenant.
  const [bookings, bookingCount, vessels, ports] = await Promise.all([
    prisma.shippingBooking.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        vessel: { select: { id: true, name: true } },
        portOfLoading: { select: { id: true, name: true, unlocode: true } },
        portOfDischarge: { select: { id: true, name: true, unlocode: true } },
        _count: { select: { containers: true, documents: true, invoices: true } },
      },
    }),
    // A real count, not `bookings.length`: the query above is capped, so its
    // length is "how many fit on one page" and rendering it as "N bookings"
    // understates a tenant with more than 100.
    prisma.shippingBooking.count({ where: { userId: user.id } }),
    prisma.shippingVessel.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, imoNumber: true },
    }),
    prisma.shippingPort.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, unlocode: true },
    }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Shipping Bookings"
        subtitle={`${bookingCount} booking${bookingCount === 1 ? "" : "s"}${bookingCount > bookings.length ? ` (showing the ${bookings.length} most recent)` : ""}`}
        action={
          <AddBookingModal
            vessels={vessels.map((v) => ({
              id: v.id,
              label: `${v.name} · IMO ${v.imoNumber}`,
            }))}
            ports={ports.map((p) => ({
              id: p.id,
              label: `${p.name} (${p.unlocode})`,
            }))}
          />
        }
      />

      {bookings.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          body="Create a booking to link a shipper, consignee, vessel and ports together."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Booking #</th>
                <th className="px-4 py-3 font-medium">Shipper</th>
                <th className="px-4 py-3 font-medium">Consignee</th>
                <th className="px-4 py-3 font-medium">Vessel</th>
                <th className="px-4 py-3 font-medium">POL</th>
                <th className="px-4 py-3 font-medium">POD</th>
                <th className="px-4 py-3 font-medium">ETD</th>
                <th className="px-4 py-3 font-medium">ETA</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-slate-800/70 transition-colors last:border-0 hover:bg-slate-800/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/shipping/bookings/${b.id}`}
                      className="font-medium text-cyan-400 hover:underline"
                    >
                      {b.bookingNumber}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {b._count.containers} containers · {b._count.documents} docs
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{b.shipperName}</td>
                  <td className="px-4 py-3 text-slate-300">{b.consigneeName}</td>
                  <td className="px-4 py-3 text-slate-300">{b.vessel?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {b.portOfLoading ? (
                      <>
                        {b.portOfLoading.name}
                        <span className="ml-1 text-xs text-slate-500">
                          {b.portOfLoading.unlocode}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {b.portOfDischarge ? (
                      <>
                        {b.portOfDischarge.name}
                        <span className="ml-1 text-xs text-slate-500">
                          {b.portOfDischarge.unlocode}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {b.etd ? dateFmt.format(b.etd) : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {b.eta ? dateFmt.format(b.eta) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill value={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
