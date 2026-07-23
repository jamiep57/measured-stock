-- =====================================================================
-- 044 — V5 spirit/wine stock normalisation (apply AFTER V5 counts proven)
-- =====================================================================
-- Points spirit/wine products at bottle stock packs (70cl, 750ml, …)
-- instead of supplier multi-packs (6×700ml). Does NOT scale historical
-- count lines — run only after validating V5 on staging / new events.
-- Idempotent: yes.
-- =====================================================================

-- Spirits category: stock pack → bottle row derived from case_size text
UPDATE public.products p
SET stock_case_size_id = cs.id
FROM public.categories c,
     public.case_sizes cs
WHERE p.category_id = c.id
  AND c.colour_key = 'spirits'
  AND cs.stock_unit = 'bottle'
  AND cs.pack_usage IN ('stock', 'both')
  AND (
    (lower(coalesce(p.case_size, '')) ~ '1\s*l|100cl|1\s*litre' AND cs.label = '1L')
    OR (lower(coalesce(p.case_size, '')) ~ '750|75\s*cl' AND cs.label = '750ml')
    OR (cs.label = '70cl')
  )
  AND NOT (lower(coalesce(p.case_size, '')) ~ 'x\s*250|x\s*330|x\s*200|x\s*275');

-- Wine category: prefer 750ml bottle stock pack
UPDATE public.products p
SET stock_case_size_id = cs.id
FROM public.categories c,
     public.case_sizes cs
WHERE p.category_id = c.id
  AND c.colour_key = 'wine'
  AND cs.label = '750ml'
  AND cs.stock_unit = 'bottle'
  AND (
    lower(coalesce(p.case_size, '')) ~ '750|75\s*cl|wine'
    OR lower(coalesce(p.case_size, '')) ~ '^\d+\s*x'
    OR p.case_size IS NULL
  );

-- Wine 187ml / small format
UPDATE public.products p
SET stock_case_size_id = cs.id
FROM public.categories c,
     public.case_sizes cs
WHERE p.category_id = c.id
  AND c.colour_key = 'wine'
  AND cs.label IN ('187ml', '12×187ml Cans', '12×187ml PET')
  AND lower(coalesce(p.case_size, '')) ~ '187';

-- Ensure supplier offers on multi-pack spirits point at purchase catalogue rows
UPDATE public.product_suppliers ps
SET purchase_case_size_id = cs.id
FROM public.products p,
     public.categories c,
     public.case_sizes cs
WHERE ps.product_id = p.id
  AND p.category_id = c.id
  AND c.colour_key = 'spirits'
  AND ps.purchase_case_size_id IS NULL
  AND coalesce(trim(ps.pack_size), trim(p.case_size), '') <> ''
  AND public.norm_case_size_alias(coalesce(nullif(trim(ps.pack_size), ''), p.case_size))
      = public.norm_case_size_label(cs.label)
  AND cs.pack_usage IN ('purchase', 'both');

-- =====================================================================
-- PRE-FLIGHT (do not skip):
--   SELECT p.name, p.case_size, cs.label AS stock_pack
--     FROM products p
--     LEFT JOIN case_sizes cs ON cs.id = p.stock_case_size_id
--     JOIN categories c ON c.id = p.category_id
--    WHERE c.colour_key IN ('spirits', 'wine')
--    ORDER BY c.colour_key, p.name;
-- =====================================================================
