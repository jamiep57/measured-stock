# Migrations

SQL files that move the Supabase database from the legacy "jsonb blob per
event" model into the relational v2 schema (plus V4-only extensions and the
sync infrastructure that keeps the two in step during the cutover).

## Order

Apply in numbered order in **Supabase Dashboard → SQL Editor**. Each file is
idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so
re-running the same file is safe.

| File | Purpose | Apply to |
|------|---------|----------|
| `001_base_v2_schema.sql` | Core v2 tables (events, products, event_products, distribution, bars, recipients, stock_counts, …) | dev first, then prod |
| `002_v4_extensions.sql` | V4-only columns + new tables (closing cases/singles, already_in_stock, topups, wastage, till, modifier, recipes, bug_reports) | dev first, then prod |
| `003_sync_infrastructure.sql` | `legacy_id_map`, `events.synced_at`, `system_sync_state` (used by the live sync function) | dev first, then prod |
| `004_rls_policies.sql` | Open RLS policies on new tables that match `stock_events` permissions (so anon key keeps working from the browser; service role bypasses) | dev first, then prod |
| `005_fix_products_units_per_case.sql` | `products.units_per_case` → `numeric` (V4 allows fractional `unitsPerSku`, e.g. 52.8) | dev/prod if 001 already ran with `integer` |
| `006_fix_event_products_already_in_stock.sql` | `event_products.already_in_stock` → `numeric` (e.g. 5.8) | dev/prod if 002 already ran with `integer` |
| `014_cutover_event_children.sql` | Documents event-children cutover; repairs inflated `close_count` from old sync formula | prod after deploying cutover sync-engine |

## Safety notes

- **`stock_events` is never touched** by these migrations. It stays exactly
  as it is today so V4 keeps working unchanged through the entire cutover.
- These migrations are **additive only**. They don't drop anything, don't
  rename anything, and don't alter existing constraints. If anything goes
  wrong you can drop the new tables (Phase 1 rollback) without affecting
  production.
- Run on **dev** (`tcanalefwoidxuawazcf`) first end-to-end and verify the
  sync function works there before touching production
  (`qqdvzcaukstfdixnfuqq`).

## Apply procedure

1. Open Supabase Dashboard → your project → **SQL Editor** → **New query**
2. Paste the contents of `001_base_v2_schema.sql`, click **Run**
3. Confirm no errors; expect "Success. No rows returned."
4. Repeat for `002`, `003`, `004`
5. Run the verification block at the bottom of `004_rls_policies.sql` —
   it lists every new table and confirms RLS is on with the expected
   policies.

## Rollback (drop all new tables)

If you need to undo everything before deploying the sync function:

```sql
-- See migrations/_rollback_all.sql for the full DROP TABLE block
```
