-- Fee Bros Cherry Bitters @ Gottwood 2026: closing count was 24 individual bottles,
-- not 24 supplier cases (which the app stored as 288 bottles).
UPDATE closing_stock
SET
  closing_cases = 2,
  closing_singles = 0,
  close_count = 24,
  carried_over = 0,
  return_amount = 24
WHERE event_id = 'ca9aad27-2284-4308-9b1c-a2256ab6b241'
  AND product_id = 'a2e279fd-5da8-4d4d-a891-6fd59eb03d58'
  AND closing_cases = 24
  AND close_count = 288;
