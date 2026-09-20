'use client';

import Link from 'next/link';
import {
  Truck,
  FileText,
  DollarSign,
  Clock,
  Shield,
  BarChart3,
  CheckCircle,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';

const features = [
  {
    icon: <Truck className="w-7 h-7 text-indigo-400" />,
    title: 'Load Management',
    desc: 'Track every load from dispatch to payment. Real-time status updates, route visibility, and broker communication — all in one place.',
  },
  {
    icon: <FileText className="w-7 h-7 text-indigo-400" />,
    title: 'AI Document Extraction',
    desc: 'Drop rate confirmations, BOLs, and PODs into your inbox. Our AI reads, extracts, and files the data automatically.',
  },
  {
    icon: <DollarSign className="w-7 h-7 text-indigo-400" />,
    title: 'Automated Invoicing',
    desc: 'Generate freight invoices in seconds. Auto-attach PODs, track payment status, and send reminders without lifting a finger.',
  },
  {
    icon: <Clock className="w-7 h-7 text-indigo-400" />,
    title: 'Detention Recovery',
    desc: 'Never lose a detention dollar again. TruckOps AI monitors dwell time, calculates charges, and generates detention invoices automatically.',
  },
  {
    icon: <Shield className="w-7 h-7 text-indigo-400" />,
    title: 'Compliance Vault',
    desc: 'Store and track all licenses, permits, and insurance documents. Get alerts 30 days before anything expires.',
  },
  {
    icon: <BarChart3 className="w-7 h-7 text-indigo-400" />,
    title: 'IFTA Tax Filing',
    desc: 'Automated IFTA quarterly reports. Mileage and fuel data roll up by jurisdiction so your CPA gets clean numbers every quarter.',
  },
];

const pricingTiers = [
  {
    name: 'Trial',
    price: '$0',
    period: '14 days',
    tagline: 'No credit card required',
    color: 'border-slate-700',
    btnClass: 'bg-slate-700 hover:bg-slate-600 text-white',
    features: [
      'Up to 2 trucks',
      '20 document extractions',
      'Basic load tracking',
      'Invoice generation',
      'Email support',
    ],
  },
  {
    name: 'Lite',
    price: '$150',
    period: 'truck / mo',
    tagline: 'For owner-operators & micro fleets',
    color: 'border-slate-700',
    btnClass: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    features: [
      'Up to 5 trucks',
      'Unlimited documents',
      'AI extraction (all types)',
      'Automated invoicing',
      'Compliance vault',
      'Email + chat support',
    ],
  },
  {
    name: 'Pro',
    price: '$299',
    period: 'truck / mo',
    tagline: 'Most popular for growing fleets',
    color: 'border-indigo-500',
    popular: true,
    btnClass: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    features: [
      'Up to 20 trucks',
      'Everything in Lite',
      'IFTA quarterly reports',
      'Detention auto-billing',
      'Priority AI processing',
      'QuickBooks sync',
      'Dedicated onboarding',
    ],
  },
  {
    name: 'Enterprise',
    price: '$499',
    period: 'truck / mo',
    tagline: 'Custom for large fleets',
    color: 'border-slate-700',
    btnClass: 'bg-slate-700 hover:bg-slate-600 text-white',
    features: [
      'Unlimited trucks',
      'Everything in Pro',
      'Custom integrations',
      'Multi-entity support',
      'SLA guarantees',
      'Dedicated account manager',
      'White-glove migration',
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      {/* Nav */}
      <nav className="border-b border-slate-800 sticky top-0 z-50 bg-slate-950/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-400" />
            <span className="text-lg font-bold tracking-tight">TruckOps <span className="text-indigo-400">AI</span></span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <Link href="/login" className="hover:text-white transition-colors">Sign In</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-slate-300 hover:text-white transition-colors hidden md:block">Log In</Link>
            <Link href="/signup" className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-24 pb-32 px-6">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-slate-950 to-slate-950 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-medium px-3 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Now in Beta · Trusted by 200+ carriers
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight tracking-tight mb-6">
            Your AI Back Office<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">for Trucking</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            TruckOps AI handles the paperwork, billing, and compliance for small fleets of&nbsp;1–20&nbsp;trucks — so you can focus on moving freight, not managing files.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-4 rounded-xl transition-all hover:scale-105 shadow-lg shadow-indigo-900/40 text-base"
            >
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-medium px-8 py-4 rounded-xl transition-colors text-base"
            >
              See Demo <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <p className="mt-5 text-xs text-slate-600">No credit card required · 14-day trial · Cancel anytime</p>
        </div>

        {/* Mock Dashboard Preview */}
        <div className="max-w-5xl mx-auto mt-20 relative z-10">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
            <div className="bg-slate-800/60 border-b border-slate-700 px-5 py-3 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500/70" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <span className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="ml-4 text-xs text-slate-500">app.truckops.ai/dashboard</span>
            </div>
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Gross Revenue', value: '$184,250', change: '+12.8%', green: true },
                { label: 'Receivables', value: '$42,680', change: '18 days DSO', green: false },
                { label: 'Detention Recovered', value: '$8,420', change: '+23.4%', green: true },
                { label: 'Active Loads', value: '27', change: '18 in transit', green: true },
              ].map((m) => (
                <div key={m.label} className="bg-slate-800/80 rounded-xl p-4 border border-slate-700">
                  <p className="text-xs text-slate-500 mb-1">{m.label}</p>
                  <p className="text-xl font-bold text-white">{m.value}</p>
                  <p className={`text-xs mt-1 ${m.green ? 'text-green-400' : 'text-amber-400'}`}>{m.change}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6 bg-slate-900/40">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-semibold uppercase tracking-widest mb-3">Platform Features</p>
            <h2 className="text-4xl font-bold text-white mb-4">Everything your fleet needs</h2>
            <p className="text-slate-400 max-w-xl mx-auto">One platform replaces your spreadsheets, email filing, and manual invoicing — purpose-built for small trucking operations.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-slate-900 border border-slate-800 rounded-2xl p-7 hover:border-indigo-800 transition-colors group">
                <div className="w-12 h-12 bg-indigo-950 rounded-xl flex items-center justify-center mb-5 group-hover:bg-indigo-900 transition-colors">
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-400 text-sm font-semibold uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="text-4xl font-bold text-white mb-4">Simple, transparent pricing</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Priced per truck so costs scale with your fleet. No hidden fees, no long-term contracts.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative bg-slate-900 border-2 ${tier.color} rounded-2xl p-7 flex flex-col ${tier.popular ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-950' : ''}`}
              >
                {tier.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-bold px-4 py-1 rounded-full">
                    MOST POPULAR
                  </div>
                )}
                <div className="mb-6">
                  <p className="text-sm font-semibold text-slate-400 mb-1">{tier.name}</p>
                  <div className="flex items-end gap-1 mb-1">
                    <span className="text-4xl font-extrabold text-white">{tier.price}</span>
                    {tier.price !== '$0' && <span className="text-slate-500 text-sm mb-1">/ {tier.period}</span>}
                  </div>
                  {tier.price === '$0' && <p className="text-slate-500 text-sm">{tier.period}</p>}
                  <p className="text-xs text-slate-500 mt-1">{tier.tagline}</p>
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {tier.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm text-slate-300">
                      <CheckCircle className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                      {feat}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={`w-full text-center py-3 rounded-xl text-sm font-semibold transition-colors ${tier.btnClass}`}>
                  {tier.name === 'Trial' ? 'Start Free Trial' : tier.name === 'Enterprise' ? 'Contact Sales' : 'Get Started'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto bg-gradient-to-r from-indigo-900/60 to-purple-900/40 border border-indigo-800 rounded-3xl p-12 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">Ready to run a tighter operation?</h2>
          <p className="text-slate-300 mb-8 max-w-xl mx-auto">Join 200+ carriers already using TruckOps AI to recover more money and spend less time on back-office work.</p>
          <Link href="/signup" className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-4 rounded-xl transition-all hover:scale-105 shadow-lg shadow-indigo-900/50 text-base">
            Start Free Trial <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-white">TruckOps AI</span>
            <span className="text-slate-600 text-sm ml-4">© 2026 TruckOps Inc. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Support</a>
            <Link href="/login" className="hover:text-white transition-colors">Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}