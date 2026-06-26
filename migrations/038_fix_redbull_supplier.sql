-- =====================================================================
-- 038 — Red Bull preferred supplier: LWC not RW
-- =====================================================================
-- Red Bull 24×250ml was merged from an older RW 330ml SKU. The RW
-- product_suppliers row stayed is_preferred=true, so recon/orders showed
-- RW instead of LWC.
-- =====================================================================

UPDATE public.product_suppliers ps
SET is_preferred = true
FROM public.products p, public.suppliers s
WHERE p.id = ps.product_id
  AND ps.supplier_id = s.id
  AND p.name = 'Red Bull'
  AND p.case_size = '24×250ml'
  AND s.name = 'LWC';

SELECT public.sync_product_preferred_supplier(p.id)
FROM public.products p
WHERE p.name = 'Red Bull' AND p.case_size = '24×250ml';
