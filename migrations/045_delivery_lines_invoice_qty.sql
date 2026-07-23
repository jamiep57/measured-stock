-- =====================================================================
-- 045 — Invoice quantity on delivery_lines
-- =====================================================================
-- Per-line invoice qty (what the supplier billed), stored in whole cases.
-- Nullable when not entered on the delivery line.
-- =====================================================================

ALTER TABLE public.delivery_lines
  ADD COLUMN IF NOT EXISTS invoice_qty numeric;
