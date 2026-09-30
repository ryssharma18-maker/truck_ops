-- Stripe event ledger and Postgres-backed rate limit counters.
--
-- Hand-written rather than generated: `prisma migrate dev` needs a shadow
-- database, and neither Supabase pooler port can host one (the transaction
-- pooler does not support it at all, and the session pooler is not a direct
-- connection). This is written to match prisma/schema.prisma exactly, so
-- `prisma migrate diff` reports no drift.

-- Idempotency ledger for Stripe webhooks. Stripe delivers at-least-once and
-- out of order, and redelivers anything that does not get a 2xx within ~72h.
-- Without this table a replayed subscription event rewinds entitlements.
CREATE TABLE IF NOT EXISTS "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL DEFAULT 'stripe',
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "user_id" UUID,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stripe_events_type_idx" ON "stripe_events" ("type");
CREATE INDEX IF NOT EXISTS "stripe_events_user_id_idx" ON "stripe_events" ("user_id");
CREATE INDEX IF NOT EXISTS "stripe_events_processed_at_idx" ON "stripe_events" ("processed_at");

-- Fixed-window counters. See the RateLimit model comment in schema.prisma for
-- why this lives in Postgres instead of process memory.
CREATE TABLE IF NOT EXISTS "rate_limits" (
    "bucket_key" VARCHAR(64) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("bucket_key")
);

CREATE INDEX IF NOT EXISTS "rate_limits_expires_at_idx" ON "rate_limits" ("expires_at");
