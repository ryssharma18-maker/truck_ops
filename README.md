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
npm run db:seed
npm run dev
```

Log in as `demo@truckops.ai` / `demo1234`.

> On Windows, stop the dev server before `npm run build` — the dev server
> holds a lock on the Prisma query engine DLL and `prisma generate` fails with
> `EPERM`. See `AGENTS.md`.

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

Stripe checkout and the transactional email service are stubbed out. Both need
live credentials (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`RESEND_API_KEY` or `SENDGRID_API_KEY`) before they can be exercised. The
Settings page shows which integrations are configured, reading only booleans
from the server environment.

Inbound email works end to end but has not been run against a live provider.
`POST /api/webhooks/inbound-email` accepts either a raw `message/rfc822` body
or a JSON envelope, and returns 503 until a webhook secret is set — it fails
closed and will not accept unsigned mail.

## Verification status

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:secrets`,
`npm run verify:email` and `npm run verify:webhook` all pass, and all 21
dashboard and public pages return 200 against a seeded database.

The RLS script in `supabase/rls-policies.sql` has **not** been executed against
your Supabase project — the verification queries in its section 6 need to be
run there, especially the new one that lists any `user_id` table missing RLS.
