-- 028 — Per-bottle price override on event_products (Financial Recon, spirits)
-- Complements order_price_override (case price). When set for a spirit bottle
-- product, recon derives case price as bottle price × bottles per case.

ALTER TABLE public.event_products
  ADD COLUMN IF NOT EXISTS order_unit_price_override numeric;

COMMENT ON COLUMN public.event_products.order_unit_price_override IS
  'Per-bottle price override for this event (spirits recon). Case override takes precedence when both are set.';
