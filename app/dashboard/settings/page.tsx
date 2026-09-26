import type { Metadata } from "next";
import { CheckCircle2, XCircle, KeyRound, Inbox } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProfileForm } from "@/components/ProfileForm";
import { PageHeader, StatCard } from "@/components/ui/dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings | TruckOps AI" };

/**
 * Integration status is derived from which server-side env vars are present.
 * Only a boolean "configured / not configured" is ever rendered — never a key.
 */
function IntegrationStatus() {
  const checks: { name: string; configured: boolean; hint: string }[] = [
    {
      name: "Gemini AI extraction",
      configured: Boolean(process.env.GEMINI_API_KEY),
      hint: "Rate con, BoL, commercial invoice and packing list parsing",
    },
    {
      name: "Supabase Storage",
      configured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      hint: "Document uploads and signed download URLs",
    },
    {
      name: "Stripe billing",
      configured: Boolean(
        process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
      ),
      hint: "Subscription checkout and webhook-driven plan changes",
    },
    {
      name: "Transactional email",
      configured: Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY),
      hint: "Invoice and compliance notifications",
    },
    {
      name: "Inbound email",
      configured: Boolean(
        process.env.INBOUND_EMAIL_DOMAIN &&
          (process.env.SENDGRID_INBOUND_WEBHOOK_SECRET || process.env.RESEND_API_KEY),
      ),
      hint: `Receiving address domain: ${process.env.INBOUND_EMAIL_DOMAIN ?? "not set"}`,
    },
  ];

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-300">Integrations</h3>
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        {checks.map((c) => (
          <li key={c.name} className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium text-white">{c.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{c.hint}</p>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                c.configured
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-slate-500/15 text-slate-400"
              }`}
            >
              {c.configured ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {c.configured ? "Configured" : "Not configured"}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-xs text-slate-600">
        <KeyRound className="h-3 w-3" />
        Credentials are read from server environment variables only — never exposed to the browser.
      </p>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requirePageUser();

  const [trucks, drivers, vessels, bookings] = await Promise.all([
    prisma.truck.count({ where: { userId: user.id } }),
    prisma.driver.count({ where: { userId: user.id } }),
    prisma.shippingVessel.count({ where: { userId: user.id } }),
    prisma.shippingBooking.count({ where: { userId: user.id } }),
  ]);

  return (
    <div className="space-y-8 p-6 pt-8 lg:p-8">
      <PageHeader
        title="Settings"
        subtitle="Carrier profile, plan and integration status"
      />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Account</h3>
        <dl className="grid gap-4 rounded-lg border border-slate-800 bg-slate-900 p-6 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd className="mt-1 text-sm text-white">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Plan</dt>
            <dd className="mt-1 text-sm capitalize text-white">{user.subscriptionPlan}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Document inbox</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-white">
              <Inbox className="h-3.5 w-3.5 text-slate-500" />
              {user.inboxEmail}
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Carrier profile</h3>
        <ProfileForm
          profile={{
            fullName: user.fullName ?? "",
            companyName: user.companyName ?? "",
            phone: user.phone ?? "",
            dotNumber: user.dotNumber ?? "",
            mcNumber: user.mcNumber ?? "",
            truckCount: user.truckCount,
          }}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Usage</h3>
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Trucks" value={trucks} />
          <StatCard label="Drivers" value={drivers} />
          <StatCard label="Vessels" value={vessels} />
          <StatCard label="Bookings" value={bookings} />
        </div>
      </section>

      <IntegrationStatus />
    </div>
  );
}
