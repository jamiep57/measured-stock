-- =====================================================================
-- 021 — Loose singles on delivery_lines
-- =====================================================================
-- Lets a delivery line record loose singles (individual units) alongside
-- whole cases, mirroring stock_count_lines.cases/singles. The stored `qty`
-- stays in cases; `singles` holds leftover units that don't make a full
-- case. Total cases delivered = qty + singles / units_per_case.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
-- =====================================================================

ALTER TABLE public.delivery_lines
  ADD COLUMN IF NOT EXISTS singles numeric NOT NULL DEFAULT 0;

-- Verify:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'delivery_lines'
--   AND column_name IN ('qty','singles','damaged_qty');
