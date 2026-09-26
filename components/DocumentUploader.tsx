"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Sparkles } from "lucide-react";

const DOC_TYPES = [
  "rate_confirmation",
  "bill_of_lading",
  "proof_of_delivery",
  "lumper_receipt",
  "fuel_receipt",
  "insurance_certificate",
  "w9",
  "mc_authority",
  "driver_license",
  "other",
] as const;

const label = "mb-1 block text-xs text-slate-400";
const input =
  "w-full rounded border border-slate-700 bg-slate-800 p-2 text-sm text-white";

/**
 * Uploads a document to Supabase Storage, then kicks off AI extraction on the
 * stored row. The page re-renders from the server when both steps succeed.
 */
export function DocumentUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<string>("rate_confirmation");
  const [busy, setBusy] = useState<"idle" | "uploading" | "extracting">("idle");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ tone: "err", text: "Choose a file first" });
      return;
    }

    setMessage(null);
    try {
      setBusy("uploading");
      const form = new FormData();
      form.set("file", file);
      form.set("documentType", documentType);

      const uploadRes = await fetch("/api/documents/upload", { method: "POST", body: form });
      const uploadBody = (await uploadRes.json().catch(() => null)) as
        | { document?: { id: string }; error?: string }
        | null;

      if (!uploadRes.ok || !uploadBody?.document) {
        setMessage({ tone: "err", text: uploadBody?.error ?? "Upload failed" });
        return;
      }

      setBusy("extracting");
      const extractRes = await fetch(
        `/api/documents/${uploadBody.document.id}/extract?documentType=${documentType}`,
        { method: "POST" },
      );
      if (!extractRes.ok) {
        const body = (await extractRes.json().catch(() => null)) as { error?: string } | null;
        setMessage({
          tone: "err",
          text: `Uploaded, but extraction failed: ${body?.error ?? "unknown error"}`,
        });
        router.refresh();
        return;
      }

      setMessage({ tone: "ok", text: "Uploaded and extracted." });
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setMessage({ tone: "err", text: "Network error — please try again" });
    } finally {
      setBusy("idle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900 p-5"
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="doc-file" className={label}>
            Document (PDF or image, max 15 MB)
          </label>
          <input
            id="doc-file"
            ref={inputRef}
            type="file"
            accept=".pdf,image/*"
            required
            className="w-full text-sm text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-sm file:text-white"
          />
        </div>
        <div className="w-52">
          <label htmlFor="doc-type" className={label}>
            Type
          </label>
          <select
            id="doc-type"
            className={input}
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t} className="bg-slate-900">
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy !== "idle"}
          className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
        >
          {busy === "extracting" ? (
            <Sparkles className="h-4 w-4 animate-pulse" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {busy === "uploading"
            ? "Uploading…"
            : busy === "extracting"
              ? "Extracting…"
              : "Upload & extract"}
        </button>
      </div>
      {message ? (
        <p
          className={`mt-3 text-sm ${message.tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
