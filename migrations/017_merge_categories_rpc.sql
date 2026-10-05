-- =====================================================================
-- 017 — merge_categories(): fold duplicate categories into one
-- =====================================================================
-- The categories table accumulates duplicates of the same group entered
-- with different casing/spelling (e.g. "Beer" / "BEER" / "PACKAGED BEER").
-- This function merges a set of duplicate category ids into a single
-- keeper: every product that points at a duplicate is re-pointed to the
-- keeper, then the duplicate category rows are deleted.
--
-- categories is referenced by exactly one FK:
--   products.category_id  REFERENCES categories(id)  (NO ACTION)
-- so re-pointing products is the only child update required. No unique
-- constraint can collide (a product has a single category_id), so this is
-- a plain UPDATE — no quantity summing needed.
--
-- Apply: AFTER 016. Idempotent: yes (CREATE OR REPLACE).
-- Runs in an implicit transaction — all-or-nothing.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.merge_categories(p_keep uuid, p_dups uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_dups   uuid[];
  v_merged int;
BEGIN
  IF p_keep IS NULL THEN
    RAISE EXCEPTION 'merge_categories: keeper id is required';
  END IF;

  -- Sanitise: drop nulls, the keeper itself, and repeats from the list.
  SELECT array_agg(DISTINCT d) INTO v_dups
  FROM unnest(coalesce(p_dups, '{}'::uuid[])) AS d
  WHERE d IS NOT NULL AND d <> p_keep;

  IF v_dups IS NULL OR array_length(v_dups, 1) IS NULL THEN
    RETURN jsonb_build_object('kept', p_keep, 'merged', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = p_keep) THEN
    RAISE EXCEPTION 'merge_categories: keeper category % does not exist', p_keep;
  END IF;

  -- Re-point every product on a duplicate category to the keeper.
  UPDATE products SET category_id = p_keep WHERE category_id = ANY(v_dups);

  -- Delete the now-orphaned duplicate categories.
  DELETE FROM categories WHERE id = ANY(v_dups);
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  RETURN jsonb_build_object('kept', p_keep, 'merged', v_merged);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.merge_categories(uuid, uuid[]) TO anon, authenticated, service_role;

-- =====================================================================
-- DONE. This mutates data; call it from the app's "Merge categories" UI,
-- or manually:
--   SELECT public.merge_categories('<keep-uuid>', ARRAY['<dup-uuid>']::uuid[]);
-- =====================================================================
