-- 028 — Per-unit price override on event_products (Financial Recon)
-- Complements order_price_override (case price). When set, recon derives case
-- price as unit price × units per case (bottles per case for spirits).

ALTER TABLE public.event_products
  ADD COLUMN IF NOT EXISTS order_unit_price_override numeric;

COMMENT ON COLUMN public.event_products.order_unit_price_override IS
  'Per-unit price override for this event (Financial Recon). Case override takes precedence when both are set.';
