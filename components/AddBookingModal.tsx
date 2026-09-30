"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";

const input =
  "w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm text-white placeholder:text-slate-500";
const label = "mb-1 block text-xs text-slate-400";

interface Option {
  id: string;
  label: string;
}

const EMPTY = {
  bookingNumber: "",
  shipperName: "",
  consigneeName: "",
  vesselId: "",
  portOfLoadingId: "",
  portOfDischargeId: "",
  etd: "",
  eta: "",
  freightTerms: "",
  commodity: "",
  notes: "",
};

/**
 * "New booking" control.
 *
 * The vessel and port pickers are populated by the Server Component that owns
 * the button, so this stays a pure form island. Both lists are already
 * tenant-scoped on the way in: the API rejects a `vesselId` or `portId` that is
 * not the caller's, so passing one from another carrier fails server-side rather
 * than being trusted here.
 */
export function AddBookingModal({
  vessels,
  ports,
}: {
  vessels: Option[];
  ports: Option[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  // A date input gives "YYYY-MM-DD"; the schema wants a real Date. Sent as an
  // ISO string so `z.coerce.date()` has something unambiguous to parse.
  const toIso = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : undefined);

  // POL and POD must differ, and the usual mistake is setting both to the same
  // port. Warn while typing rather than rejecting on submit.
  const samePort =
    !!form.portOfLoadingId && form.portOfLoadingId === form.portOfDischargeId;

  useEffect(() => {
    if (!isOpen) {
      setForm(EMPTY);
      setError(null);
    }
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (samePort) {
      setError("Port of loading and port of discharge must be different.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingNumber: form.bookingNumber,
          shipperName: form.shipperName,
          consigneeName: form.consigneeName,
          vesselId: form.vesselId || undefined,
          portOfLoadingId: form.portOfLoadingId || undefined,
          portOfDischargeId: form.portOfDischargeId || undefined,
          etd: toIso(form.etd),
          eta: toIso(form.eta),
          freightTerms: form.freightTerms || undefined,
          commodity: form.commodity || undefined,
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create booking");
        return;
      }
      setForm(EMPTY);
      setIsOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  const noOptions = (what: string) => (
    <option value="">No {what} yet — create one first</option>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
      >
        New booking
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="New booking">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="b-number" className={label}>
              Booking number <span className="text-rose-400">*</span>
            </label>
            <input
              id="b-number"
              required
              placeholder="BK-20451"
              className={input}
              value={form.bookingNumber}
              onChange={(e) => setForm({ ...form, bookingNumber: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="b-shipper" className={label}>
                Shipper <span className="text-rose-400">*</span>
              </label>
              <input
                id="b-shipper"
                required
                className={input}
                value={form.shipperName}
                onChange={(e) => setForm({ ...form, shipperName: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="b-consignee" className={label}>
                Consignee <span className="text-rose-400">*</span>
              </label>
              <input
                id="b-consignee"
                required
                className={input}
                value={form.consigneeName}
                onChange={(e) => setForm({ ...form, consigneeName: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="b-vessel" className={label}>
              Vessel
            </label>
            <select
              id="b-vessel"
              className={input}
              value={form.vesselId}
              onChange={(e) => setForm({ ...form, vesselId: e.target.value })}
            >
              <option value="">Unassigned</option>
              {vessels.length === 0
                ? noOptions("vessels")
                : vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="b-pol" className={label}>
                Port of loading
              </label>
              <select
                id="b-pol"
                className={input}
                value={form.portOfLoadingId}
                onChange={(e) => setForm({ ...form, portOfLoadingId: e.target.value })}
              >
                <option value="">Unassigned</option>
                {ports.length === 0
                  ? noOptions("ports")
                  : ports.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
              </select>
            </div>
            <div>
              <label htmlFor="b-pod" className={label}>
                Port of discharge
              </label>
              <select
                id="b-pod"
                className={input}
                value={form.portOfDischargeId}
                onChange={(e) => setForm({ ...form, portOfDischargeId: e.target.value })}
              >
                <option value="">Unassigned</option>
                {ports.length === 0
                  ? noOptions("ports")
                  : ports.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
              </select>
            </div>
          </div>

          {samePort ? (
            <p role="alert" className="text-xs text-amber-400">
              Loading and discharge ports cannot be the same.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="b-etd" className={label}>
                ETD
              </label>
              <input
                id="b-etd"
                type="date"
                className={input}
                value={form.etd}
                onChange={(e) => setForm({ ...form, etd: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="b-eta" className={label}>
                ETA
              </label>
              <input
                id="b-eta"
                type="date"
                className={input}
                value={form.eta}
                onChange={(e) => setForm({ ...form, eta: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="b-terms" className={label}>
                Freight terms
              </label>
              <input
                id="b-terms"
                placeholder="FOB"
                className={input}
                value={form.freightTerms}
                onChange={(e) => setForm({ ...form, freightTerms: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="b-commodity" className={label}>
                Commodity
              </label>
              <input
                id="b-commodity"
                className={input}
                value={form.commodity}
                onChange={(e) => setForm({ ...form, commodity: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="b-notes" className={label}>
              Notes
            </label>
            <textarea
              id="b-notes"
              rows={3}
              className={input}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div aria-live="polite">
            {error ? (
              <p role="alert" className="text-sm text-rose-400">
                {error}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={loading || samePort}
            className="mt-4 w-full rounded bg-cyan-600 p-2 font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
          >
            {loading ? "Saving…" : "Create booking"}
          </button>
        </form>
      </Modal>
    </>
  );
}
