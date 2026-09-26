"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

const EMPTY = {
  truckNumber: "",
  make: "",
  model: "",
  year: String(new Date().getFullYear()),
  vin: "",
  licensePlate: "",
  status: "active" as const,
};

const input =
  "w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm text-white placeholder:text-slate-500";
const label = "mb-1 block text-xs text-slate-400";

/**
 * Self-contained "add truck" control. Owns its own open state and refreshes the
 * server-rendered table on success, so the page itself stays a Server
 * Component.
 */
export function AddTruckModal() {
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
      const res = await fetch("/api/trucks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create truck");
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
        className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        <Plus className="h-4 w-4" /> Add truck
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Add truck">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="truckNumber" className={label}>
              Truck number
            </label>
            <input
              id="truckNumber"
              required
              placeholder="TRK-101"
              className={input}
              value={form.truckNumber}
              onChange={(e) => setForm({ ...form, truckNumber: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="make" className={label}>
                Make
              </label>
              <input
                id="make"
                placeholder="Freightliner"
                className={input}
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="model" className={label}>
                Model
              </label>
              <input
                id="model"
                placeholder="Cascadia"
                className={input}
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="year" className={label}>
                Year
              </label>
              <input
                id="year"
                type="number"
                min={1980}
                max={2100}
                className={input}
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="licensePlate" className={label}>
                License plate
              </label>
              <input
                id="licensePlate"
                placeholder="TX-88-1234"
                className={input}
                value={form.licensePlate}
                onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label htmlFor="vin" className={label}>
              VIN
            </label>
            <input
              id="vin"
              placeholder="1FUJGLDR5..."
              className={input}
              value={form.vin}
              onChange={(e) => setForm({ ...form, vin: e.target.value })}
            />
          </div>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded bg-sky-600 p-2 font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
          >
            {loading ? "Saving…" : "Create truck"}
          </button>
        </form>
      </Modal>
    </>
  );
}
