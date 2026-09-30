import type { Metadata } from "next";
import { ShieldCheck, ShieldAlert, Clock } from "lucide-react";
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
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compliance | TruckOps AI" };

const DAY = 24 * 60 * 60 * 1000;

/** valid / expiring_soon / expired, derived from the expiry date on the row. */
function deriveStatus(expiryDate: Date | null): "valid" | "expiring_soon" | "expired" {
  if (!expiryDate) return "valid";
  const now = Date.now();
  if (expiryDate.getTime() < now) return "expired";
  if (expiryDate.getTime() < now + 30 * DAY) return "expiring_soon";
  return "valid";
}

export default async function CompliancePage() {
  const user = await requirePageUser();
  const soon = new Date(Date.now() + 30 * DAY);

  const [items, total, expired, expiring] = await Promise.all([
    prisma.complianceDocument.findMany({
      where: { userId: user.id },
      orderBy: [{ expiryDate: "asc" }, { title: "asc" }],
      // Capped; the "Documents" card below uses a real count, because
      // `items.length` was reported as the total and would have read as 200.
      take: 200,
    }),
    prisma.complianceDocument.count({ where: { userId: user.id } }),
    prisma.complianceDocument.count({
      where: { userId: user.id, expiryDate: { lt: new Date() } },
    }),
    prisma.complianceDocument.count({
      where: { userId: user.id, expiryDate: { gte: new Date(), lte: soon } },
    }),
  ]);

  const rows = items
    .map((item) => ({ ...item, derived: deriveStatus(item.expiryDate) }))
    .sort((a, b) => {
      const rank = { expired: 0, expiring_soon: 1, valid: 2 } as const;
      return rank[a.derived] - rank[b.derived];
    });

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Compliance"
        subtitle="Insurance, authority and licence documents with expiry tracking"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Documents"
          value={total}
          hint={total > items.length ? `showing the ${items.length} nearest expiry` : undefined}
          icon={<ShieldCheck className="h-4 w-4 text-cyan-400" />}
        />
        <StatCard
          label="Expiring ≤30d"
          value={expiring}
          icon={<Clock className="h-4 w-4 text-amber-400" />}
        />
        <StatCard
          label="Expired"
          value={expired}
          icon={<ShieldAlert className="h-4 w-4 text-rose-400" />}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No compliance documents"
          body="Upload your certificate of insurance, W-9 and MC authority to keep renewal dates in one place."
        />
      ) : (
        <DataTable head={["Document", "Type", "Issued", "Expires", "Reminder", "Status"]}>
          {rows.map((item) => (
            <TableRow key={item.id}>
              <td className="px-4 py-3 font-medium text-white">{item.title}</td>
              <Cell>{item.documentType.replace(/_/g, " ")}</Cell>
              <Cell>{formatDate(item.issueDate)}</Cell>
              <Cell>{formatDate(item.expiryDate)}</Cell>
              <Cell>{item.reminderDaysBefore} days before</Cell>
              <td className="px-4 py-3">
                <StatusPill value={item.derived} />
              </td>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
