import Link from "next/link";
import { NotFoundPanel } from "@/components/ui/feedback";

/**
 * Segment 404. Reached by a bad URL, and by any row id that is not the
 * caller's — tenant-scoped queries return nothing for another carrier's id, so
 * "not yours" and "does not exist" must look identical.
 */
export default function NotFound() {
  return (
    <NotFoundPanel>
      <Link
        href="/dashboard"
        className="inline-block rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
      >
        Back to dashboard
      </Link>
    </NotFoundPanel>
  );
}
