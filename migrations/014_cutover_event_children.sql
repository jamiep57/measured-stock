-- =====================================================================
-- 014 — Event-children cutover (documentation + close_count repair)
-- =====================================================================
-- Background:
--   As of 2026-06-08 the merged app (v2.html) is the source of truth for
--   event operations. lib/sync-engine.js no longer deletes or overwrites:
--     bars, recipients, event_products, distribution, bar_products,
--     deliveries, transfers, stock_counts, closing_stock, till_imports,
--     modifier_imports, recipes, suppliers, categories, products, events.
--   Blob sync is additive only (seeds missing rows on first sync).
--   Topups and wastage remain blob-owned until their panels are ported.
--
-- This migration repairs close_count values that were synced with the old
-- formula (cases × units_per_case + singles) instead of the correct
-- cases + singles/units_per_case.
--
-- Safe to re-run (idempotent UPDATE).
-- =====================================================================

UPDATE public.closing_stock cs
SET close_count = GREATEST(
  0,
  COALESCE(cs.closing_cases, 0) +
  CASE
    WHEN COALESCE(p.units_per_case, 1) > 0
      THEN COALESCE(cs.closing_singles, 0) / p.units_per_case
    ELSE 0
  END
)
FROM public.products p
WHERE cs.product_id = p.id
  AND (
    COALESCE(cs.closing_cases, 0) != 0
    OR COALESCE(cs.closing_singles, 0) != 0
  );

-- Verify (optional):
--   SELECT cs.closing_cases, cs.closing_singles, p.units_per_case,
--          cs.close_count, cs.event_id
--     FROM closing_stock cs
--     JOIN products p ON p.id = cs.product_id
--    LIMIT 20;
