# TruckOps AI — Foundation

Slice 1 of the build: database schema, Supabase Auth, Row Level Security, tenant-isolation guard, and demo seed data. No UI yet — the next slice is the document extraction pipeline.

## What's here

| Path | What it does |
|---|---|
| `prisma/schema.prisma` | All 12 tables, enums, indexes, relations |
| `supabase/rls-policies.sql` | RLS policies, auth trigger, generated column, storage buckets |
| `lib/auth.ts` | `requireUser()` / `withAuth()` — tenant isolation for Prisma routes |
| `lib/supabase/server.ts` | Session-scoped and service-role clients |
| `lib/env.ts` | Boot-time env validation |
| `app/api/auth/*` | signup, login (password + magic link), logout, me |
| `app/api/user/profile` | GET / PUT profile |
| `app/auth/callback` | Magic link + email confirmation handler |
| `middleware.ts` | Session refresh and `/dashboard` gate |
| `prisma/seed.ts` | Demo fleet: 3 trucks, 2 drivers, 3 brokers, 5 loads, 10 documents, 3 invoices |

## Setup

This assumes you've created a Supabase project. Run in this order — the SQL file depends on tables the migration creates.

```bash
npm install
cp .env.example .env            # fill in the Supabase values
npx prisma migrate dev --name init
npx prisma generate
```

Then open the Supabase SQL editor and run the whole of `supabase/rls-policies.sql`. This step is not optional: it installs the trigger that creates a `public.users` row when someone signs up. Without it, signup succeeds and then every subsequent request 500s.

```bash
npm run db:seed
npm run dev
```

Log in as `demo@truckops.ai` / `demo1234`.

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

`/api/user/dashboard-stats` is in the spec but belongs with the dashboard UI, so it's deferred to a later slice. Same for trucks/drivers/brokers/loads CRUD — those are mechanical once the auth pattern above is established.

## Caveat on this code

I can't run `npm install`, `prisma validate`, or `tsc` in this environment, so nothing here has been executed. The schema and routes are written carefully but expect to fix one or two things on first migration — most likely candidates are the `String[] @db.Uuid` array on `detention_records` and the `@supabase/ssr` cookie API, which changed shape between minor versions.
