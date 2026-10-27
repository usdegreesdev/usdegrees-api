-- Migration: data needed by GET /me/billing (Plan Details popup).
-- Idempotent — safe to re-run. Run BEFORE deploying the code that uses it:
--   psql "$DATABASE_URL" -f src/db/migrations/billing_details.sql

-- 1. Pack catalog (features / validity). Checkout still prices from
--    CREDIT_PACKS in config/stripe.ts; this table only supplies display data.
CREATE TABLE IF NOT EXISTS credit_packs (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  features       TEXT[] NOT NULL DEFAULT '{}',
  validity_days  INTEGER CHECK (validity_days IS NULL OR validity_days > 0),  -- NULL = never expires
  active         BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO credit_packs (id, name, features)
VALUES ('starter', 'Starter pack', ARRAY[
  'College Decision Reports',
  'Compare up to 3 colleges per report',
  'Downloadable PDF'
])
ON CONFLICT (id) DO NOTHING;

-- 2. Card + receipt details and payment status on each payment.
ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS card_brand    TEXT,
  ADD COLUMN IF NOT EXISTS card_last4    TEXT,
  ADD COLUMN IF NOT EXISTS receipt_email TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'refunded', 'failed'));

-- 3. Marks reports that spent a prepaid credit, so credit usage lists only
--    those (free reports from before STRIPE_REQUIRE_PAYMENT never appear).
ALTER TABLE usdreports
  ADD COLUMN IF NOT EXISTS credit_spent BOOLEAN NOT NULL DEFAULT FALSE;
