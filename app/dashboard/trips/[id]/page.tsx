import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  PageHeader,
  StatusPill,
  formatDate,
  formatMoney,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Load | TruckOps AI" };

/**
 * One load in full, reached from the trips table and from the "Load" column of
 * the documents list.
 *
 * The tenant boundary is the `where` clause, and a row belonging to another
 * carrier is simply not found, so a guessed id 404s exactly like a nonexistent
 * one. That is the point of scoping by `userId` in the query rather than
 * checking after the fetch: there is no code path where the row is read and
 * then rejected.
 */
export default async function TripDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser();

  const load = await prisma.load.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      truck: { select: { id: true, truckNumber: true, make: true, model: true } },
      driver: { select: { id: true, fullName: true, phone: true } },
      broker: { select: { id: true, companyName: true, email: true } },
      documents: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { createdAt: "desc" } },
      detentionRecords: { orderBy: { startTime: "desc" } },
    },
  });

  if (!load) notFound();

  const charges = [
    ["Booked rate", load.rateAmount.toNumber()],
    ["Fuel surcharge", load.fuelSurcharge.toNumber()],
    ["Detention", load.detentionAmount.toNumber()],
    ["Lumper", load.lumperAmount.toNumber()],
  ] as const;
  const accessorials = charges.slice(1).reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <Link
        href="/dashboard/trips"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All trips
      </Link>

      <PageHeader
        title={load.loadNumber}
        subtitle={`${load.broker?.companyName ?? "No broker"} · ${load.truck?.truckNumber ?? "No truck assigned"}`}
        action={<StatusPill value={load.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Assignment</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Broker" value={load.broker?.companyName ?? "—"} />
            <Row label="Broker contact" value={load.broker?.email ?? "—"} />
            <Row
              label="Truck"
              value={
                load.truck
                  ? `${load.truck.truckNumber} · ${load.truck.make} ${load.truck.model}`
                  : "—"
              }
            />
            <Row label="Driver" value={load.driver?.fullName ?? "—"} />
            <Row label="Driver phone" value={load.driver?.phone ?? "—"} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Stops &amp; schedule</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Shipper" value={load.shipperName ?? "—"} />
            <Row label="Shipper address" value={load.shipperAddress ?? "—"} />
            <Row label="Consignee" value={load.consigneeName ?? "—"} />
            <Row label="Consignee address" value={load.consigneeAddress ?? "—"} />
            <Row label="Pickup" value={formatDate(load.pickupDate)} />
            <Row label="Delivery" value={formatDate(load.deliveryDate)} />
            <Row label="Actual delivery" value={formatDate(load.actualDeliveryDate)} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Freight &amp; money</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Commodity" value={load.commodity ?? "—"} />
            <Row label="Weight" value={load.weightLbs ? `${load.weightLbs.toLocaleString()} lbs` : "—"} />
            <Row label="Pallets" value={load.palletCount ? String(load.palletCount) : "—"} />
            {charges.map(([label, value]) => (
              <Row key={label} label={label} value={formatMoney(value)} />
            ))}
            <Row label="Accessorials" value={formatMoney(accessorials)} />
          </dl>
        </section>
      </div>

      {load.notes ? (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{load.notes}</p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">
            Documents ({load.documents.length})
          </h2>
          {load.documents.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing attached to this load.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {load.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="text-white">{d.fileName}</div>
                    <div className="text-xs text-slate-500">
                      {d.documentType.replace(/_/g, " ")} · {formatDate(d.createdAt)}
                    </div>
                  </div>
                  {/* The trucking Document model has no extractionStatus — that
                      field only exists on ShippingDocument. What it does carry is
                      whether a human has signed off on the AI read. */}
                  {d.manuallyVerified ? (
                    <span className="text-xs font-medium text-emerald-400">Verified</span>
                  ) : d.aiConfidenceScore !== null ? (
                    <span className="text-xs text-slate-500">
                      AI {Math.round(d.aiConfidenceScore * 100)}%
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">Unread</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">
            Invoices ({load.invoices.length})
          </h2>
          {load.invoices.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No invoices raised yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-800">
              {load.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="text-white">{i.invoiceNumber}</div>
                    <div className="text-xs text-slate-500">Due {formatDate(i.dueDate)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Trucking invoices are USD by construction — the Invoice
                        model has no currency column, unlike ShippingInvoice. */}
                    <span className="font-medium text-white">
                      {formatMoney(i.totalAmount.toNumber())}
                    </span>
                    <StatusPill value={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {load.detentionRecords.length > 0 ? (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-300">Detention</h2>
          <ul className="mt-3 divide-y divide-slate-800">
            {load.detentionRecords.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="text-slate-300">{d.reason ?? "Detention"}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(d.startTime)}
                    {d.endTime ? ` – ${formatDate(d.endTime)}` : " · ongoing"}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-white">
                    {formatMoney(d.totalCharge.toNumber())}
                  </span>
                  <StatusPill value={d.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
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
