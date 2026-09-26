"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

const EMPTY = {
  fullName: "",
  email: "",
  phone: "",
  licenseNumber: "",
  licenseExpiry: "",
  status: "active" as const,
};

const input =
  "w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm text-white placeholder:text-slate-500";
const label = "mb-1 block text-xs text-slate-400";

/**
 * Self-contained "add driver" control. Owns its own open state and refreshes the
 * server-rendered table on success.
 */
export function AddDriverModal() {
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
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          licenseExpiry: form.licenseExpiry || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not create driver");
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
        <Plus className="h-4 w-4" /> Add driver
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Add driver">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="fullName" className={label}>
              Full name
            </label>
            <input
              id="fullName"
              required
              placeholder="John Doe"
              className={input}
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="driver-email" className={label}>
                Email
              </label>
              <input
                id="driver-email"
                type="email"
                placeholder="john@example.com"
                className={input}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="driver-phone" className={label}>
                Phone
              </label>
              <input
                id="driver-phone"
                placeholder="+1 555-0199"
                className={input}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="licenseNumber" className={label}>
                License number
              </label>
              <input
                id="licenseNumber"
                placeholder="DL-987654321"
                className={input}
                value={form.licenseNumber}
                onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="licenseExpiry" className={label}>
                License expiry
              </label>
              <input
                id="licenseExpiry"
                type="date"
                className={input}
                value={form.licenseExpiry}
                onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })}
              />
            </div>
          </div>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded bg-sky-600 p-2 font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
          >
            {loading ? "Saving…" : "Create driver"}
          </button>
        </form>
      </Modal>
    </>
  );
}
