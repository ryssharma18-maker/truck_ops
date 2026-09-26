import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Sparkles, AlertTriangle } from "lucide-react";
import { Prisma } from "@prisma/client";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DocumentUploader } from "@/components/DocumentUploader";
import {
  DataTable,
  TableRow,
  Cell,
  PageHeader,
  StatCard,
  StatusPill,
  formatDate,
} from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Document Inbox | TruckOps AI" };

/** Flatten the JSON blob Gemini returns into "field: value" pairs for display. */
function extractedPairs(value: Prisma.JsonValue | null): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, Prisma.JsonValue>)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => [
      k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      typeof v === "object" ? JSON.stringify(v) : String(v),
    ]);
}

export default async function DocumentsPage() {
  const user = await requirePageUser();

  const [documents, total, extracted, needsReview] = await Promise.all([
    prisma.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { load: { select: { id: true, loadNumber: true } } },
    }),
    prisma.document.count({ where: { userId: user.id } }),
    prisma.document.count({
      where: { userId: user.id, aiExtractedData: { not: Prisma.DbNull } },
    }),
    prisma.document.count({
      where: { userId: user.id, manuallyVerified: false, aiExtractedData: { not: Prisma.DbNull } },
    }),
  ]);

  return (
    <div className="space-y-6 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Document Inbox"
        subtitle="Upload paperwork and let AI pull out the load details"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Documents" value={total} icon={<FileText className="h-4 w-4 text-cyan-400" />} />
        <StatCard label="AI extracted" value={extracted} icon={<Sparkles className="h-4 w-4 text-emerald-400" />} />
        <StatCard
          label="Awaiting review"
          value={needsReview}
          icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
        />
      </div>

      <DocumentUploader />

      {documents.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
          <p className="text-lg font-medium text-slate-300">No documents yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Upload a rate confirmation or bill of lading to get started.
          </p>
        </div>
      ) : (
        <DataTable head={["File", "Type", "Load", "Uploaded", "Confidence", "Status", "Extracted"]}>
          {documents.map((doc) => {
            const pairs = extractedPairs(doc.aiExtractedData);
            const confidence = doc.aiConfidenceScore;
            return (
              <TableRow key={doc.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{doc.fileName}</div>
                  <div className="text-xs text-slate-500">
                    {(doc.fileSize / 1024).toFixed(0)} KB · {doc.mimeType}
                  </div>
                </td>
                <Cell>{doc.documentType.replace(/_/g, " ")}</Cell>
                <Cell>
                  {doc.load ? (
                    <Link
                      href={`/dashboard/trips/${doc.load.id}`}
                      className="text-cyan-400 hover:underline"
                    >
                      {doc.load.loadNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Cell>
                <Cell>{formatDate(doc.createdAt)}</Cell>
                <Cell>
                  {confidence === null || confidence === undefined
                    ? "—"
                    : `${Math.round(confidence * 100)}%`}
                </Cell>
                <td className="px-4 py-3">
                  <StatusPill
                    value={
                      doc.aiExtractedData ? (doc.manuallyVerified ? "approved" : "pending") : "other"
                    }
                  />
                </td>
                <td className="max-w-sm px-4 py-3 text-xs text-slate-400">
                  {pairs.length === 0 ? (
                    "—"
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-cyan-400">
                        {pairs.length} field{pairs.length === 1 ? "" : "s"}
                      </summary>
                      <dl className="mt-2 space-y-1">
                        {pairs.slice(0, 12).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <dt className="shrink-0 text-slate-500">{k}:</dt>
                            <dd className="truncate text-slate-300">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </td>
              </TableRow>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
