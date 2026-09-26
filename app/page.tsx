import Link from "next/link";
import { ArrowRight, FileText, ShieldCheck, Truck, Ship, DollarSign, Anchor } from "lucide-react";

export default function Home() {
  return (
    <div className="bg-slate-950 min-h-screen text-slate-50">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <Truck className="h-6 w-6 text-blue-500" />
              <span className="text-xl font-bold">TruckOps AI</span>
            </div>
            <div className="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-400">
              <Link href="#features" className="hover:text-white transition-colors">Features</Link>
              <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
              <Link href="/login" className="hover:text-white transition-colors">Sign In</Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/dashboard" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Start Free Trial
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-24 pb-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            The AI Back-Office for Modern Logistics.
          </h1>
          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
            TruckOps AI handles the paperwork, billing, and compliance for trucking fleets and maritime shipping operations — so you can focus on moving freight, not managing files.
          </p>
          <div className="flex justify-center gap-4">
            <Link href="/dashboard" className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg text-lg font-semibold flex items-center gap-2 transition-colors">
              Start Free Trial <ArrowRight className="h-5 w-5" />
            </Link>
            <Link href="/pricing" className="bg-slate-800 hover:bg-slate-700 text-white px-8 py-3 rounded-lg text-lg font-semibold transition-colors">
              See Pricing
            </Link>
          </div>
          <p className="text-sm text-slate-500 mt-4">No credit card required · 14-day trial · Cancel anytime</p>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-slate-900/50 border-y border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">One platform for every mode of transport</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">Replace spreadsheets, sticky notes, and late-night paperwork with one intelligent multi-modal platform.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 hover:border-blue-500/50 transition-colors">
              <FileText className="h-10 w-10 text-blue-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">AI Document Inbox</h3>
              <p className="text-slate-400">Forward Rate Cons, BOLs, Commercial Invoices, and Packing Lists. Our AI extracts the data and files it automatically.</p>
            </div>
            <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 hover:border-blue-500/50 transition-colors">
              <DollarSign className="h-10 w-10 text-emerald-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Automated Invoicing</h3>
              <p className="text-slate-400">Generate professional freight and shipping invoices, track detention/demurrage pay, and chase overdue payments automatically.</p>
            </div>
            <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 hover:border-blue-500/50 transition-colors">
              <ShieldCheck className="h-10 w-10 text-amber-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Compliance Vault</h3>
              <p className="text-slate-400">Keep DOT, MC, IMO, insurance, W9s, and customs declarations organized. Get alerts before they expire.</p>
            </div>
            <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 hover:border-blue-500/50 transition-colors">
              <Anchor className="h-10 w-10 text-cyan-500 mb-4" />
              <h3 className="text-xl font-bold mb-2">Fleet & Vessel Tracking</h3>
              <p className="text-slate-400">Real-time visibility for trucks on the road and containers on the water. Geofencing and ETA tracking built-in.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-slate-800 text-center text-slate-500 text-sm">
        <p>© 2026 TruckOps AI. All rights reserved. Multi-Modal Logistics OS.</p>
      </footer>
    </div>
  );
}
