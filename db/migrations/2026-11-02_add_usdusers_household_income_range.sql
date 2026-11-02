ALTER TABLE usdusers ADD COLUMN IF NOT EXISTS household_income_range text;
ALTER TABLE usdusers DROP CONSTRAINT IF EXISTS usdusers_household_income_range_check;
ALTER TABLE usdusers ADD CONSTRAINT usdusers_household_income_range_check CHECK (household_income_range IS NULL OR household_income_range IN ('0_30000','30001_48000','48001_75000','75001_110000','110001_plus'));
