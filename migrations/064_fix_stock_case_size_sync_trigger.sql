-- Fix: updating only case_size_id was ignored when stock_case_size_id was already set.
-- The old trigger always preferred stock_case_size_id and overwrote the new case_size_id.
-- Now: if case_size_id changes independently, mirror it onto stock_case_size_id.

CREATE OR REPLACE FUNCTION public.sync_product_from_stock_case_size()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cs record;
  stock_changed boolean;
  case_changed boolean;
BEGIN
  stock_changed := (TG_OP = 'INSERT')
    OR (NEW.stock_case_size_id IS DISTINCT FROM OLD.stock_case_size_id);
  case_changed := (TG_OP = 'INSERT')
    OR (NEW.case_size_id IS DISTINCT FROM OLD.case_size_id);

  -- case_size_id-only updates (legacy / older clients): adopt as stock pack
  IF case_changed AND NOT stock_changed THEN
    NEW.stock_case_size_id := NEW.case_size_id;
  ELSIF NEW.case_size_id IS NOT NULL AND NEW.stock_case_size_id IS NULL THEN
    NEW.stock_case_size_id := NEW.case_size_id;
  END IF;

  IF NEW.stock_case_size_id IS NOT NULL THEN
    SELECT label, units_per_case, stock_unit, servings_per_unit
      INTO cs
      FROM public.case_sizes
     WHERE id = NEW.stock_case_size_id;
    IF FOUND THEN
      NEW.case_size_id := NEW.stock_case_size_id;
      NEW.case_size := cs.label;
      NEW.units_per_case := cs.units_per_case;
      NEW.stock_unit := cs.stock_unit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
