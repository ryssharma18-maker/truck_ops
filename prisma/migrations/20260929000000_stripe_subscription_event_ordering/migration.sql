-- Track the newest Stripe subscription event applied to each account.
-- The webhook locks the user row while checking/updating this value, so
-- concurrent deliveries cannot apply an older event after a newer one.
ALTER TABLE "users"
ADD COLUMN "last_stripe_subscription_event_created" BIGINT NOT NULL DEFAULT 0;
