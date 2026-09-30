import type { Metadata } from "next";
import { DollarSign, AlertTriangle, Clock } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { anyConfigured } from "@/lib/env";
import { SendInvoiceButton } from "@/components/SendInvoiceButton";
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
  const canEmail = anyConfigured("RESEND_API_KEY", "SENDGRID_API_KEY");
  const hasFromDomain = Boolean(process.env.OUTBOUND_FROM_EMAIL?.trim());

  const [invoices, open, overdue, outstanding, collected] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId: user.id },
      orderBy: { invoiceDate: "desc" },
      take: 100,
      include: {
        load: { select: { id: true, loadNumber: true } },
        broker: { select: { id: true, companyName: true, email: true } },
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

      {!canEmail ? (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Outbound email is not configured. Set{" "}
          <code className="font-mono">RESEND_API_KEY</code> or{" "}
          <code className="font-mono">SENDGRID_API_KEY</code> to email invoices to
          brokers.
        </p>
      ) : !hasFromDomain ? (
        <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          <code className="font-mono">OUTBOUND_FROM_EMAIL</code> is not set, so
          invoices would go out from a placeholder address that most brokers will
          reject or spam-filter. Set it to a domain you have verified with your
          email provider.
        </p>
      ) : null}

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
          head={["Invoice #", "Load", "Broker", "Issued", "Due", "Total", "Status", ""]}
        >
          {invoices.map((inv) => {
            const isPastDue =
              inv.status !== "paid" && inv.dueDate.getTime() < today.getTime();
            const settled = inv.status === "paid";
            const isReminder = inv.sentAt !== null;
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
                <td className="px-4 py-3">
                  {canEmail ? (
                    <SendInvoiceButton
                      invoiceId={inv.id}
                      brokerEmail={inv.broker?.email ?? null}
                      disabled={settled}
                      variant={isReminder ? "reminder" : "primary"}
                    />
                  ) : null}
                </td>
              </TableRow>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
