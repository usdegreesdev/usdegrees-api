/**
 * Stable identifiers for the approximate annual household income slabs stored in
 * usdusers.household_income_range. Display labels live in the frontend; keep
 * this list in sync with the DB CHECK constraint.
 */
export const HOUSEHOLD_INCOME_RANGES = [
  "0_30000",
  "30001_48000",
  "48001_75000",
  "75001_110000",
  "110001_plus",
] as const;
