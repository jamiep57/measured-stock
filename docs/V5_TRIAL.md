# V5 staging trial checklist

Apply migrations on Supabase **before** trialling V5 on production data:

1. Run [`migrations/043_v5_case_size_fks.sql`](../migrations/043_v5_case_size_fks.sql)
2. Run audit queries at the bottom of 043; fix any unmatched pack sizes
3. **Do not** run 044 until V5 counts are validated on a trial event

## Trial rules

- Staff use **V5 only** (`/app`) for counts and deliveries on the trial event
- Admin setup stays on V4 (`/`) until V5.2
- Configure per-bar product menus in v2 **Distribution** (+/× on each bar column) — V5 counts only show products assigned to the selected bar
- Do not edit the same spirit/wine count rows in V4 mobile during the trial

## Smoke test

1. Open `/app`, select event, create count session
2. Enter spirits: Bottles + Partial (e.g. `24` + `0.5`) — reload page, values unchanged (WYSIWYG)
3. Enter wine: Bottles + Partial (e.g. `0.5`)
4. Enter beer: Cases + Singles (loose cans only)
5. Log delivery — spirits/wine: bottles + partial; beer: cases + singles
6. Toggle airplane mode, enter count, reconnect — sync badge clears after flush

## After trial passes

Run [`migrations/044_v5_spirits_wine_bottle_stock.sql`](../migrations/044_v5_spirits_wine_bottle_stock.sql) on staging first, re-test, then production.

## Local dev

```bash
cd v5
npm install
npm run dev
# open http://localhost:5173/app/
```

```bash
npm test
npm run build
```
