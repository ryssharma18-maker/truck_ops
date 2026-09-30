import type { ReactNode } from "react";

/**
 * Skeleton and fallback primitives for route-segment boundaries.
 *
 * `loading.tsx` and `error.tsx` files are Server Components by default, so
 * nothing here may be a client component. They must also not import anything
 * that touches the database — an error boundary that queries the database while
 * the database is the thing that failed is worse than no boundary at all.
 */

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading"
      className="space-y-6"
    >
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-80 animate-pulse rounded bg-slate-800/60" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-800 bg-slate-900" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-slate-800/70" />
        ))}
      </div>
    </div>
  );
}

/**
 * Shown when a segment fails. Deliberately says what happened and offers a
 * retry rather than rendering a stack trace: a database timeout on a carrier's
 * dashboard is an operational event, not a developer-facing one.
 */
export function ErrorPanel({
  title = "Something went wrong",
  body = "We could not load this page. This is usually temporary.",
  children,
}: {
  title?: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-8">
      <h2 className="text-lg font-semibold text-rose-200">{title}</h2>
      <p className="mt-2 max-w-prose text-sm text-rose-300/80">{body}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** 404 content, shared by not-found.tsx files so they look the same everywhere. */
export function NotFoundPanel({
  title = "Not found",
  body = "That page does not exist, or you do not have access to it.",
  children,
}: {
  title?: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
      <p className="text-4xl font-bold text-slate-700">404</p>
      <p className="mt-3 text-lg font-medium text-slate-300">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{body}</p>
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

// There is deliberately no retry button in this file. `error.tsx` boundaries are
// required by Next to be Client Components (they receive an onClick-able reset),
// so the button belongs in the boundary itself rather than in a server-safe
// module that would then need "use client" and stop being reusable here.
