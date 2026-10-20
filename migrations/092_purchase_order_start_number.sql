-- =====================================================================
-- 092 — Purchase order numbers can start from a chosen value
-- =====================================================================
-- Each organisation chooses the lowest number a new purchase order may
-- take. The next reference is the greater of that floor and one more
-- than the highest PO- number already used, so existing numbers are
-- never reused. A blank reference still becomes PO-00001 style.
--
-- Apply: AFTER 091
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS po_start_number integer NOT NULL DEFAULT 1;

ALTER TABLE public.organisations
  DROP CONSTRAINT IF EXISTS organisations_po_start_number_check;

ALTER TABLE public.organisations
  ADD CONSTRAINT organisations_po_start_number_check
  CHECK (po_start_number >= 1 AND po_start_number <= 9999999);

COMMENT ON COLUMN public.organisations.po_start_number IS
  'Lowest number a new purchase order reference may use. Existing PO- numbers are never reused.';

CREATE OR REPLACE FUNCTION public.purchase_orders_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
  v_floor integer;
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    SELECT COALESCE(po_start_number, 1)
      INTO v_floor
      FROM public.organisations
     WHERE id = NEW.org_id;
    v_floor := COALESCE(v_floor, 1);

    SELECT COALESCE(max((substring(reference FROM '^PO-(\d+)$'))::integer), 0) + 1
      INTO v_next
      FROM public.purchase_orders
     WHERE org_id = NEW.org_id;

    IF v_next < v_floor THEN
      v_next := v_floor;
    END IF;

    -- Pad up to five digits. lpad truncates when the length is shorter
    -- than the text, so a start number above 99999 must keep its full width.
    NEW.reference := 'PO-' || lpad(v_next::text, GREATEST(5, char_length(v_next::text)), '0');
  ELSE
    NEW.reference := btrim(NEW.reference);
  END IF;
  RETURN NEW;
END;
$$;
