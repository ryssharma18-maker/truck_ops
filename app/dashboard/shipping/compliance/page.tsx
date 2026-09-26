import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText, Mail, CheckCircle2 } from "lucide-react";
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
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shipping Compliance | TruckOps AI" };

const DAY = 24 * 60 * 60 * 1000;

export default async function ShippingCompliancePage() {
  const user = await requirePageUser();
  const userId = user.id;
  const in60 = new Date(Date.now() + 60 * DAY);

  const [documents, manifests, expiring, receivedByEmail] = await Promise.all([
    prisma.shippingDocument.count({ where: { userId } }),
    prisma.shippingManifest.count({ where: { userId } }),
    prisma.shippingDocument.findMany({
      where: { userId, expiresAt: { not: null, lte: in60 } },
      orderBy: { expiresAt: "asc" },
      include: { booking: { select: { id: true, bookingNumber: true } } },
    }),
    prisma.shippingDocument.count({ where: { userId, source: "email" } }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Shipping Compliance"
        subtitle="Certificates, manifests and carrier documents with their validity windows"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Documents"
          value={documents}
          icon={<ScrollText className="h-4 w-4 text-sky-400" />}
        />
        <StatCard label="Manifests" value={manifests} />
        <StatCard
          label="Expiring ≤60d"
          value={expiring.length}
          icon={<CheckCircle2 className="h-4 w-4 text-amber-400" />}
        />
        <StatCard
          label="Received by email"
          value={receivedByEmail}
          icon={<Mail className="h-4 w-4 text-cyan-400" />}
        />
      </div>

      {expiring.length === 0 ? (
        <EmptyState
          title="Nothing expiring"
          body="No shipping documents lapse in the next 60 days."
        />
      ) : (
        <DataTable head={["Document", "Type", "Booking", "Expires", "Days left", "Status"]}>
          {expiring.map((doc) => {
            const days = Math.ceil((doc.expiresAt!.getTime() - Date.now()) / DAY);
            const state = days < 0 ? "expired" : days <= 30 ? "expiring_soon" : "valid";
            return (
              <TableRow key={doc.id}>
                <td className="px-4 py-3 font-medium text-white">{doc.fileName}</td>
                <Cell>{doc.documentType.replace(/_/g, " ")}</Cell>
                <Cell>{doc.booking?.bookingNumber ?? "—"}</Cell>
                <Cell>{formatDate(doc.expiresAt)}</Cell>
                <Cell>{days < 0 ? `${Math.abs(days)} days ago` : `${days} days`}</Cell>
                <td className="px-4 py-3">
                  <StatusPill value={state} />
                </td>
              </TableRow>
            );
          })}
        </DataTable>
      )}

      <p className="text-xs text-slate-600">
        Forward carrier certificates to{" "}
        <span className="font-mono text-slate-400">{user.inboxEmail}</span> and they are
        captured automatically, or{" "}
        <Link href="/dashboard/shipping/documents" className="text-cyan-400 hover:underline">
          upload them manually
        </Link>
        .
      </p>
    </div>
  );
}
