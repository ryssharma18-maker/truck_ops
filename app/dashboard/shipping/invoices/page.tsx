import type { Metadata } from "next";
import { Receipt, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  const [invoices, outstanding, overdueCount, overdueValue, paidTotal] = await Promise.all([
    prisma.shippingInvoice.findMany({
      where: { userId },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { booking: { select: { id: true, bookingNumber: true } } },
    }),
    prisma.shippingInvoice.aggregate({
      where: { userId, status: { in: ["sent", "overdue"] } },
      _sum: { amount: true },
    }),
    prisma.shippingInvoice.count({ where: { userId, status: "overdue" } }),
    prisma.shippingInvoice.aggregate({
      where: { userId, status: "overdue" },
      _sum: { amount: true },
    }),
    prisma.shippingInvoice.aggregate({
      where: { userId, status: "paid" },
      _sum: { amount: true },
    }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Shipping Invoices"
        subtitle="Freight receivables per sailing, from draft through collection"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Invoices"
          value={invoices.length}
          icon={<Receipt className="h-4 w-4 text-sky-400" />}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(outstanding._sum?.amount?.toNumber() ?? 0)}
          icon={<Clock className="h-4 w-4 text-amber-400" />}
        />
        <StatCard
          label="Overdue"
          value={overdueCount}
          hint={formatMoney(overdueValue._sum.amount?.toNumber() ?? 0)}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
        />
        <StatCard
          label="Collected"
          value={formatMoney(paidTotal._sum.amount?.toNumber() ?? 0)}
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
          {overdueCount} invoice{overdueCount === 1 ? " is" : "s are"} past due — total{" "}
          {formatMoney(overdueValue._sum.amount?.toNumber() ?? 0)} outstanding as of{" "}
          {formatDate(now)}.
        </p>
      ) : null}
    </div>
  );
}
