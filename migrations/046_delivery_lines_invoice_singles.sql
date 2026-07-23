-- =====================================================================
-- 046 — Loose singles on delivery_lines invoice qty
-- =====================================================================
-- Mirrors qty/singles: invoice_qty holds whole cases, invoice_singles
-- holds loose units. Both nullable when not entered.
-- =====================================================================

ALTER TABLE public.delivery_lines
  ADD COLUMN IF NOT EXISTS invoice_singles numeric;
