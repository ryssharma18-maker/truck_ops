-- RLS for the two tables added in 20260926120000_rate_limits_and_stripe_event_ledger.
--
-- That migration created them but did not enable RLS, so both sat in public
-- with rowsecurity = false. Prisma connects as the table owner and bypasses
-- RLS, so the application was unaffected — but any client holding the anon key
-- could read and write them directly, and these are the two tables where that
-- matters most.
--
-- Kept in its own migration on purpose. supabase/rls-policies.sql must not be
-- re-run to apply this: its section 1 recreates a generated column, which
-- disagrees with the committed schema.prisma (the Prisma model declares
-- totalInvoiceAmount as a plain Decimal) and will not apply cleanly.
--
-- Neither table gets a policy. RLS enabled with zero policies denies every
-- non-service role, which is the intended outcome, not an oversight.

-- ---------------------------------------------------------------------
-- stripe_events: webhook idempotency ledger
-- ---------------------------------------------------------------------
-- service_role writes; the application reads it to decide whether an event has
-- already been handled.
--
-- Deliberately no user-facing policy, even though it has a nullable user_id.
-- Two attacks are available if a tenant can write their own rows:
--
--   * DELETE their checkout.session.completed row, then let the event be
--     redelivered, to force the subscription handler to run again.
--   * INSERT a row for a future event id, so the real event is treated as an
--     already-seen duplicate and silently dropped.
--
-- Both are billing-integrity problems, and neither is something a user should
-- be able to do to their own account. Reading the ledger is not useful to a
-- tenant either. No policy is the safe state; the service role bypasses RLS.
--
-- user_id is nullable because events such as invoice.payment_failed often
-- carry no resolvable account, so a user_id = auth.uid() policy would also
-- silently fail to match the very rows that record failures.
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- rate_limits: atomic request counters
-- ---------------------------------------------------------------------
-- No user_id at all. bucket_key is a hash of the identifier being limited
-- (client IP, email, user id), so a policy keyed on tenancy is not expressible.
--
-- If a tenant could write here, rate limiting would be advisory: the cheapest
-- bypass is to delete or reset the bucket_key row for your own IP before each
-- request, which also evicts the limits protecting other tenants sharing that
-- IP. The limiter relies on write access, so this table must stay above the
-- anon and authenticated roles entirely.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
-- Both should now appear in the RLS-on, no-policy result below, which is the
-- expected state for these two and only these two:
--
--   SELECT t.tablename FROM pg_tables t
--   LEFT JOIN pg_policies p ON p.tablename = t.tablename
--   WHERE t.schemaname = 'public' AND t.rowsecurity AND p.policyname IS NULL;
--
-- The RLS-disabled check from supabase/rls-policies.sql section 6 should now
-- return no rows at all:
--
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = FALSE;
