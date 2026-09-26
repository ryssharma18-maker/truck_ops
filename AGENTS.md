# AGENTS.md

Conventions for working in this repo. Read before running builds.

## Commands

```bash
npm run dev            # dev server on :3000
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run build          # prisma generate && next build
npm run check          # typecheck + lint + build
npm run verify:secrets # scans git-tracked files for committed credentials
npm run verify:email   # MIME parser runtime checks
npm run verify:webhook # HMAC signature verification checks
npm run db:migrate     # create + apply a migration (dev)
npm run db:deploy      # apply migrations (prod)
npm run db:seed        # rebuild the demo@truckops.ai dataset
```

## Windows: stop the dev server before `prisma generate`

`npm run build` runs `prisma generate` first, and the Next dev server holds
`node_modules/.prisma/client/query_engine-windows.dll.node` open at runtime.
Regenerating while the dev server is up fails with:

```
EPERM: operation not permitted, rename
  '...query_engine-windows.dll.node.tmpNNNN' ->
  '...query_engine-windows.dll.node'
```

This is a file lock, not a permissions problem, and `takeown`/`icacls` will not
fix it. **Stop the dev server first, then build.** To find the holders:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next|start-server|npm-cli' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Note the dev server spawns three processes (`npm-cli.js run dev`, the `next`
bin, and `start-server.js`). Filtering on the literal string `next dev` misses
the npm and start-server children, so kill all three or the lock persists.

## OneDrive: build directories must stay on local disk

This repo sits under `OneDrive`, which uses Files On-Demand. Build output
(`node_modules`, `.next`) gets evicted to the cloud and left behind as a
reparse point. Node then fails on them:

```
Error: EINVAL: invalid argument, readlink
  '.next\server\app-paths-manifest.json'
    at async Object.readlink (node:fs/promises)
```

That is a OneDrive placeholder, not a corrupt build. Recover with:

```powershell
Remove-Item .next -Recurse -Force      # then rebuild
attrib +P -U /S /D .next                # +P pins, -U un-evicts
attrib +P -U /S /D node_modules\.prisma
```

The permanent fix is to set this folder to **Always keep on this device** in
OneDrive, or exclude it from syncing, then sync down once. The `attrib` calls
only pin files that already exist locally.

## Tenant isolation is not optional

Prisma connects as the database owner, which **bypasses RLS**. The query
`where` clause is the tenant boundary, full stop.

- Every route handler calls `requireUser()` and scopes by `user.id`.
- Use `lib/crudService.ts` helpers rather than raw `prisma.<model>` calls; they
  take `userId` as a required argument and throw 403 on a cross-tenant filter.
- RLS in `supabase/rls-policies.sql` is defence in depth for anon-key clients
  only. It does not protect server code.
- A forgotten `userId` leaks another carrier's data with no error.

`supabase/rls-policies.sql` lists tables explicitly, so it will drift. After
adding a model with a `user_id` column, add it to sections 3 and 4 of that
file; the verification queries in section 6 will surface any you forget.

## Authentication is always real

There is no demo mode and no synthetic user. `requireUser()` verifies a
Supabase session and loads the matching `public.users` row.

- A missing `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` must
  fail closed. Both `lib/auth.ts` and `middleware.ts` return 500
  (`auth_not_configured`) rather than letting the request through.
- Do not add a bypass for local development. The database is reachable from a
  dev machine; seed it instead (`npm run db:seed`) and sign in as
  `demo@truckops.ai`.
- `middleware.ts` is only a first gate. It cannot know the tenant, and Prisma
  bypasses RLS, so it is never the thing standing between a request and
  another carrier's data.

## Money

`Decimal` everywhere, never `float`. `serialize()` in `lib/auth.ts` converts
`Prisma.Decimal` for JSON responses. Stripe amounts are integer cents.

## Adding an API route

```ts
export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  // ... scope every query by user.id
  return ok(data);
});
```

`handle()` from `lib/api.ts` turns thrown `HttpError`, Zod and Prisma
constraint errors into tidy JSON. Never `return NextResponse.json` directly.

## Adding a dashboard page

Pages are Server Components that query Prisma directly — no client fetch.
Always `export const dynamic = "force-dynamic"`, or the page is prerendered at
build time with build-time (demo/empty) data. Presentational primitives live
in `components/ui/dashboard.tsx`; keep them server-safe (no `"use client"`).
Interactive bits (modals, forms) are separate client components that PATCH and
call `router.refresh()`.

## Environment

- `GEMINI_API_KEY` — exact casing. `aiService` reads only this spelling.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, never `NEXT_PUBLIC_`.
- `lib/env.ts` owns the "is this configured?" question. `isConfigured()`
  rejects placeholders, so use it rather than `Boolean(process.env.X)`, which
  reports a leftover `placeholder-service-key` as working. Use
  `requireEnv()` where a missing value must abort.
- Inbound webhook secrets must be set, or `POST /api/webhooks/inbound-email`
  returns 503. It fails closed, never open.
- `.env*` is git-ignored except `.env.example`. `npm run verify:secrets` is
  wired into CI; do not paste a real key into `.env.example`.

## Billing

`lib/services/stripeService.ts` talks to the Stripe REST API directly. Two rules
matter more than the rest:

- The webhook verifies `Stripe-Signature` over the **raw** request body. Reading
  the body with `req.json()` and re-serialising changes the bytes and the
  signature stops matching. Use `await req.text()`.
- Resolve the account from `metadata.userId`, which the Checkout session set,
  never from the event's email. And only after the signature verifies.

Plan price IDs come from the environment (`STRIPE_PRICE_*`); test-mode and
live-mode prices are different objects. Amounts are integer cents.
