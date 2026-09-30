import type { Metadata } from "next";
import { ScrollText, Sparkles, Mail } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ShippingDocUploader } from "@/components/ShippingDocUploader";
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
export const metadata: Metadata = { title: "Shipping Documents | TruckOps AI" };

function confidenceLabel(c: number | null) {
  if (c === null) return "—";
  if (c >= 0.8) return `${Math.round(c * 100)}% · high`;
  if (c >= 0.5) return `${Math.round(c * 100)}% · review`;
  return `${Math.round(c * 100)}% · low`;
}

export default async function ShippingDocsPage() {
  const user = await requirePageUser();
  const userId = user.id;

  const [documents, total, bookings, pending, completed] = await Promise.all([
    prisma.shippingDocument.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { booking: { select: { id: true, bookingNumber: true } } },
    }),
    prisma.shippingDocument.count({ where: { userId } }),
    prisma.shippingBooking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, bookingNumber: true },
    }),
    prisma.shippingDocument.count({
      where: { userId, extractionStatus: { in: ["pending", "processing"] } },
    }),
    prisma.shippingDocument.count({ where: { userId, extractionStatus: "completed" } }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Shipping Documents"
        subtitle="Bills of lading, commercial invoices and packing lists read by AI on arrival"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Documents"
          value={total}
          hint={total > documents.length ? `showing the ${documents.length} most recent` : undefined}
          icon={<ScrollText className="h-4 w-4 text-sky-400" />}
        />
        <StatCard
          label="Extraction queued"
          value={pending}
          icon={<Sparkles className="h-4 w-4 text-amber-400" />}
        />
        <StatCard label="Extracted" value={completed} />
      </div>

      <ShippingDocUploader bookings={bookings} />

      {documents.length === 0 ? (
        <EmptyState
          title="No shipping documents yet"
          body={`Upload a bill of lading above, or email carrier paperwork to ${user.inboxEmail} and it is captured automatically.`}
        />
      ) : (
        <DataTable
          head={["File", "Type", "Booking", "Source", "Extraction", "Confidence", "Expires"]}
        >
          {documents.map((doc) => (
            <TableRow key={doc.id}>
              <td className="px-4 py-3 font-medium text-white">{doc.fileName}</td>
              <Cell>{doc.documentType.replace(/_/g, " ")}</Cell>
              <Cell>{doc.booking?.bookingNumber ?? "—"}</Cell>
              <Cell>
                {doc.source === "email" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-cyan-400" />
                    {doc.emailFrom ?? "email"}
                  </span>
                ) : (
                  "Manual upload"
                )}
              </Cell>
              <td className="px-4 py-3">
                <StatusPill value={doc.extractionStatus} />
              </td>
              <Cell>{confidenceLabel(doc.confidence)}</Cell>
              <Cell>{formatDate(doc.expiresAt)}</Cell>
            </TableRow>
          ))}
        </DataTable>
      )}
    </div>
  );
}
