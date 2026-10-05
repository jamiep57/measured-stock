-- Monin Gomme @ Gottwood 2026: closing_cases = 124 individual bottles but close_count
-- was 744 (124 × 6) because entryUnitsPerCase inferred 6×700ml from the 70cl label.
-- Recon then computed consumption = 240 delivered − 744 closing = −504.
UPDATE closing_stock
SET
  close_count = 124,
  carried_over = 88
WHERE event_id = 'ca9aad27-2284-4308-9b1c-a2256ab6b241'
  AND product_id = '1e39c1fb-0537-411a-9046-32356e2b09f7'
  AND closing_cases = 124
  AND close_count = 744;
