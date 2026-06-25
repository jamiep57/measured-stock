-- =====================================================================
-- 031 — Loose singles on wastage_lines
-- =====================================================================
-- Lets a wastage line record loose singles alongside whole cases, mirroring
-- delivery_lines.singles / transfer_lines.singles. Stored `qty` stays in
-- whole cases; `singles` holds leftover units. Total wasted cases =
-- qty + singles / units_per_case.
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

ALTER TABLE public.wastage_lines
  ADD COLUMN IF NOT EXISTS singles numeric NOT NULL DEFAULT 0;

ALTER TABLE public.wastage_lines
  DROP CONSTRAINT IF EXISTS wastage_lines_qty_check;

ALTER TABLE public.wastage_lines
  DROP CONSTRAINT IF EXISTS wastage_lines_nonempty_check;

ALTER TABLE public.wastage_lines
  ADD CONSTRAINT wastage_lines_nonempty_check
  CHECK (qty >= 0 AND singles >= 0 AND (qty > 0 OR singles > 0));
