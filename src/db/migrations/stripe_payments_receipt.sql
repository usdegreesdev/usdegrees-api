-- Migration: store the Stripe receipt link on each fulfilled payment.
-- Idempotent — safe to re-run. Run BEFORE deploying the code that writes it:
--   psql "$DATABASE_URL" -f src/db/migrations/stripe_payments_receipt.sql

ALTER TABLE stripe_payments
  ADD COLUMN IF NOT EXISTS receipt_url TEXT;
