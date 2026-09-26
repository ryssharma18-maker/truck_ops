"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";

/**
 * Billing actions for an account that already has a Stripe customer.
 *
 * Changing plan, updating the card and cancelling all happen in Stripe's
 * hosted portal rather than being reimplemented here, so card data never
 * touches this app.
 */
export function BillingActions({ hasCustomer }: { hasCustomer: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = (await res.json()) as { url?: string; error?: string };

      if (!res.ok || !json.url) {
        if (res.status === 401) {
          router.push("/login?next=/dashboard/settings");
          return;
        }
        setError(json.error ?? "Could not open the billing portal.");
        return;
      }
      window.location.href = json.url;
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium text-white">
            <CreditCard className="h-4 w-4 text-slate-500" />
            Manage subscription
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {hasCustomer
              ? "Change plan, update your card, download invoices, or cancel."
              : "No subscription yet. Pick a plan to get started."}
          </p>
        </div>
        {hasCustomer ? (
          <button
            type="button"
            onClick={openPortal}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Billing portal
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/pricing")}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            View plans
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
