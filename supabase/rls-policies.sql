-- TruckOps AI — Supabase post-migration SQL
-- Run this AFTER `npx prisma migrate deploy`, in the Supabase SQL editor.
-- Order matters: 1) generated column, 2) inbox email helper + auth trigger,
-- 3) RLS enable, 4) policies, 5) storage policies.

-- =====================================================================
-- 1. total_invoice_amount as a real generated column
-- =====================================================================
-- Prisma has no generated-column support, so the schema declares it as a
-- plain Decimal with a default and we convert it here. The app must never
-- write to this column.

ALTER TABLE loads DROP COLUMN IF EXISTS total_invoice_amount;

ALTER TABLE loads
  ADD COLUMN total_invoice_amount NUMERIC(10,2)
  GENERATED ALWAYS AS (
    COALESCE(rate_amount, 0)
    + COALESCE(fuel_surcharge, 0)
    + COALESCE(detention_amount, 0)
    + COALESCE(lumper_amount, 0)
  ) STORED;

-- =====================================================================
-- 2. Auto-provision a public.users row when a Supabase auth user is created
-- =====================================================================

CREATE OR REPLACE FUNCTION public.generate_inbox_email()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  slug TEXT;
  candidate TEXT;
BEGIN
  LOOP
    -- 8 chars of lowercase alphanumeric entropy
    slug := lower(substring(encode(gen_random_bytes(8), 'hex') FROM 1 FOR 8));
    candidate := 'fleet-' || slug || '@inbox.truckops.ai';
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE inbox_email = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id, email, full_name, company_name, phone,
    subscription_plan, truck_count, inbox_email, created_at, updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'company_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
    'trial',
    COALESCE((NEW.raw_user_meta_data ->> 'truck_count')::INT, 1),
    public.generate_inbox_email(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Keep email in sync if the user changes it in Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_email_change();

-- =====================================================================
-- 3. Enable RLS on every table
-- =====================================================================

ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE trucks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE loads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE detention_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ifta_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;

-- Maritime vertical
ALTER TABLE shipping_vessels     ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_ports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_bookings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_containers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_manifests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_invoices    ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner, so a leaked owner-role connection
-- string does not hand over the whole database. The service_role key
-- bypasses this by design — keep it server-side only.
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE trucks               FORCE ROW LEVEL SECURITY;
ALTER TABLE drivers              FORCE ROW LEVEL SECURITY;
ALTER TABLE brokers              FORCE ROW LEVEL SECURITY;
ALTER TABLE loads                FORCE ROW LEVEL SECURITY;
ALTER TABLE documents            FORCE ROW LEVEL SECURITY;
ALTER TABLE invoices             FORCE ROW LEVEL SECURITY;
ALTER TABLE detention_records    FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE email_logs           FORCE ROW LEVEL SECURITY;
ALTER TABLE ifta_records         FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications        FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        FORCE ROW LEVEL SECURITY;

ALTER TABLE shipping_vessels     FORCE ROW LEVEL SECURITY;
ALTER TABLE shipping_ports       FORCE ROW LEVEL SECURITY;
ALTER TABLE shipping_bookings    FORCE ROW LEVEL SECURITY;
ALTER TABLE shipping_containers  FORCE ROW LEVEL SECURITY;
ALTER TABLE shipping_manifests   FORCE ROW LEVEL SECURITY;
ALTER TABLE shipping_documents   FORCE ROW LEVEL SECURITY;
ALTER TABLE shipping_invoices    FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- 4. Policies
-- =====================================================================

-- users: a person sees and edits only their own row. No INSERT policy —
-- rows are created by the auth trigger. No DELETE policy — account
-- deletion goes through auth.users and cascades.
DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Every other table: one ALL policy keyed on user_id.
-- USING governs read/update/delete visibility; WITH CHECK stops a user
-- from inserting or moving a row into someone else's account.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'trucks', 'drivers', 'brokers', 'loads', 'documents', 'invoices',
    'detention_records', 'compliance_documents', 'email_logs',
    'ifta_records', 'notifications',
    'shipping_vessels', 'shipping_ports', 'shipping_bookings',
    'shipping_containers', 'shipping_manifests', 'shipping_documents',
    'shipping_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_owner_all', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
        FOR ALL TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()));
    $f$, t || '_owner_all', t);
  END LOOP;
END;
$$;

-- subscriptions: read-only for the user. Only the Stripe webhook
-- (service_role) writes here, so a user cannot grant themselves a plan.
DROP POLICY IF EXISTS subscriptions_select_own ON subscriptions;
CREATE POLICY subscriptions_select_own ON subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =====================================================================
-- 5. Storage
-- =====================================================================
-- Two private buckets. Object paths MUST start with the owner's user id:
--   documents/<user_id>/<load_id|unfiled>/<uuid>-<filename>
--   compliance/<user_id>/<uuid>-<filename>
-- The policies below enforce that prefix.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('documents', 'documents', FALSE, 26214400,
   ARRAY['application/pdf','image/jpeg','image/png','image/heic','image/webp']),
  ('compliance', 'compliance', FALSE, 26214400,
   ARRAY['application/pdf','image/jpeg','image/png','image/heic','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = FALSE;

DO $$
DECLARE
  b TEXT;
BEGIN
  FOREACH b IN ARRAY ARRAY['documents', 'compliance'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', b || '_owner_all');
    EXECUTE format($f$
      CREATE POLICY %I ON storage.objects
        FOR ALL TO authenticated
        USING (
          bucket_id = %L
          AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        )
        WITH CHECK (
          bucket_id = %L
          AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        );
    $f$, b || '_owner_all', b, b);
  END LOOP;
END;
$$;

-- =====================================================================
-- 6. Verification — every one of these should return zero rows
-- =====================================================================
-- The explicit table lists above must be kept in sync with prisma/schema.prisma
-- by hand, so these two queries are the safety net: they derive the expected
-- set from the live catalog instead of from this file.
--
-- Any table carrying a user_id column that is missing RLS. A new model added
-- to the Prisma schema and migrated without adding it to section 3 will show
-- up here.
--
--   SELECT c.relname
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   JOIN pg_attribute a ON a.attrelid = c.oid
--        AND a.attname = 'user_id' AND a.attnum > 0 AND NOT a.attisdropped
--   WHERE n.nspname = 'public'
--     AND c.relkind = 'r'
--     AND NOT c.relrowsecurity
--   GROUP BY c.relname
--   ORDER BY 1;
--
-- Tables in public with RLS disabled (catches helper tables with no user_id):
--
--   SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity = FALSE;
--
-- Tables in public with RLS on but no policy (these deny everything,
-- which is safe but usually a mistake):
--
--   SELECT t.tablename FROM pg_tables t
--   LEFT JOIN pg_policies p ON p.tablename = t.tablename
--   WHERE t.schemaname = 'public' AND t.rowsecurity AND p.policyname IS NULL;
--
-- Cross-tenant read attempt — must return zero rows for any uid that is not
-- the row owner. Run with :'uid' set to a real auth.users id:
--
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claim.sub = '<some-other-users-uuid>';
--   SELECT count(*) FROM loads;
