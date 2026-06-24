-- 029 — Add "none returned" (blue) status marker to Financial Recon

ALTER TABLE public.closing_stock
  DROP CONSTRAINT IF EXISTS closing_stock_recon_status_check;

ALTER TABLE public.closing_stock
  ADD CONSTRAINT closing_stock_recon_status_check
  CHECK (recon_status IS NULL OR recon_status IN ('red', 'yellow', 'green', 'blue'));

COMMENT ON COLUMN public.closing_stock.recon_status IS
  'Financial Recon follow-up marker: red = action needed, yellow = review, green = done, blue = none returned.';
