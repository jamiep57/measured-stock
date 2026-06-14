-- =====================================================================
-- 022 — Loose singles on transfer_lines
-- =====================================================================
-- Lets a transfer line record loose singles (individual units) alongside
-- whole cases, mirroring delivery_lines.singles / stock_count_lines. The
-- stored `qty` stays in whole cases; `singles` holds leftover units that
-- don't make a full case. Total cases transferred = qty + singles / upc.
--
-- The original CHECK (qty > 0) is relaxed so a line can carry singles only
-- (qty = 0). A new constraint keeps every line non-empty: qty + singles > 0.
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

ALTER TABLE public.transfer_lines
  ADD COLUMN IF NOT EXISTS singles numeric NOT NULL DEFAULT 0;

ALTER TABLE public.transfer_lines
  DROP CONSTRAINT IF EXISTS transfer_lines_qty_check;

ALTER TABLE public.transfer_lines
  DROP CONSTRAINT IF EXISTS transfer_lines_nonempty_check;

ALTER TABLE public.transfer_lines
  ADD CONSTRAINT transfer_lines_nonempty_check
  CHECK (qty >= 0 AND singles >= 0 AND (qty > 0 OR singles > 0));

-- Verify:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'transfer_lines'
--   AND column_name IN ('qty','singles');
