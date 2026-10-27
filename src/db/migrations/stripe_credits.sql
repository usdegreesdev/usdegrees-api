-- Migration: Stripe report-credit packs.
-- Idempotent — safe to re-run.
--
-- Run manually (no auto-migration on boot), e.g.:
--   psql "$DATABASE_URL" -f src/db/migrations/stripe_credits.sql

ALTER TABLE usdusers
  ADD COLUMN IF NOT EXISTS report_credits INTEGER NOT NULL DEFAULT 0 CHECK (report_credits >= 0),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- One row per fulfilled Checkout Session. The UNIQUE session id is what makes
-- webhook retries / duplicate deliveries grant credits exactly once.
CREATE TABLE IF NOT EXISTS stripe_payments (
  id                 SERIAL PRIMARY KEY,
  stripe_session_id  TEXT NOT NULL UNIQUE,
  payment_intent_id  TEXT,
  user_id            INTEGER NOT NULL REFERENCES usdusers(id),
  pack_id            TEXT NOT NULL,
  credits            INTEGER NOT NULL,
  amount_total       INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stripe_payments_user_idx ON stripe_payments (user_id);
