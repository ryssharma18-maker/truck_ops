import type { ReactNode } from "react";

/**
 * Shared presentational primitives for dashboard pages. Server Components —
 * no "use client" here, so pages can query the database directly and pass the
 * result in.
 */

const TONES: Record<string, string> = {
  // trucking
  active: "bg-emerald-500/15 text-emerald-300",
  paid: "bg-emerald-500/15 text-emerald-300",
  delivered: "bg-emerald-500/15 text-emerald-300",
  valid: "bg-emerald-500/15 text-emerald-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  completed: "bg-emerald-500/15 text-emerald-300",
  in_transit: "bg-cyan-500/15 text-cyan-300",
  invoiced: "bg-cyan-500/15 text-cyan-300",
  sent: "bg-cyan-500/15 text-cyan-300",
  submitted_to_factor: "bg-cyan-500/15 text-cyan-300",
  at_sea: "bg-cyan-500/15 text-cyan-300",
  in_transit_ship: "bg-cyan-500/15 text-cyan-300",
  // attention
  pending: "bg-amber-500/15 text-amber-300",
  processing: "bg-amber-500/15 text-amber-300",
  draft: "bg-amber-500/15 text-amber-300",
  maintenance: "bg-amber-500/15 text-amber-300",
  in_port: "bg-amber-500/15 text-amber-300",
  expiring_soon: "bg-amber-500/15 text-amber-300",
  submitted: "bg-amber-500/15 text-amber-300",
  confirmed: "bg-blue-500/15 text-blue-300",
  loaded: "bg-blue-500/15 text-blue-300",
  arrived: "bg-blue-500/15 text-blue-300",
  // bad
  overdue: "bg-rose-500/15 text-rose-300",
  failed: "bg-rose-500/15 text-rose-300",
  expired: "bg-rose-500/15 text-rose-300",
  disputed: "bg-rose-500/15 text-rose-300",
  rejected: "bg-rose-500/15 text-rose-300",
  cancelled: "bg-rose-500/15 text-rose-300",
  error: "bg-rose-500/15 text-rose-300",
  inactive: "bg-slate-500/15 text-slate-300",
  other: "bg-slate-500/15 text-slate-300",
};

const humanize = (v: string) =>
  v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Coloured badge for a Prisma enum value. Unknown values fall back to slate. */
export function StatusPill({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-500">—</span>;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        TONES[value] ?? TONES.other
      }`}
    >
      {humanize(value)}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
      <p className="text-lg font-medium text-slate-300">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function DataTable({
  head,
  children,
}: {
  head: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase text-slate-400">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TableRow({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-slate-800/70 transition-colors last:border-0 hover:bg-slate-800/40">
      {children}
    </tr>
  );
}

export function Cell({ children }: { children: ReactNode }) {
  return <td className="px-4 py-3 text-slate-300">{children}</td>;
}

// Formatting lives in lib/format.ts rather than here, so that non-React code
// (lib/money.ts, the verify scripts) can use it without importing a .tsx. These
// re-exports keep every existing page import working.
export { formatDate, formatMoney } from "@/lib/format";
