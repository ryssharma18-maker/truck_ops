# TruckOps AI

Freight operations platform for US trucking and maritime shipping carriers: AI
document extraction, dispatch, invoicing, compliance and collections.

## What's here

| Path | What it does |
|---|---|
| `prisma/schema.prisma` | 20 tables across the trucking and maritime verticals |
| `prisma/migrations/` | Baseline migration; `db:deploy` on a fresh database |
| `supabase/rls-policies.sql` | RLS policies, auth trigger, generated column, storage buckets |
| `lib/auth.ts` | `requireUser()` / `requirePageUser()` — tenant isolation for every route |
| `lib/crudService.ts` | `userId`-scoped CRUD helpers; 403 on a cross-tenant filter |
| `lib/api.ts` | `handle()` / `ok()` / `fail()` — uniform JSON error envelopes |
| `lib/services/aiService.ts` | Gemini extraction, one field contract per document type |
| `lib/services/emailParser.ts` | Dependency-free MIME reader for inbound mail |
| `lib/services/emailService.ts` | Inbound mail → Storage → AI → database |
| `lib/services/webhookAuth.ts` | HMAC verification for unauthenticated webhooks |
| `app/dashboard/*` | Server-rendered trucking and shipping dashboards |
| `app/api/*` | REST endpoints, all requiring `requireUser()` |
| `middleware.ts` | Session gate for pages and API routes |
| `prisma/seed.ts` | Demo trucking + shipping dataset for `demo@truckops.ai` |

## Setup

This assumes you've created a Supabase project. Run in this order — the SQL file depends on tables the migration creates.

```bash
npm install
cp .env.example .env            # fill in the Supabase values
npm run db:deploy               # or db:migrate when editing the schema
```

> **Use the connection pooler, not the direct connection.** Some ISPs and
> networks transparently proxy outbound traffic on port 5432, which makes
> `db.<ref>.supabase.co` resolve to a private address and fail with
> `Can't reach database server`. The pooler runs on a public IPv4 and is
> unaffected. Copy the pooler string from the Supabase dashboard
> **Connect** dialog, using the session pooler (port 5432), not the
> transaction pooler (port 6543) — Prisma needs session mode.
>
> ```bash
> # session pooler, ap-northeast-1 shown; use your own region
> DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
> ```
>
> Set the same value in `.env` as well as `.env.local`. Prisma CLI reads only
> `.env`, while Next.js prefers `.env.local`, so a split leaves `db:seed` and
> `db:migrate` pointing at an unreachable host.

Then open the Supabase SQL editor and run the whole of `supabase/rls-policies.sql`. This step is not optional: it installs the trigger that creates a `public.users` row when someone signs up. Without it, signup succeeds and then every subsequent request 500s.

```bash
npm run dev
```

### Destructive demo seed (non-production only)

`npm run db:seed` never chooses an account by default. It refuses when the
process or selected target environment is marked production, and requires an
explicit non-production environment, exact target email, and matching
destructive confirmation. The selected email must already have a
`public.users` profile; the seed will not create, remove, or reassign auth or
profile accounts. It also verifies that `DATABASE_URL` and
`NEXT_PUBLIC_SUPABASE_URL` identify the same Supabase project and that the
project ref is in the seed's checked-in non-production allowlist. No
non-production project is currently allowlisted, so seeding must fail closed
before it reads the target profile or performs any writes. The confirmed
production project ref `papddtmsiajajcvdrody` is rejected and must not be
allowlisted. Seeding remains unavailable until a real non-production Supabase
project is independently confirmed and deliberately allowlisted.

After a non-production Supabase project has been independently confirmed and
added to the allowlist, explicitly select and confirm its existing demo
profile in PowerShell before running the seed:

```powershell
$env:SEED_TARGET_ENVIRONMENT = "development"
$env:SEED_EMAIL = "demo@truckops.ai"
$env:SEED_CONFIRM_DESTRUCTIVE = "DELETE ALL DATA FOR demo@truckops.ai"
npm run db:seed
```

For a preview environment, use `SEED_TARGET_ENVIRONMENT=preview` and a
preview-only account/database. The seed prints the selected profile and
per-table deletion counts before any mutation. Every row deletion is scoped to
the resolved `public.users.id`; the profile fields are also reset to demo
values. **The seed does not create a backup.** Verify the database target and
arrange an independent backup before approving any destructive run. The
checked-in project allowlist is the authority for which Supabase project refs
the destructive seed accepts; review it deliberately when adding a new
non-production project.

The demo password is not changed by default. To reset it, explicitly set
`SEED_RESET_DEMO_PASSWORD=true`; this is accepted only for the selected
`demo@truckops.ai` profile and requires a usable service-role key. The reset
uses the resolved auth user ID after preflight confirmation. Do not set this
for customer accounts.

`node scripts/reassign-demo-data.cjs <email>` remains a separate account
reassignment utility; it is not part of the guarded seed command and requires
its own review before use.

> On Windows, stop the dev server before `npm run build` — the dev server
> holds a lock on the Prisma query engine DLL and `prisma generate` fails with
> `EPERM`. See `AGENTS.md`. If the repo lives under OneDrive, also keep
> `.next` on local disk or the build fails with `EINVAL ... readlink`.

### Supabase dashboard settings

- **Authentication → Providers → Email**: enable email provider; enable "Confirm email" for production, disable it locally so signup returns a session immediately.
- **Authentication → URL Configuration**: set Site URL to your `NEXT_PUBLIC_APP_URL` and add `<app_url>/auth/callback` as a redirect URL. Magic links fail silently if this is missing.
- **Storage**: the SQL creates the `documents` and `compliance` buckets. Both are private; files are served through signed URLs, never public links.

## The thing most likely to bite you

**Prisma bypasses RLS.** It connects as the database owner over the direct Postgres connection, so the policies in `rls-policies.sql` do not apply to any query issued from an API route. They protect the browser client (anon key) and nothing else.

Tenant isolation for server code is enforced in application logic instead. The rule:

```ts
// Every query on a user-owned table carries userId in its where clause.
export const GET = withAuth(async (user) => {
  const loads = await prisma.load.findMany({
    where: { userId: user.id },     // ← not optional, ever
  });
  return json(serialize(loads));
});
```

One forgotten `userId` leaks another fleet's loads with no error and no warning. Worth adding a lint rule or a Prisma client extension that rejects unscoped queries on these models before the codebase gets large — say the word and I'll write it.

`ALTER TABLE ... FORCE ROW LEVEL SECURITY` is in the SQL so that a leaked owner connection string doesn't hand over everything. The `service_role` key still bypasses it by design, which is why it's only used in the webhook and cron paths.

## Two deviations from the spec, both deliberate

**`total_invoice_amount` is a Postgres generated column, not an application-computed field.** The spec listed it as "computed". Prisma can't express generated columns, so `schema.prisma` declares it as a plain decimal and `rls-policies.sql` converts it. The app must never write to it. If you'd rather compute it in application code, drop section 1 of the SQL file.

**`decimal` everywhere for money, never `float`.** Floats lose cents on accumulation, which shows up as invoices that disagree with what the broker paid by a few pennies — small, but it destroys trust in the numbers fast. `Prisma.Decimal` doesn't serialize to JSON cleanly, so `serialize()` in `lib/auth.ts` normalizes it on the way out.

## Not built yet

Both Stripe and the transactional email service are implemented but need live
credentials before they can be exercised end to end
(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `RESEND_API_KEY` or
`SENDGRID_API_KEY`). The Settings page shows which integrations are configured,
reading only booleans from the server environment.

Inbound email works end to end but has not been run against a live provider.
`POST /api/webhooks/inbound-email` accepts either a raw `message/rfc822` body
or a JSON envelope, and returns 503 until a webhook secret is set — it fails
closed and will not accept unsigned mail.

## Transactional email

Outbound mail is Resend or SendGrid, chosen by whichever key is set, Resend
first. Set `OUTBOUND_FROM_EMAIL` to a domain you have verified with that
provider: SPF and DMARC will otherwise reject or spam-filter everything, and a
send that lands nowhere still reports success to the carrier.

`POST /api/invoices/[id]/send` emails an invoice to the broker it is billed to
and records the attempt in `email_logs`. Two details worth knowing:

- The invoice is fetched with `userId` in the `where` clause, so another
  carrier's invoice id returns 404. Prisma bypasses RLS, so that clause is the
  only boundary.
- `sentAt` and the status change are written only after the provider accepts
  the message, and a failed log write is reported rather than thrown. The
  email has already left by then, so letting a logging error propagate would
  tell the caller the send failed — and a caller retrying on error would send
  the broker a duplicate invoice.

The invoices page hides its send buttons and explains what is missing when no
provider is configured, rather than offering a button that cannot work.

```bash
npm run verify:email-send   # 45 offline checks: templates, escaping, sender
```

## Billing

Checkout runs through Stripe Checkout and post-payment changes arrive via
webhook. There is no `stripe` npm package: two API calls and one signature
check did not justify the dependency, and the signature verification is
implemented explicitly in `lib/services/stripeService.ts` and covered by
`npm run verify:stripe` instead of being trusted to a library.

Setup:

1. Create three **recurring** prices in Stripe (Lite 15000, Pro 29900,
   Enterprise 49900, USD, per truck per month) and set `STRIPE_PRICE_LITE`,
   `STRIPE_PRICE_PRO` and `STRIPE_PRICE_ENTERPRISE`. Price IDs are read from the
   environment, never hardcoded, because test-mode and live-mode prices are
   different objects.
2. Set `STRIPE_SECRET_KEY`.
3. Forward events and copy the signing secret to `STRIPE_WEBHOOK_SECRET`:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

Handled events: `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, and
`customer.subscription.trial_will_end`. Verified event IDs are recorded in the
same transaction as subscription changes. Subscription updates are serialized
per account and events older than the last applied Stripe `created` timestamp
are acknowledged without changing entitlements.

The webhook fails closed. With no secret it returns 503 and changes nothing,
because an unsigned `customer.subscription.updated` would otherwise be a way to
grant yourself a paid plan. The account is resolved from `metadata.userId`,
which the Checkout session set, never from the event's email address, and only
after the signature verifies.

Verify the signature logic offline and the route end to end:

```bash
npm run verify:stripe          # signature, plan, and event-ordering checks
npm run verify:stripe:webhook  # needs a dev server and a matching secret
npm run verify:stripe:webhook-db # needs dev server + DB; creates/deletes a test user
npm run verify:auth            # auth classification and signup provisioning
npm run verify:booking-errors  # booking 404 vs infrastructure errors
```

## Verification status

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:secrets`,
`npm run verify:email`, `npm run verify:email-send`, `npm run verify:webhook` and
`npm run verify:stripe` all pass.

Route behaviour with no session, which is what CI can assert without a browser:
public pages return 200, dashboard pages redirect to `/login` with a 307, and
protected API routes return a 401 JSON body. Signed-in page rendering still
wants a human check with a real session.

Two network notes, both specific to running from a Windows dev box rather than
the deployed app:

- **Use the connection pooler.** Some ISPs transparently proxy port 5432, which
  makes `db.<ref>.supabase.co` resolve to a private address and fail with
  `Can't reach database server`. The pooler is unaffected.
- **`connect_timeout=30` is not optional on a slow link.** Prisma's default
  connect timeout is 5 seconds. A cold TLS handshake through a transparent proxy
  took 2.4s–11.6s on this network, so about one connection in fifteen failed
  with `P1001: Can't reach database server` on a perfectly healthy host.
  Measured over 15 attempts per port: `5432` failed 1, `6543` failed 1 — the
  port is not the variable. Raising the timeout took the same probe to 24/24.

When you see that error, Next.js prints advice to move `DATABASE_URL` onto `6543`
and `DIRECT_URL` onto `5432`. The split is worth having regardless — it is what
`.env.example` documents and what serverless wants — but it does not fix a
timeout, and the error it prints is misleading about the cause. Check the
timeout first.

A Vercel deployment is unaffected by both.

The RLS script in `supabase/rls-policies.sql` has **not** been executed against
your Supabase project — the verification queries in its section 6 need to be
run there, especially the new one that lists any `user_id` table missing RLS.
