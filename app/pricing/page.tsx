import Link from "next/link";
import { Check, Truck } from "lucide-react";

const plans = [
  { name: "Trial", price: "$0", period: "14 days", description: "Perfect for testing the platform.", features: ["Up to 2 trucks", "20 document extractions", "Basic load tracking", "Invoice generation", "Email support"], cta: "Start Free Trial", highlight: false },
  { name: "Lite", price: "$150", period: "/ truck / mo", description: "For owner-operators & micro fleets.", features: ["Up to 5 trucks", "Unlimited documents", "AI extraction (all types)", "Automated invoicing", "Compliance vault", "Email + chat support"], cta: "Get Started", highlight: false },
  { name: "Pro", price: "$299", period: "/ truck / mo", description: "Most popular for growing fleets.", features: ["Up to 20 trucks", "Everything in Lite", "Detention tracking", "IFTA fuel tax prep", "Payment chasing", "Priority support"], cta: "Get Started", highlight: true },
  { name: "Enterprise", price: "$499", period: "/ truck / mo", description: "Custom for large fleets.", features: ["Unlimited trucks", "Everything in Pro", "Dedicated account manager", "Custom integrations", "API access", "SLA guarantee"], cta: "Contact Sales", highlight: false }
];

export default function PricingPage() {
  return (
    <div className="bg-slate-950 min-h-screen text-slate-50">
      <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link href="/" className="flex items-center gap-2">
              <Truck className="h-6 w-6 text-blue-500" />
              <span className="text-xl font-bold">TruckOps AI</span>
            </Link>
            <div className="flex items-center space-x-4">
              <Link href="/dashboard" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">Start Free Trial</Link>
            </div>
          </div>
        </div>
      </nav>
      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Simple, transparent pricing</h1>
            <p className="text-xl text-slate-400">Choose the plan that scales with your fleet.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {plans.map((plan) => (
              <div key={plan.name} className={`relative bg-slate-900 rounded-2xl border ${plan.highlight ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-slate-800'} p-8 flex flex-col`}>
                {plan.highlight && (<div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Most Popular</div>)}
                <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                <div className="mb-4"><span className="text-4xl font-extrabold">{plan.price}</span><span className="text-slate-400 text-sm ml-1">{plan.period}</span></div>
                <p className="text-slate-400 text-sm mb-6">{plan.description}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (<li key={feature} className="flex items-start gap-2 text-sm text-slate-300"><Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />{feature}</li>))}
                </ul>
                <Link href={plan.cta === "Contact Sales" ? "/contact" : "/dashboard"} className={`w-full py-3 rounded-lg text-center font-semibold transition-colors ${plan.highlight ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'}`}>{plan.cta}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
