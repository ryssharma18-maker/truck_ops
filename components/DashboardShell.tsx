"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";

/**
 * Client shell for the dashboard: owns the mobile sidebar open/closed state
 * that `components/Sidebar` expects as props. The dashboard layout itself is a
 * Server Component, so the state has to live here.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-50">
      <Sidebar isOpen={isOpen} setIsOpen={setIsOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">TruckOps AI</span>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
