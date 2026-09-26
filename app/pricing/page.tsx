"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Truck } from "lucide-react";

interface Plan {
  id: "trial" | "lite" | "pro" | "enterprise";
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  highlight: boolean;
}

const PLANS: Plan[] = [
  {
    id: "trial",
    name: "Trial",
    price: "$0",
    period: "14 days",
    description: "Perfect for testing the platform.",
    features: ["Up to 2 trucks", "20 document extractions", "Basic load tracking", "Invoice generation", "Email support"],
    cta: "Start Free Trial",
    highlight: false,
  },
  {
    id: "lite",
    name: "Lite",
    price: "$150",
    period: "/ truck / mo",
    description: "For owner-operators & micro fleets.",
    features: ["Up to 5 trucks", "Unlimited documents", "AI extraction (all types)", "Automated invoicing", "Compliance vault", "Email + chat support"],
    cta: "Get Started",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$299",
    period: "/ truck / mo",
    description: "Most popular for growing fleets.",
    features: ["Up to 20 trucks", "Everything in Lite", "Detention tracking", "IFTA fuel tax prep", "Payment chasing", "Priority support"],
    cta: "Get Started",
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "$499",
    period: "/ truck / mo",
    description: "Custom for large fleets.",
    features: ["Unlimited trucks", "Everything in Pro", "Dedicated account manager", "Custom integrations", "API access", "SLA guarantee"],
    cta: "Contact Sales",
    highlight: false,
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(plan: Plan) {
    setError(null);

    // The trial and Enterprise are handled by a person, not a checkout.
    if (plan.id === "trial") {
      router.push("/signup");
      return;
    }
    if (plan.id === "enterprise") {
      router.push("mailto:sales@truckops.ai?subject=Enterprise%20plan");
      return;
    }

    setBusy(plan.id);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.id, truckCount: 1 }),
      });

      const json = (await res.json()) as { url?: string; error?: string };

      if (!res.ok || !json.url) {
        // 401 means the session is gone; send them to log in rather than
        // showing a billing error for what is an auth problem.
        if (res.status === 401) {
          router.push("/login?next=/pricing");
          return;
        }
        setError(json.error ?? "Could not start checkout.");
        return;
      }

      window.location.href = json.url;
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-slate-950 min-h-screen text-slate-50">
      <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <a href="/" className="flex items-center gap-2">
              <Truck className="h-6 w-6 text-blue-500" />
              <span className="text-xl font-bold">TruckOps AI</span>
            </a>
            <div className="flex items-center space-x-4">
              <a href="/dashboard" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Dashboard
              </a>
            </div>
          </div>
        </div>
      </nav>

      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              Simple, transparent pricing
            </h1>
            <p className="text-xl text-slate-400">Choose the plan that scales with your fleet.</p>
          </div>

          {error && (
            <div role="alert" className="mx-auto mb-8 max-w-xl rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`relative bg-slate-900 rounded-2xl border ${
                  plan.highlight
                    ? "border-blue-500 shadow-lg shadow-blue-500/20"
                    : "border-slate-800"
                } p-8 flex flex-col`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    Most Popular
                  </div>
                )}
                <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                <div className="mb-4">
                  <span className="text-4xl font-extrabold">{plan.price}</span>
                  <span className="text-slate-400 text-sm ml-1">{plan.period}</span>
                </div>
                <p className="text-slate-400 text-sm mb-6">{plan.description}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                      <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => choose(plan)}
                  disabled={busy !== null}
                  className={`w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${
                    plan.highlight
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-white"
                  }`}
                >
                  {busy === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>

          <p className="mt-10 text-center text-xs text-slate-500">
            Prices in USD, billed monthly per truck. Cancel any time from the
            billing portal.
          </p>
        </div>
      </section>
    </div>
  );
}
