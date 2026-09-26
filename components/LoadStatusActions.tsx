"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEXT_STATUS: Record<string, { to: string; label: string }[]> = {
  pending: [{ to: "in_transit", label: "Mark in transit" }],
  in_transit: [{ to: "delivered", label: "Mark delivered" }],
  delivered: [{ to: "invoiced", label: "Mark invoiced" }],
  invoiced: [{ to: "paid", label: "Mark paid" }],
};

/**
 * Status transition buttons for one load. PATCHes /api/loads/[id] and refreshes
 * the server-rendered list.
 */
export function LoadStatusActions({
  loadId,
  status,
}: {
  loadId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = NEXT_STATUS[status] ?? [];

  if (actions.length === 0) return null;

  async function advance(to: string) {
    setPending(to);
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Update failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {actions.map((a) => (
          <button
            key={a.to}
            type="button"
            disabled={pending !== null}
            onClick={() => advance(a.to)}
            className="rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
          >
            {pending === a.to ? "Saving…" : a.label}
          </button>
        ))}
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </div>
  );
}
