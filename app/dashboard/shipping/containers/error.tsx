"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/ui/feedback";

/**
 * Segment-level error boundary.
 *
 * Must be a Client Component: Next passes it a `reset` callback, which is
 * unusable in a Server Component.
 *
 * `error.message` is intentionally not rendered. In development Next prints it
 * and that is the right place for it; in production the message can carry
 * driver or broker names, or a database URL, and this boundary is inside the
 * authenticated area where that would be a disclosure to the wrong person. The
 * digest is logged instead so an operator can correlate it with the server log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] segment error:", error.message, error.digest ?? "");
  }, [error]);

  return (
    <ErrorPanel>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
        >
          Back to dashboard
        </a>
      </div>
    </ErrorPanel>
  );
}
