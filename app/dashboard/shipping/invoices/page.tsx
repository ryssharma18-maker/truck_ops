import type { Metadata } from "next";
import { Receipt, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { totalsByCurrency, describeTotals } from "@/lib/money";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  StatCard,
  StatusPill,
  EmptyState,
  formatDate,
  formatMoney,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shipping Invoices | TruckOps AI" };

export default async function ShippingInvoicesPage() {
  const user = await requirePageUser();
  const userId = user.id;
  const now = new Date();

  const [invoices, total, outstanding, overdueCount, overdueValue, paidTotal] = await Promise.all([
    prisma.shippingInvoice.findMany({
      where: { userId },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { booking: { select: { id: true, bookingNumber: true } } },
    }),
    prisma.shippingInvoice.count({ where: { userId } }),
    // groupBy, not aggregate: `currency` is free text on this model, so
    // aggregating `amount` would add euros to dollars and report the result as
    // USD. See lib/money.ts.
    prisma.shippingInvoice.groupBy({
      by: ["currency"],
      where: { userId, status: { in: ["sent", "overdue"] } },
      _sum: { amount: true },
    }),
    prisma.shippingInvoice.count({ where: { userId, status: "overdue" } }),
    prisma.shippingInvoice.groupBy({
      by: ["currency"],
      where: { userId, status: "overdue" },
      _sum: { amount: true },
    }),
    prisma.shippingInvoice.groupBy({
      by: ["currency"],
      where: { userId, status: "paid" },
      _sum: { amount: true },
    }),
  ]);

  const outstandingTotals = totalsByCurrency(outstanding);
  const overdueTotals = totalsByCurrency(overdueValue);
  const paidTotals = totalsByCurrency(paidTotal);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Shipping Invoices"
        subtitle="Freight receivables per sailing, from draft through collection"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Invoices"
          value={total}
          hint={total > invoices.length ? `showing the ${invoices.length} most urgent` : undefined}
          icon={<Receipt className="h-4 w-4 text-sky-400" />}
        />
        <StatCard
          label="Outstanding"
          value={outstandingTotals.text}
          hint={outstandingTotals.hint}
          icon={<Clock className="h-4 w-4 text-amber-400" />}
        />
        <StatCard
          label="Overdue"
          value={overdueCount}
          hint={overdueTotals.hint || undefined}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
        />
        <StatCard
          label="Collected"
          value={paidTotals.text}
          hint={paidTotals.hint}
          icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
        />
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No shipping invoices"
          body="Invoices raised against a booking appear here with their collection status."
        />
      ) : (
        <DataTable
          head={["Invoice #", "Booking", "Issued", "Due", "Amount", "Status", "Paid"]}
        >
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <td className="px-4 py-3 font-medium text-white">{inv.invoiceNumber}</td>
              <Cell>{inv.booking?.bookingNumber ?? "—"}</Cell>
              <Cell>{formatDate(inv.issueDate)}</Cell>
              <Cell>{formatDate(inv.dueDate)}</Cell>
              <Cell>{formatMoney(inv.amount.toNumber(), inv.currency)}</Cell>
              <td className="px-4 py-3">
                <StatusPill value={inv.status} />
              </td>
              <Cell>{formatDate(inv.paidAt)}</Cell>
            </TableRow>
          ))}
        </DataTable>
      )}

      {overdueCount > 0 ? (
        <p className="text-xs text-slate-600">
          {overdueCount} invoice          {overdueCount === 1 ? " is" : "s are"} past due — {describeTotals(overdueTotals)}{" "}
          outstanding as of {formatDate(now)}.
        </p>
      ) : null}
    </div>
  );
}
