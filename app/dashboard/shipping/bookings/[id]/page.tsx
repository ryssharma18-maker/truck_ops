import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { bookingDetailForPage } from "@/lib/services/shippingService";
import {
  PageHeader,
  StatusPill,
  EmptyState,
  formatDate,
  formatMoney,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking | TruckOps AI" };

/**
 * One shipping booking in full.
 *
 * `bookingDetail` scopes on `{ id, userId }` and throws 404, which `notFound()`
 * turns into the segment's not-found boundary. Another carrier's booking id is
 * therefore indistinguishable from a random one, and the row is never read.
 */
export default async function BookingDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser();

  const booking = await bookingDetailForPage(user.id, params.id);
  if (!booking) notFound();

  const containers = booking.containers;
  const invoiceTotals = new Map<string, number>();
  for (const inv of booking.invoices) {
    const code = inv.currency.trim() || "???";
    invoiceTotals.set(code, (invoiceTotals.get(code) ?? 0) + inv.amount.toNumber());
  }

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <Link
        href="/dashboard/shipping/bookings"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All bookings
      </Link>

      <PageHeader
        title={booking.bookingNumber}
        subtitle={`${booking.shipperName} → ${booking.consigneeName}`}
        action={<StatusPill value={booking.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Parties</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Shipper" value={booking.shipperName} />
            <Row label="Consignee" value={booking.consigneeName} />
            <Row label="Freight terms" value={booking.freightTerms ?? "—"} />
            <Row label="Commodity" value={booking.commodity ?? "—"} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Routing</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row
              label="Vessel"
              value={
                booking.vessel
                  ? `${booking.vessel.name} (IMO ${booking.vessel.imoNumber})`
                  : "Unassigned"
              }
            />
            <Row label="Port of loading" value={portLabel(booking.portOfLoading)} />
            <Row label="Port of discharge" value={portLabel(booking.portOfDischarge)} />
            <Row label="ETD" value={formatDate(booking.etd)} />
            <Row label="ETA" value={formatDate(booking.eta)} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">On this booking</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Containers" value={String(containers.length)} />
            <Row label="Manifests" value={String(booking.manifests.length)} />
            <Row label="Documents" value={String(booking.documents.length)} />
            <Row label="Invoices" value={String(booking.invoices.length)} />
            {/* Per-currency, not a single number: see lib/money.ts. */}
            <Row
              label="Invoiced"
              value={
                invoiceTotals.size === 0
                  ? "—"
                  : [...invoiceTotals.entries()]
                      .map(([code, total]) => formatMoney(total, code))
                      .join(" + ")
              }
            />
          </dl>
        </section>
      </div>

      {booking.notes ? (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{booking.notes}</p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Containers</h2>
          {containers.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No containers assigned yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {containers.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-white">{c.containerNumber}</div>
                    <div className="text-xs text-slate-500">
                      {c.size.replace(/^ft/, "ft")} · {c.type}
                      {c.sealNumber ? ` · seal ${c.sealNumber}` : ""}
                    </div>
                  </div>
                  {c.weightKg ? (
                    <span className="text-slate-400">
                      {c.weightKg.toNumber().toLocaleString()} kg
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Manifests</h2>
          {booking.manifests.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No manifests filed.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {booking.manifests.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-white">{m.manifestNumber}</div>
                    <div className="text-xs text-slate-500">Filed {formatDate(m.createdAt)}</div>
                  </div>
                  <StatusPill value={m.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Documents</h2>
          {booking.documents.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No documents on file.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {booking.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="text-white">{d.fileName}</div>
                    <div className="text-xs text-slate-500">{formatDate(d.createdAt)}</div>
                  </div>
                  <StatusPill value={d.extractionStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Invoices</h2>
          {booking.invoices.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing billed yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {booking.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-white">{i.invoiceNumber}</div>
                    <div className="text-xs text-slate-500">Due {formatDate(i.dueDate)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-white">
                      {formatMoney(i.amount.toNumber(), i.currency)}
                    </span>
                    <StatusPill value={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {containers.length === 0 && booking.manifests.length === 0 ? (
        <EmptyState
          title="Nothing attached yet"
          body="Containers, manifests and documents linked to this booking will appear here."
        />
      ) : null}
    </div>
  );
}

function portLabel(port: { name: string; unlocode: string } | null) {
  return port ? `${port.name} (${port.unlocode})` : "Unassigned";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="truncate text-right font-medium text-white" title={value}>
        {value}
      </dd>
    </div>
  );
}
