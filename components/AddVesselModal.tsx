"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";

const EMPTY = {
  name: "",
  imoNumber: "",
  flag: "",
  vesselType: "",
  capacityTeu: "",
  deadweightTons: "",
  status: "active" as "active" | "in_port" | "at_sea" | "maintenance",
};

const input =
  "w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm text-white placeholder:text-slate-500";
const label = "mb-1 block text-xs text-slate-400";

const STATUSES = [
  ["active", "Active"],
  ["in_port", "In port"],
  ["at_sea", "At sea"],
  ["maintenance", "Maintenance"],
] as const;

/**
 * "Add vessel" control for the maritime vertical. Mirrors AddTruckModal: owns its
 * open state, POSTs, then refreshes the server-rendered table so the page itself
 * stays a Server Component.
 */
export function AddVesselModal() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vessels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Blank optional numeric fields are sent as undefined rather than "",
        // because `z.coerce.number()` turns "" into 0 and would store a
      // zero-capacity vessel instead of an unknown one.
        body: JSON.stringify({
          ...form,
          capacityTeu: form.capacityTeu || undefined,
          deadweightTons: form.deadweightTons || undefined,
          flag: form.flag || undefined,
          vesselType: form.vesselType || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create vessel");
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

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
      >
        New vessel
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Add vessel">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="v-name" className={label}>
              Vessel name <span className="text-rose-400">*</span>
            </label>
            <input
              id="v-name"
              required
              placeholder="MV Atlantic Trader"
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="v-imo" className={label}>
                IMO number <span className="text-rose-400">*</span>
              </label>
              <input
                id="v-imo"
                required
                inputMode="numeric"
                pattern="\d{7}"
                maxLength={7}
                placeholder="7 digits"
                className={input}
                value={form.imoNumber}
                onChange={(e) => setForm({ ...form, imoNumber: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-slate-500">Exactly 7 digits.</p>
            </div>
            <div>
              <label htmlFor="v-flag" className={label}>
                Flag
              </label>
              <input
                id="v-flag"
                placeholder="Panama"
                className={input}
                value={form.flag}
                onChange={(e) => setForm({ ...form, flag: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="v-type" className={label}>
              Vessel type
            </label>
            <input
              id="v-type"
              placeholder="Container ship"
              className={input}
              value={form.vesselType}
              onChange={(e) => setForm({ ...form, vesselType: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="v-teu" className={label}>
                Capacity (TEU)
              </label>
              <input
                id="v-teu"
                type="number"
                min={0}
                className={input}
                value={form.capacityTeu}
                onChange={(e) => setForm({ ...form, capacityTeu: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="v-dwt" className={label}>
                Deadweight (tons)
              </label>
              <input
                id="v-dwt"
                type="number"
                min={0}
                step="0.01"
                className={input}
                value={form.deadweightTons}
                onChange={(e) => setForm({ ...form, deadweightTons: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="v-status" className={label}>
              Status
            </label>
            <select
              id="v-status"
              className={input}
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as typeof form.status })
              }
            >
              {STATUSES.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-rose-400">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded bg-cyan-600 p-2 font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
          >
            {loading ? "Saving…" : "Create vessel"}
          </button>
        </form>
      </Modal>
    </>
  );
}
