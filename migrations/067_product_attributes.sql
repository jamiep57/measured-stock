-- =====================================================================
-- 067 — Product menu name, pallet quantity, keg coupler and gas type
-- =====================================================================
-- Background:
--   menu_name is the customer-facing name printed on menus and exports
--   (e.g. "Utopian" → "Utopian Premium British Lager"). Falls back to
--   name when empty.
--   pallet_qty overrides case_sizes.cases_per_pallet for this product.
--   keg_coupler_type / dispense_gas_type drive bar build and gas orders.
--
-- Apply: AFTER 066
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS menu_name text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pallet_qty numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS keg_coupler_type text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS dispense_gas_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pallet_qty_positive') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_pallet_qty_positive CHECK (pallet_qty IS NULL OR pallet_qty > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_keg_coupler_type_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_keg_coupler_type_check CHECK (
        keg_coupler_type IS NULL OR keg_coupler_type IN (
          'S', 'A', 'G', 'D', 'U', 'M', 'KeyKeg', 'Sankey', 'none'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_dispense_gas_type_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_dispense_gas_type_check CHECK (
        dispense_gas_type IS NULL OR dispense_gas_type IN (
          'CO2', 'Mixed 60/40', 'Mixed 70/30', 'Mixed 50/50', 'Nitrogen', 'Beer gas', 'none'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_menu_name_length') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_menu_name_length CHECK (menu_name IS NULL OR char_length(menu_name) <= 120);
  END IF;
END $$;

COMMENT ON COLUMN public.products.menu_name IS 'Customer-facing menu name; exports fall back to name.';
COMMENT ON COLUMN public.products.pallet_qty IS 'Cases per pallet for this product; overrides case_sizes.cases_per_pallet.';
COMMENT ON COLUMN public.products.keg_coupler_type IS 'Keg coupler / extractor type (S, A, G, D, U, M, KeyKeg, Sankey).';
COMMENT ON COLUMN public.products.dispense_gas_type IS 'Dispense gas required (CO2, mixed gas blends, nitrogen).';
