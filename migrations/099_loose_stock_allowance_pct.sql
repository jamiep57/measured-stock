-- =====================================================================
-- 099 — Loose stock allowance is a percentage
-- =====================================================================
-- The allowance is a share of the loose singles (0–100), not a unit
-- count. loose_stock_allowances had no rows, so the unit column is
-- replaced rather than converted.
--
-- Apply: AFTER 098. Idempotent: yes.
-- =====================================================================

ALTER TABLE public.loose_stock_allowances
  ADD COLUMN IF NOT EXISTS allowance_pct numeric;

ALTER TABLE public.loose_stock_allowances
  DROP COLUMN IF EXISTS allowance_units;

ALTER TABLE public.loose_stock_allowances
  ALTER COLUMN allowance_pct SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loose_stock_allowances_pct_range'
  ) THEN
    ALTER TABLE public.loose_stock_allowances
      ADD CONSTRAINT loose_stock_allowances_pct_range
      CHECK (allowance_pct >= 0 AND allowance_pct <= 100);
  END IF;
END $$;
