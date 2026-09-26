"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, LogOut } from "lucide-react";

const input =
  "w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm text-white";
const label = "mb-1 block text-xs text-slate-400";

type Profile = {
  fullName: string;
  companyName: string;
  phone: string;
  dotNumber: string;
  mcNumber: string;
  truckCount: number;
};

/** Carrier profile editor. PATCHes /api/user/profile and refreshes the page. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [form, setForm] = useState<Profile>(profile);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save profile");
        setState("idle");
        return;
      }
      setState("saved");
      router.refresh();
    } catch {
      setError("Network error");
      setState("idle");
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fullName" className={label}>
            Contact name
          </label>
          <input
            id="fullName"
            className={input}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="companyName" className={label}>
            Company / carrier name
          </label>
          <input
            id="companyName"
            className={input}
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className={label}>
            Phone
          </label>
          <input
            id="phone"
            className={input}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="truckCount" className={label}>
            Fleet size
          </label>
          <input
            id="truckCount"
            type="number"
            min={1}
            max={200}
            className={input}
            value={form.truckCount}
            onChange={(e) => setForm({ ...form, truckCount: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dotNumber" className={label}>
            DOT number
          </label>
          <input
            id="dotNumber"
            className={input}
            value={form.dotNumber}
            onChange={(e) => setForm({ ...form, dotNumber: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="mcNumber" className={label}>
            MC number
          </label>
          <input
            id="mcNumber"
            className={input}
            value={form.mcNumber}
            onChange={(e) => setForm({ ...form, mcNumber: e.target.value })}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {state === "saved" ? <p className="text-sm text-emerald-400">Profile saved.</p> : null}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={state === "saving"}
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {state === "saving" ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </form>
  );
}
