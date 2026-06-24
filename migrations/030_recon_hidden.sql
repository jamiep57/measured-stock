-- 030 — Exclude products from Financial Recon (per event)

ALTER TABLE public.event_products
  ADD COLUMN IF NOT EXISTS recon_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_products.recon_hidden IS
  'When true, product is excluded from the Financial Recon table and totals.';
