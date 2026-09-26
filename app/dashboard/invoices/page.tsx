import type { Metadata } from "next";
import { DollarSign, AlertTriangle, Clock } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
export const metadata: Metadata = { title: "Invoices | TruckOps AI" };

const OPEN_STATUSES = ["draft", "sent", "submitted_to_factor", "overdue", "disputed"] as const;

export default async function InvoicesPage() {
  const user = await requirePageUser();

  const [invoices, open, overdue, outstanding, collected] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId: user.id },
      orderBy: { invoiceDate: "desc" },
      take: 100,
      include: {
        load: { select: { id: true, loadNumber: true } },
        broker: { select: { id: true, companyName: true } },
      },
    }),
    prisma.invoice.count({ where: { userId: user.id, status: { in: [...OPEN_STATUSES] } } }),
    prisma.invoice.count({ where: { userId: user.id, status: "overdue" } }),
    prisma.invoice.aggregate({
      where: { userId: user.id, status: { in: [...OPEN_STATUSES] } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { userId: user.id, status: "paid" },
      _sum: { totalAmount: true },
    }),
  ]);

  const today = new Date();

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Invoices"
        subtitle="Receivables, factoring and payment status per load"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Outstanding"
          value={formatMoney(outstanding._sum.totalAmount?.toNumber() ?? 0)}
          icon={<DollarSign className="h-4 w-4 text-cyan-400" />}
        />
        <StatCard label="Open invoices" value={open} />
        <StatCard
          label="Overdue"
          value={overdue}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
        />
        <StatCard
          label="Collected to date"
          value={formatMoney(collected._sum.totalAmount?.toNumber() ?? 0)}
          icon={<Clock className="h-4 w-4 text-emerald-400" />}
        />
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          body="Invoices appear here once a delivered load is invoiced to its broker."
        />
      ) : (
        <DataTable
          head={["Invoice #", "Load", "Broker", "Issued", "Due", "Total", "Status"]}
        >
          {invoices.map((inv) => {
            const isPastDue =
              inv.status !== "paid" && inv.dueDate.getTime() < today.getTime();
            return (
              <TableRow key={inv.id}>
                <td className="px-4 py-3 font-medium text-white">{inv.invoiceNumber}</td>
                <Cell>{inv.load.loadNumber}</Cell>
                <Cell>{inv.broker?.companyName ?? "—"}</Cell>
                <Cell>{formatDate(inv.invoiceDate)}</Cell>
                <td className={isPastDue ? "px-4 py-3 text-rose-300" : "px-4 py-3 text-slate-300"}>
                  {formatDate(inv.dueDate)}
                </td>
                <Cell>{formatMoney(inv.totalAmount.toNumber())}</Cell>
                <td className="px-4 py-3">
                  <StatusPill value={inv.status} />
                </td>
              </TableRow>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
