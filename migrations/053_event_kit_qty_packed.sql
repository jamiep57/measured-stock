-- =====================================================================
-- 053 — event_kit_items.qty_packed (pack-list packed qty)
-- =====================================================================

ALTER TABLE public.event_kit_items
  ADD COLUMN IF NOT EXISTS qty_packed numeric NOT NULL DEFAULT 0
  CHECK (qty_packed >= 0);

COMMENT ON COLUMN public.event_kit_items.qty_packed IS
  'Packed qty for the event (Current RMS–style pack list).';
