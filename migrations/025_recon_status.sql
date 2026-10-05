-- 025 — Traffic-light status markers on Financial Recon line items

ALTER TABLE public.closing_stock
  ADD COLUMN IF NOT EXISTS recon_status text
    CHECK (recon_status IS NULL OR recon_status IN ('red', 'yellow', 'green'));

COMMENT ON COLUMN public.closing_stock.recon_status IS
  'Financial Recon follow-up marker: red = action needed, yellow = review, green = done.';
