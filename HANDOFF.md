# HANDOFF.md

Engineering brief for anyone (human or AI) picking this repository up cold.
Written at commit `7483b8b` plus a large **uncommitted** working tree — see
[Working tree state](#working-tree-state).

Read `AGENTS.md` first. It holds the conventions. This file covers what is
already built, what is broken, and what has deliberately *not* been done.

---

## 1. What this product is

TruckOps AI — a multi-tenant B2B logistics SaaS for trucking carriers, with a
maritime/shipping vertical attached. Carriers manage trucks, drivers, loads,
maintenance, documents, invoices and compliance; shipping customers manage
vessels, ports, bookings, containers, manifests and shipping documents. AI
extracts structured data from uploaded freight paperwork. Billing is per-truck
subscription via Stripe.

**Not** a demo, not a prototype, not a mockup. Auth is real, the database is
real, the seed data is real. Anything that looks like a placeholder fails
closed rather than pretending.

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js `14.2.18`, App Router, React 18 | Pages and route handlers |
| Language | TypeScript `5.6`, `strict` | |
| ORM | Prisma `5.22.0` | |
| Database | Supabase Postgres | Reached through the **pooler**, not the direct host |
| Auth | Supabase Auth (`@supabase/ssr` 0.5.2) | Email + password, httpOnly cookies |
| Billing | Stripe **REST API**, no SDK | Deliberate — see `AGENTS.md` |
| Email | Resend or SendGrid, no SDK | Outbound + inbound |
| AI | `@google/generative-ai` 0.24.1 | Variable must be `GEMINI_API_KEY` |
| Validation | Zod 3 | Every route validates before touching a provider |
| Styling | Tailwind 3 | Dark theme only, inline utilities |
| Icons | `lucide-react` | No `<img>` anywhere in the app |

**Node 24.21.0, npm 11.19.0** on Windows. Windows-specific failure modes are
documented in `AGENTS.md` and have bitten us repeatedly — read that file.

## 3. Architecture in one screen

```
middleware.ts            first gate only: refreshes Supabase cookies,
                         401s API routes, redirects pages. NOT tenant isolation.
app/dashboard/**/page.tsx    Server Components. Call requirePageUser(), then
                             query Prisma directly. No client fetch.
app/api/**/route.ts          Route handlers. Call requireUser(), scope every
                             query by user.id, return ok()/fail() from lib/api.
components/ui/dashboard.tsx  Server-safe presentational primitives. No
                             "use client". DataTable, StatCard, StatusPill,
                             PageHeader, EmptyState, formatMoney, formatDate.
components/*.tsx             "use client" islands: modals, forms, buttons.
                             PATCH/POST then router.refresh().
lib/crudService.ts          create/list/assertOwned helpers that force userId
                             last so a caller's `data` cannot override it.
lib/env.ts                 isConfigured() / anyConfigured() / requireEnv().
                             Owns the "is this actually set?" question.
lib/auth.ts                requireUser() (API) + requirePageUser() (page) +
                             errorResponse() + serialize() for Decimal.
```

**The one rule that matters:** Prisma connects as the database owner and
therefore **bypasses RLS**. The `where` clause is the tenant boundary, full
stop. A forgotten `userId` leaks another carrier's data and returns no error.
Both audits this session confirmed all 24 route files are currently clean.

## 4. Environment and infrastructure

### Database URLs — read this before touching anything

```
DATABASE_URL = ...pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&connect_timeout=30
DIRECT_URL   = ...pooler.supabase.com:5432/postgres?connect_timeout=30
```

- Runtime → transaction pooler `6543` with `pgbouncer=true`, `connection_limit=1`.
  Serverless opens many short-lived connections; the session pooler holds one per client.
- Migrations → session pooler `5432` via `DIRECT_URL`. Migrations need advisory
  locks, so they cannot use the transaction pooler.
- The **non-pooler** host `db.<ref>.supabase.co` is unreachable from this
  network because the ISP transparently proxies it.
- **`connect_timeout=30` is load-bearing.** Prisma's default is 5 seconds.
  Measured here: cold TLS handshakes take 2.4s–11.6s. Over 15 attempts per
  port, `5432` failed 1 and `6543` failed 1 — the *port* was never the
  variable. With the timeout raised: 24/24.
- Next.js prints "split DATABASE_URL onto 6543 and DIRECT_URL onto 5432" when
  it sees this error. That advice is right about the split and useless about the
  cause. **Check the timeout before the port.**

### Ports

The dev server is on **:3001**. Next.js takes 3000 if free and increments
otherwise, so "my host is 3001" means 3000 was already held. Before starting a
server:

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3000,3001,3002
```

Never run two. To start: `npm run dev`.

### Windows / OneDrive

Repo lives under OneDrive with Files On-Demand. `.next` and `node_modules`
get evicted to the cloud and left as reparse points, which surfaces as:

```
Error: EINVAL: invalid argument, readlink '.next\server\app-paths-manifest.json'
```

Recover with `Remove-Item .next -Recurse -Force`, then
`attrib +P -U /S /D .next` and `attrib +P -U /S /D node_modules\.prisma`.
`+P` pins, `-U` un-evicts. The real fix is setting the folder to "Always keep
on this device" in OneDrive.

`npm run build` runs `prisma generate` first, and the dev server holds
`query_engine-windows.dll.node` open, so **stop every node process before
building**:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next|start-server|npm-cli' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Filtering on the literal string `next dev` misses the npm and start-server
children. Kill all three or the lock persists.

### Auth

No demo mode, no synthetic user, no bypass. `requireUser()` verifies a Supabase
session and loads the matching `public.users` row. A missing
`NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` returns 500
`auth_not_configured`.

- Login account: `ai.robod3@gmail.com` (`9a8c9ddc-21e4-4886-aa89-625dce8aed02`).
  The seeded dataset belongs to this account.
- `SUPABASE_SERVICE_ROLE_KEY` is still the literal placeholder
  `placeholder-service-key`. Owner chose to defer it. That blocks auth-user
  provisioning, Supabase Storage, and full inbound-email testing.
- `GEMINI_API_KEY` is unset. AI extraction has never run against the live API.

### Verification commands

```bash
npm run typecheck           # tsc --noEmit
npm run lint                # next lint
npm run build               # prisma generate && next build — stop node first
npm run check               # all three
npm run verify:secrets      # scans git-tracked files for committed credentials
npm run verify:email        # MIME parser checks
npm run verify:email-send   # outbound template + escaping checks (45)
npm run verify:webhook      # HMAC signature checks
npm run verify:stripe       # offline Stripe signature/status checks (33)
npm run verify:plans        # plan-limit enforcement checks
npm run verify:workflow     # load transitions, money, profile, webhook, RLS coverage (153)
npx tsx scripts/verify-live-db.ts   # real database checks — needs DB credentials
npm run verify:stripe:webhook   # needs a dev server + matching secret
```

All offline suites run in CI, including `verify:plans` and `verify:workflow`.

Proving the **runtime** database path actually reaches Postgres: sign a Stripe
event and send it to the webhook. A `400 unknown_user` means Prisma ran a real
`findUnique`.

```powershell
$env:WEBHOOK_TEST_BASE="http://localhost:3001"
$env:STRIPE_WEBHOOK_SECRET="<must match the running server>"
npm run verify:stripe:webhook
```

**Never verify pages only on `/pricing` and `/login`.** Both are public and
never touch Prisma, so they return 200 while the database is down. `/dashboard`
redirects to `/login` before any query runs, so it proves nothing either. This
mistake was made once already.

## 5. Database state

- Baseline migration `prisma/migrations/20260101000000_init/migration.sql`, plus:
  - `20260926120000_rate_limits_and_stripe_event_ledger` — `rate_limits`, `stripe_events`
  - `20260927000000_rls_new_tables` — RLS on the two above, deliberately policy-free
  - `20260927010000_rls_shipping_tables` — RLS on the seven `shipping_*` tables
  `npx prisma migrate status` reports up to date against the live database.
- **RLS is now enabled and forced on every tenant table.** Getting there found a
  live hole: all seven `shipping_*` tables had `rowsecurity = false` with zero
  policies, even though `supabase/rls-policies.sql` has listed them in section 3
  all along. The file was right and the database was wrong, so nothing caught
  it. Since the anon key ships to the browser, that was a live cross-tenant
  read/write over every carrier's maritime data. Fixed by migration, and
  `npm run verify:workflow` now fails if a `user_id` table is ever missing from
  the RLS script again.
- Two tables are **intentionally** RLS-on with no policy: `stripe_events` and
  `rate_limits`. Section 6's "RLS on but no policy" query should return exactly
  those two. See section 4 of the RLS script for why granting a tenant access to
  either is a billing-integrity or rate-limit bypass.
- The app connects as `postgres`, which has `rolbypassrls = true`. This is worth
  internalising: **RLS does not protect application code at all.** Every query
  must scope by `user.id` in the `where` clause, because that is the only
  boundary. See `AGENTS.md`.
- `loads.total_invoice_amount` is currently a **normal writable column**
  (`attgenerated` is empty), *not* a generated column. See backlog item B1.
- Seed: `npm run db:seed`, configurable via `SEED_EMAIL`. Destructive — it
  wipes and rebuilds the target account. Works without a service-role key if
  the account already exists, but cannot verify auth in that mode.
- Fixture: 3 trucks, 2 drivers, 3 brokers, 5 loads, 10 documents, 3 invoices,
  6 ports, 3 vessels, 4 bookings, 5 containers, 3 manifests, 5 shipping
  documents, 3 shipping invoices.
- Pre-seed backup: `C:\Users\radhe\AppData\Local\Temp\opencode\truckops-backup\preseed-20260926-131159.json`

## 6. Working tree state

**Nothing is committed.** Base is `7483b8b`; there is no Git remote, so nothing
can be pushed. Treat the working tree as the source of truth and read
`git status --short` before staging anything — the index already contains a
staged deletion that is easy to miss.

Committed history:
```
7483b8b  Wire up Stripe checkout, billing portal, and the subscription webhook
7c3e3b9  Seed against a configurable account; move demo data to the real login
8962e65  Remove demo mode; require real Supabase auth everywhere
9223b8a  Complete trucking and shipping dashboards, inbound email pipeline, and CI
```

The tree is large enough that the useful summary is by area rather than by file:
rate limiting, plan limits, webhook hardening, the Stripe ledger, the maritime
UI, the money/currency work, the RLS migrations, and the verification suites.
`git status --short` and `git diff --stat` give the detail.

New migrations, both applied to the live database:
`prisma/migrations/20260927000000_rls_new_tables/` and
`prisma/migrations/20260927010000_rls_shipping_tables/`.

Deleted: `lib/demo-data.ts` (staged), `components/ui/card.tsx`.

Verification at time of writing — all green:
`typecheck`, `lint`, `build` (25 routes, every dashboard route `ƒ` dynamic),
`verify:secrets`, `verify:email`, `verify:email-send`, `verify:webhook`,
`verify:plans`, `verify:stripe` 33/33, `verify:workflow` 153/153, and
`npx tsx scripts/verify-live-db.ts` against the real database.

Delete when convenient: `.env.bak-portsplit`, `.env.local.bak-portsplit`.

**Flakiness to expect, not a regression:** the live suite occasionally reports
`window start moved forward` failing or logs `[rate-limit] lookup failed,
failing open`. Both come from the `connection_limit=1` pooler and the home
network's cold TLS handshake, not from a code fault — the limiter failing *open*
is the designed behaviour. Re-run before investigating.

## 7. What was done this session

**Transactional invoice email.** `lib/services/emailSendService.ts` renders
invoice and compliance emails for Resend/SendGrid, picks the provider by
whichever key is set, and records every attempt in `EmailLog`.
`POST /api/invoices/[id]/send` sends an invoice to the broker it is billed to,
scoped by `userId` (cross-tenant id → 404). `components/SendInvoiceButton.tsx`
wires it into the invoices page, which hides the buttons and names the missing
variable when no provider is configured.

**Four defects found and fixed, not just implemented:**

1. `app/api/webhooks/stripe/route.ts` — `checkout.session.completed` assigned
   `metadata.plan` into the same variable that held the account UUID, so the
   `userId` lookup received `"lite"` and Prisma threw. Stripe retries any
   non-2xx for up to ~3 days, so **every successful checkout would have
   redelivered indefinitely**. Split into `userIdHint` / `planHint`, and a
   non-UUID now returns `400 invalid_user_id` instead of a 500.
2. `lib/services/emailSendService.ts` — `sendAndLog()` let a failed
   `emailLog.create` propagate *after* the provider had already accepted the
   message. The caller saw a failure and would retry, **emailing the broker a
   duplicate invoice**. Log-write failure is now reported, not thrown.
3. `middleware.ts` — `PUBLIC_PREFIXES` did not contain `"/"`, so the marketing
   homepage returned 307 to `/login` for every anonymous visitor. Verified
   fixed: `GET /` → 200.
4. `components/Sidebar.tsx` — `pathname.startsWith(href)` made
   `/dashboard/shipping` match all six shipping sub-routes, so two nav items
   rendered as active at once and `aria-current` was ambiguous. Now the deepest
   matching ancestor wins.

**Also:** `app/login/page.tsx` honours `?next=` (the plumbing existed in three
places and was honoured in none) with an open-redirect guard, associates labels
with inputs, and uses `finally` so a thrown Supabase promise cannot leave the
button disabled forever. Stripe no longer sends `customer` and `customer_email`
together, which Stripe rejects.

**Database config** corrected as described in §4. Also removed a stale
`NEXT_PUBLIC_DEMO_MODE` from CI and added the email-send suite.

## 8. Backlog — B1 to B14, all resolved

Findings from a full UI/UX and backend/security audit. **Every item below is
now fixed, verified, and covered by a check.** The original write-ups are kept
so the reasoning behind each fix is not lost, but read them as history: the
"will 500" / "is not" phrasing describes the state *before* the fix.

Two items were found after this audit and are worth knowing about, because
neither was in the original list:

- **The seven `shipping_*` tables shipped with RLS disabled** in the live
  database, despite `supabase/rls-policies.sql` listing them. Live cross-tenant
  read/write for anyone with the anon key. Fixed, and now guarded — see §5.
- **Truncated counts were being displayed as totals.** `findMany` results are
  capped, and several pages used `.length` of the capped array as a "total"
  card, so a tenant with more than the cap saw the cap. Every `findMany` under
  `app/` is now bounded, and every count shown to a user comes from a `count()`
  or `groupBy`, with a hint whenever the list itself is truncated.

### Resolved

| Item | Was | Fix |
|---|---|---|
| B1 | `POST /api/loads` would 500 once the generated-column SQL ran | Dropped the write; the column stays a plain `Decimal` as the schema declares |
| B2 | Inbound email signature used the wrong scheme | Real Svix verification over the raw body |
| B3 | No rate limiting anywhere | Atomic Postgres limiter with `X-RateLimit-*` headers |
| B4 | Stripe webhook had no idempotency ledger | `StripeEvent` ledger, `P2002` treated as a duplicate |
| B5 | Unbounded body read before signature verification | Capped raw-body read, then verify |
| B6 | No loading / error / not-found boundaries | Generated across every page segment |
| B7 | Four dead links | Modals plus real booking and trip detail pages |
| B8 | `crudService.update` allowed re-parenting a row | `userId` is no longer caller-settable |
| B9 | Plan limits not enforced | `lib/planLimits.ts` + `verify:plans` |
| B10 | Per-truck billing always charged for 1 truck | Quantity derived server-side |
| B11 | Shipping money summed across currencies | `groupBy(currency)`; never summed across currencies |
| B12 | Unbounded list queries | Every `findMany` bounded, totals from real `count()` |
| B13 | `Modal.tsx` was an inaccessible dialog | Native `<dialog>` with focus restore and Escape |
| B14 | Assorted lower-severity issues | Profile allowlist, storage keys, status transitions, aria-live, dead code |

### Open follow-ups

Real, but not blocking, and deliberately left alone:

- `app/dashboard/shipping/bookings/[id]/page.tsx` calls
  `bookingDetail(...).catch(() => null)`, which turns a database outage into a
  404. Narrow it to `HttpError` with status 404.
- `lib/profile.ts` still returns `inboxEmail`. It is a deliberate part of the
  response contract today; confirm that is intended before treating it as
  settled.
- `LoadStatusActions` offers only the forward chain, so a user cannot mark an
  invoice `overdue` even though the API allows the transition.
- `RATE_LIMITS.createRow` is defined but never called. Either wire it into the
  create routes or delete it.
- The Stripe ledger deduplicates but does not order. A late
  `customer.subscription.deleted` can still downgrade a subscription that a
  newer event already upgraded. Compare `event.created` before applying.
- Plan ceilings are engineering assumptions, not confirmed by the business.


## 9. Not built, and why

- **No deployment.** No `vercel.json`, no `.vercel/`. `NEXT_PUBLIC_APP_URL` is
  still `http://localhost:3000`, and Stripe builds `success_url`/`cancel_url`
  from it — shipping as-is would send customers to the developer's machine.
  Needs a Vercel account, then provider keys as Vercel env vars, then a real
  domain.
- **Stripe is unverified against the live API.** Only offline signature/status
  checks and the locally-signed webhook suite have run. No `STRIPE_SECRET_KEY`,
  no price IDs, no trial-to-paid lifecycle.
- **Gemini has never been called.** No `GEMINI_API_KEY`.
- **Storage and inbound email are untested end to end** — both need the real
  `SUPABASE_SERVICE_ROLE_KEY`.
- **No pagination, no rate limiting, no error monitoring, no structured
  logging, no tests beyond the `verify:*` scripts.** There is no test framework
  installed, deliberately: the checks are standalone scripts runnable in CI
  without extra infrastructure. That was a judgement call and is worth
  revisiting before this carries real money.
- **No custom design system.** Utilities are inline; four places hand-roll what
  `PageHeader`/`StatCard`/`EmptyState` already provide, and have drifted.

## 10. How to work in this repo

Conventions are in `AGENTS.md`. The parts that matter most:

**Never skip tenant scoping.** Every query takes `userId`. Prefer
`lib/crudService.ts` helpers over raw `prisma.<model>` — they take `userId` as a
required argument and throw 403 on a cross-tenant filter. When you must write a
raw query, `userId` goes in the `where`, and a cross-tenant id should 404 rather
than 403 so it is indistinguishable from a missing row.

**Money is `Decimal`, never `float`.** `serialize()` in `lib/auth.ts` converts
for JSON. Stripe amounts are integer cents. Shipping currency codes must be
validated before they reach `Intl.NumberFormat`.

**Use `lib/env.ts`, not `Boolean(process.env.X)`.** `isConfigured()` rejects
placeholders, so a leftover `placeholder-service-key` must not report as
working. `requireEnv()` where a missing value must abort.

**New API route:**

```ts
export const dynamic = "force-dynamic";
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  // every query scoped by user.id
  return ok(data);
});
```

Never `return NextResponse.json` directly — `handle()` turns `HttpError`, Zod
and Prisma constraint errors into tidy JSON.

**New dashboard page:** Server Component, `export const dynamic = "force-dynamic"`
(or it is prerendered at build time with empty data), query Prisma directly.
Keep `components/ui/dashboard.tsx` server-safe. Interactive bits are separate
client components that mutate then `router.refresh()`.

**Stripe webhook:** verify the signature over the **raw** body
(`await req.text()`), never `req.json()` — re-serialising changes the bytes and
the signature stops matching. Resolve the account from `metadata.userId`, never
from the event's email, and only after verification. Price IDs come from the
environment; test-mode and live-mode prices are different objects.

**Work on Windows:** stop node before `prisma generate`. Check for a
OneDrive-evicted `.next` if you see `EINVAL ... readlink`. Never start a second
dev server without checking the port.

**Conventions for the AI assistant reading this:** the project expects measured
claims, not plausible ones. When something is intermittent, measure it and
report the numbers and the measurement method. Distinguish *latent* defects from
*active* ones — B1 is latent, and saying it "breaks every call" would be wrong.
Verify a subagent's claim before acting on it; the generated-column claim in B1
was overstated and checking `pg_attribute` caught it. Never paste a real
credential into a tracked file — `npm run verify:secrets` runs in CI and has
already caught one leak. `.env.example` is tracked and must stay empty.
