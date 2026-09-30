"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sends an invoice to its broker by email.
 *
 * POSTs to /api/invoices/[id]/send and refreshes the server-rendered table.
 * The button is hidden entirely when there is nothing to send: no broker, no
 * broker email, or the invoice is already paid.
 */
export function SendInvoiceButton({
  invoiceId,
  brokerEmail,
  disabled = false,
  label = "Email invoice",
  variant = "primary",
}: {
  invoiceId: string;
  brokerEmail: string | null;
  disabled?: boolean;
  label?: string;
  variant?: "primary" | "reminder";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (disabled || !brokerEmail) return null;

  async function send() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!res.ok) {
        setError(body?.error ?? "Send failed");
        return;
      }

      setDone(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setPending(false);
    }
  }

  const isReminder = variant === "reminder";
  const base = isReminder
    ? "border border-sky-700 text-sky-300 hover:bg-sky-950"
    : "bg-sky-600 text-white hover:bg-sky-500";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={send}
        title={`Send to ${brokerEmail}`}
        className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${base}`}
      >
        {pending ? "Sending…" : done ? "Sent" : isReminder ? "Send reminder" : label}
      </button>
      {/* The button label changes to "Sent", which is the success signal, but
          that is not reliably announced. This region is always present so the
          error text appearing inside it is. */}
      <div aria-live="polite" aria-atomic="true" className="max-w-[16rem] text-right">
        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      </div>
    </div>
  );
}
