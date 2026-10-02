# Phase 2: demo seed safety

The demo seed is destructive and is intended only for an explicitly selected
non-production account. Before it reads the database, it requires:

- `SEED_TARGET_ENVIRONMENT=development` or `preview`;
- an explicit `SEED_EMAIL`;
- `SEED_CONFIRM_DESTRUCTIVE` exactly equal to
  `DELETE ALL DATA FOR <lowercase target email>`;
- `DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` that identify the same project
  ref, with that ref in the checked-in non-production project allowlist.

`NODE_ENV`, `VERCEL_ENV`, `APP_ENV`, `DEPLOYMENT_ENV`, and the selected target
environment are checked for `prod`/`production`; any such marker rejects the
run without an override. The target email must resolve to an existing
`public.users` row and is converted to that profile's user ID before the
preflight. A missing profile fails closed. The seed no longer creates or
deletes auth users, deletes orphan profiles, or creates profile rows.

The configured database identity is checked before the profile lookup. Direct
Supabase database URLs use the `db.<project-ref>.supabase.co` hostname, and
pooler URLs use the `postgres.<project-ref>` username. The Supabase API URL
must use `<project-ref>.supabase.co`. Both identities must match the checked-in
allowlist; missing, malformed, mismatched, unknown, or non-allowlisted
production refs fail closed. Adding an approved non-production project
requires a deliberate source change; there is no runtime production override.
No non-production project is currently allowlisted, so seeding must fail
closed before a profile lookup or any write. The confirmed production project
ref `papddtmsiajajcvdrody` is rejected and must not be added to the allowlist.
Seeding remains unavailable until a real non-production project is
independently confirmed and deliberately allowlisted.

When password reset is requested, the seed verifies the selected Supabase Auth
user ID and matching email before any destructive write. The preflight prints
the resolved account and user ID, per-table row counts for each table the seed
deletes, total planned rows, whether the optional demo password reset is
requested, and that no backup is created. All row deletions filter on the
resolved target `userId`. The profile is updated to demo profile values and
its operational data is replaced.

To opt into changing the Supabase password, set
`SEED_RESET_DEMO_PASSWORD=true`; this is allowed only for the exact
`demo@truckops.ai` target, requires the service-role key, verifies the auth
user ID/email match, and then resets the password and confirms its email. It
is off by default. Do not use this flag for other users.

Verification is repository-only:
`npm run verify:seed-safety` tests invocation policy, target resolution,
mutation ordering, and user-scoped deletes without importing or running the
seed script. No database or Supabase service is contacted by that check.

There is no built-in backup or atomic transaction covering the full
delete-and-repopulate workflow.
