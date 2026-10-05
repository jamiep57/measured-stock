-- Artist Liasion transfer @ Gottwood 2026 (2026-06-14): case-counted lines were
-- saved with qty=0 and the full case count in singles (e.g. Mango singles=17 →
-- displayed as "1 case · 5 singles" instead of "17 cases").
-- Bottle/per-unit lines on the same transfer are correct (qty=0, singles=N is valid).
UPDATE transfer_lines tl
SET
  qty = tl.singles,
  singles = 0
FROM products p
WHERE tl.product_id = p.id
  AND p.stock_unit = 'case'
  AND tl.transfer_id = '7b02319c-7d57-44ef-9366-f0f97ba514f2'
  AND tl.qty = 0
  AND tl.singles > 0;
