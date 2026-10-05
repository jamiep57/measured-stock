-- 024 — Financial recon fields on closing_stock
-- Per-product notes and budget overrides for post-event reconciliation.

ALTER TABLE public.closing_stock
  ADD COLUMN IF NOT EXISTS recon_note      text,
  ADD COLUMN IF NOT EXISTS budget_method   text
    CHECK (budget_method IS NULL OR budget_method IN (
      'auto', 'consumption', 'consumption_loose', 'plu', 'invoice', 'manual'
    )),
  ADD COLUMN IF NOT EXISTS budget_override numeric;

COMMENT ON COLUMN public.closing_stock.recon_note IS
  'Free-text note from Financial Recon (e.g. investigate, wastage allowance).';
COMMENT ON COLUMN public.closing_stock.budget_method IS
  'How budget cost is chosen: auto (default rules) or a specific charge column, or manual.';
COMMENT ON COLUMN public.closing_stock.budget_override IS
  'Manual budget cost (£) when budget_method = manual.';
