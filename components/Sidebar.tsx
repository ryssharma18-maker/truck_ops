"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Truck,
  Ship,
  Anchor,
  Box,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
  DollarSign,
  Wrench,
  Bell,
  ShieldCheck,
  Receipt,
  ScrollText,
  X,
} from "lucide-react";

const SECTIONS = [
  {
    label: "Trucking",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/dashboard/documents", label: "Document Inbox", icon: FileText },
      { href: "/dashboard/trucks", label: "Trucks", icon: Truck },
      { href: "/dashboard/drivers", label: "Drivers", icon: Users },
      { href: "/dashboard/trips", label: "Trips", icon: Box },
      { href: "/dashboard/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/dashboard/invoices", label: "Invoices", icon: DollarSign },
      { href: "/dashboard/compliance", label: "Compliance", icon: ShieldCheck },
      { href: "/dashboard/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    label: "Shipping",
    items: [
      { href: "/dashboard/shipping", label: "Shipping Command", icon: Ship },
      { href: "/dashboard/shipping/vessels", label: "Vessels", icon: Anchor },
      { href: "/dashboard/shipping/bookings", label: "Bookings", icon: Box },
      { href: "/dashboard/shipping/containers", label: "Containers", icon: Box },
      { href: "/dashboard/shipping/documents", label: "Shipping Docs", icon: FileText },
      { href: "/dashboard/shipping/invoices", label: "Shipping Invoices", icon: Receipt },
      { href: "/dashboard/shipping/compliance", label: "Shipping Compliance", icon: ScrollText },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/dashboard/settings", label: "Settings", icon: Settings }],
  },
] as const;

export function Sidebar({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {isOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 h-screen w-64 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900 transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-6">
          <span className="flex items-center gap-2 text-xl font-bold text-white">
            <Truck className="h-5 w-5 text-sky-400" /> TruckOps AI
          </span>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close navigation"
            className="text-slate-400 hover:text-white md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-6 p-4">
          {SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {section.label}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                        active
                          ? "bg-sky-600 font-medium text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
