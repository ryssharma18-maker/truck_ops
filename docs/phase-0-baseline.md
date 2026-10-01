# Phase 0 verification baseline

This document describes **checked-in repository evidence only**. The
verification scripts in this phase read local source files or run against
in-memory test doubles. They do not connect to Supabase/PostgreSQL, read local
environment files, execute SQL, or verify a deployed environment.

## Current authentication and signup behavior

- `app/signup/page.tsx` calls Supabase Auth directly from the browser. It
  redirects to `/dashboard` when signup returns a session; when Supabase
  requires email confirmation and returns no session, it asks the user to check
  email. It currently submits email/password only.
- `app/api/auth/signup/route.ts` is a separate server-side signup path. It
  validates `signupSchema` (email, password, full name, company name, optional
  phone and truck count), applies the named per-IP signup rate limit, calls
  Supabase Auth, waits for the auth trigger to provision `public.users`, and
  returns HTTP 201 with the profile and a `needsEmailConfirmation` flag.
- The server route's handling of duplicate/other provider rejections is
  normalized to a generic signup failure for non-403 client errors. This
  repository-only baseline does not contact Supabase to test provider behavior.
- `lib/auth.ts` verifies a real Supabase session and resolves the matching
  Prisma `User`; missing configuration, unauthenticated requests, absent
  profiles, and provider/database failures fail closed.
- `lib/authProvisioning.ts` retries profile reads and reports a retryable 503
  when the provisioned profile is not visible or lookup is unavailable.
- `middleware.ts` permits public pages and signature-authenticated webhook
  routes. It returns a JSON 401 for unauthenticated protected API paths and
  redirects unauthenticated protected pages to login. Protected handlers also
  call `requireUser()`.

The signup page and server signup route currently differ in fields, rate
limiting, and profile provisioning. Phase 0 records that behavior; it does not
change signup.

## Tenant isolation checks

`npm run verify:tenant-isolation` executes `lib/crudService.ts` with in-memory
delegates to check own-record reads, foreign-ID denial, tenant-scoped lists and
counts, create ownership, update re-parenting prevention, and foreign update
and delete denial. It also checks source-level tenant predicates and
same-tenant reference checks on the current load, booking, and document routes.

`npm run verify:api-contracts` executes the shared API error response mapping
and checks repository source contracts for auth, response shapes, validation,
and resource ownership on selected API paths.

The source-contract checks detect accidental code-shape regressions; they do
not simulate a full Next.js request or execute Prisma against records. Route
integration behavior requiring Supabase session cookies and database records
still needs a separate local integration harness.

## Database and RLS evidence

`npm run verify:database-baseline` checks only:

- migration directory/file presence and sortable naming;
- model-to-table mappings versus checked-in migration table creation;
- tenant-owned schema models and their tenant-leading indexes;
- selected foreign-key constraint names in checked-in migrations;
- RLS script coverage for schema tables with `userId`;
- presence of live-verification queries in the repository SQL file.

These are checks of the **repository schema, migrations, and RLS script**.
They are not proof that migrations have been applied, that live policies match
the script, or that deployed table ownership/privileges match repository
assumptions.

> **LIVE SUPABASE STATE: UNVERIFIED.** No remote database or Supabase project
> has been queried. `supabase/rls-policies.sql` was not executed. The script
> is documented as a full setup script and contains a destructive replacement
> of `loads.total_invoice_amount`; do not use it as a patch or execute it
> blindly.

## Test boundaries

These checks require no production credentials, no database, no Supabase,
and no Stripe configuration. The API contract tests invoke only shared
response utilities and inspect checked-in route source. Signup/provider,
session-cookie, and live RLS behavior are only partially testable offline and
are explicitly not represented as verified production behavior.
