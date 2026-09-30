-- RLS for the seven shipping_* tables, which shipped with rowsecurity = false.
--
-- Found by running the section 6 verification query in supabase/rls-policies.sql
-- against the live database. That file lists these tables in section 3, but it
-- had clearly not been applied after the maritime module was created, so the
-- file and the database disagreed and nothing caught it.
--
-- Why this matters even though the application is safe:
--
--   The app connects as `postgres`, which has rolbypassrls = true, so Prisma
--   reads and writes these tables regardless of RLS and tenant isolation is
--   carried entirely by the `where userId = ...` clause in application code.
--
--   RLS is therefore not protecting the application. It is protecting the
--   *other* thing it protects: any client holding NEXT_PUBLIC_SUPABASE_ANON_KEY.
--   With rowsecurity off, such a client could select every row in every
--   carrier's shipping_bookings / shipping_containers / shipping_documents /
--   shipping_invoices / shipping_manifests / shipping_ports / shipping_vessels
--   table. The anon key ships to the browser by design, so that was a live
--   cross-tenant data exposure for the whole maritime module.
--
-- This matches the state every other tenant-scoped table is already in
-- (ENABLE + FORCE + one `user_id` policy), and FORCE is safe for the app here
-- because the app's role has BYPASSRLS.
--
-- All seven tables carry a non-null user_id, so a single policy shape applies.
-- Do not re-run supabase/rls-policies.sql to apply this: its section 1
-- recreates a generated column that conflicts with the committed schema.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'shipping_vessels', 'shipping_ports', 'shipping_bookings',
    'shipping_containers', 'shipping_manifests', 'shipping_documents',
    'shipping_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_owner_all', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()));
    $p$, t || '_owner_all', t);
  END LOOP;
END;
$$;

-- Verification. The first query should now return no rows apart from
-- _prisma_migrations, which Prisma manages and must keep reachable:
--
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = FALSE;
--
-- The second should now return exactly rate_limits and stripe_events, the two
-- tables that are deliberately policy-free:
--
--   SELECT t.tablename FROM pg_tables t
--   LEFT JOIN pg_policies p ON p.tablename = t.tablename
--   WHERE t.schemaname = 'public' AND t.rowsecurity AND p.policyname IS NULL;
