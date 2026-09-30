import type { Metadata } from "next";
import Link from "next/link";
import { Bell, BellOff, ShieldAlert, FileWarning, Receipt } from "lucide-react";
import { Prisma } from "@prisma/client";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader, StatCard, StatusPill, EmptyState, formatDate } from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alerts | TruckOps AI" };

const DAY = 24 * 60 * 60 * 1000;
const TONE = {
  error: "border-rose-500/40 bg-rose-500/5",
  warning: "border-amber-500/40 bg-amber-500/5",
  info: "border-sky-500/40 bg-sky-500/5",
  success: "border-emerald-500/40 bg-emerald-500/5",
} as const;

type Alert = {
  id: string;
  tone: keyof typeof TONE;
  title: string;
  body: string;
  href: string;
  at: Date;
};

/**
 * Derives the operations alert feed from live data rather than a stored
 * notifications table, so it can never go stale. Explicit Notification rows the
 * app has written are merged in at the end.
 */
export default async function AlertsPage() {
  const user = await requirePageUser();
  const userId = user.id;
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * DAY);

  const [
    notifications,
    notificationTotal,
    unreadCount,
    expiringCompliance,
    expiringLicences,
    overdueInvoices,
    unverified,
  ] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    // Real totals, because `notifications` is capped at 20 and counting that
    // array understated the badge. The dashboard tile showed the true unread
    // number from a `count()` while this page showed at most 20, so the same
    // figure read differently depending on where you looked.
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.complianceDocument.findMany({
      where: { userId, expiryDate: { not: null, lte: in30 } },
      orderBy: { expiryDate: "asc" },
      // Capped: these three feed the `alerts` array whose length is the
      // "Open alerts" card, and each one was an unbounded read.
      take: 100,
    }),
    prisma.driver.findMany({
      where: { userId, licenseExpiry: { not: null, lte: in30 } },
      orderBy: { licenseExpiry: "asc" },
      take: 100,
    }),
    prisma.invoice.findMany({
      where: { userId, status: "overdue" },
      orderBy: { dueDate: "asc" },
      take: 100,
      include: { load: { select: { loadNumber: true } } },
    }),
    prisma.document.count({
      where: { userId, manuallyVerified: false, aiExtractedData: { not: Prisma.DbNull } },
    }),
  ]);

  const derived: Alert[] = [
    ...expiringCompliance.map((c) => ({
      id: `compliance-${c.id}`,
      tone: (c.expiryDate && c.expiryDate < now ? "error" : "warning") as Alert["tone"],
      title: c.expiryDate && c.expiryDate < now ? `${c.title} has expired` : `${c.title} expires soon`,
      body: `${c.documentType.replace(/_/g, " ")} — expires ${formatDate(c.expiryDate)}`,
      href: "/dashboard/compliance",
      at: c.expiryDate ?? c.createdAt,
    })),
    ...expiringLicences.map((d) => ({
      id: `licence-${d.id}`,
      tone: (d.licenseExpiry && d.licenseExpiry < now ? "error" : "warning") as Alert["tone"],
      title:
        d.licenseExpiry && d.licenseExpiry < now
          ? `${d.fullName}'s licence has expired`
          : `${d.fullName}'s licence expires soon`,
      body: `Licence ${d.licenseNumber ?? "—"} — expires ${formatDate(d.licenseExpiry)}`,
      href: "/dashboard/drivers",
      at: d.licenseExpiry ?? d.createdAt,
    })),
    ...overdueInvoices.map((i) => ({
      id: `invoice-${i.id}`,
      tone: "error" as const,
      title: `Invoice ${i.invoiceNumber} is overdue`,
      body: `Load ${i.load.loadNumber} — due ${formatDate(i.dueDate)}`,
      href: "/dashboard/invoices",
      at: i.dueDate,
    })),
  ];

  if (unverified > 0) {
    derived.push({
      id: "unverified-docs",
      tone: "info",
      title: `${unverified} extracted document${unverified === 1 ? "" : "s"} awaiting review`,
      body: "Confirm the AI-extracted fields before invoicing.",
      href: "/dashboard/documents",
      at: now,
    });
  }

  const stored: Alert[] = notifications.map((n) => ({
    id: n.id,
    tone: n.type as Alert["tone"],
    title: n.title,
    body: n.message,
    href: n.actionUrl ?? "/dashboard",
    at: n.createdAt,
  }));

  const alerts = [...derived, ...stored].sort((a, b) => b.at.getTime() - a.at.getTime());
  const critical = alerts.filter((a) => a.tone === "error").length;

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Alert Center"
        subtitle="Compliance, collections and document-review signals across your operation"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Open alerts"
          value={alerts.length}
          // `alerts` merges four independently capped queries, so the card is
          // only a true total when none of them hit its take. Say so rather
          // than presenting a truncated merge as the full alert count.
          hint={
            notificationTotal > notifications.length
              ? `notifications: ${notifications.length} of ${notificationTotal} stored`
              : expiringCompliance.length === 100 ||
                expiringLicences.length === 100 ||
                overdueInvoices.length === 100
                ? "compliance, licence and overdue lists are capped at 100 each"
                : undefined
          }
          icon={<Bell className="h-4 w-4 text-cyan-400" />}
        />
        <StatCard
          label="Critical"
          value={critical}
          icon={<ShieldAlert className="h-4 w-4 text-rose-400" />}
        />
        <StatCard
          label="Unread notifications"
          value={unreadCount}
          icon={<BellOff className="h-4 w-4 text-slate-400" />}
        />
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title="All systems normal"
          body="No expiring documents, overdue invoices or unreviewed extractions."
        />
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={`flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4 ${TONE[alert.tone]}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{alert.title}</p>
                <p className="mt-1 text-sm text-slate-400">{alert.body}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill value={alert.tone} />
                <span className="text-xs text-slate-500">{formatDate(alert.at)}</span>
                <Link href={alert.href} className="text-xs text-cyan-400 hover:underline">
                  Review
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-2 text-xs text-slate-600">
        <FileWarning className="h-3 w-3" />
        Alerts are derived from live records on every load — nothing to acknowledge.
        <Receipt className="ml-2 h-3 w-3" />
        Overdue invoices come from the Invoice ledger.
      </p>
    </div>
  );
}
