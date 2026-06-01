-- =====================================================================
-- Rollback — drops every table created by migrations 001–003.
-- DOES NOT TOUCH public.stock_events (V4's source of truth).
-- =====================================================================
-- Use this if you need to undo the v2 schema before deploying anything
-- that depends on it. Safe to run any time.
--
-- Order is important: drop children before parents to satisfy FKs.
-- =====================================================================

-- Sync infrastructure first (no dependents)
DROP TABLE IF EXISTS public.legacy_id_map         CASCADE;
DROP TABLE IF EXISTS public.system_sync_state     CASCADE;

-- Optional/global tables
DROP TABLE IF EXISTS public.bug_reports           CASCADE;
DROP TABLE IF EXISTS public.recipe_ingredients    CASCADE;
DROP TABLE IF EXISTS public.recipes               CASCADE;

-- COGS-related
DROP TABLE IF EXISTS public.modifier_sale_rows    CASCADE;
DROP TABLE IF EXISTS public.modifier_imports      CASCADE;
DROP TABLE IF EXISTS public.till_sale_rows        CASCADE;
DROP TABLE IF EXISTS public.till_imports          CASCADE;

-- Wastage, topups
DROP TABLE IF EXISTS public.wastage_lines         CASCADE;
DROP TABLE IF EXISTS public.wastage_batches       CASCADE;
DROP TABLE IF EXISTS public.topup_lines           CASCADE;
DROP TABLE IF EXISTS public.topup_sessions        CASCADE;

-- Deliveries
DROP TABLE IF EXISTS public.delivery_lines        CASCADE;
DROP TABLE IF EXISTS public.deliveries            CASCADE;

-- Transfers
DROP TABLE IF EXISTS public.transfer_lines        CASCADE;
DROP TABLE IF EXISTS public.transfers             CASCADE;

-- Stock counts
DROP TABLE IF EXISTS public.stock_count_lines     CASCADE;
DROP TABLE IF EXISTS public.stock_counts          CASCADE;

-- Closing / distribution / bar_products / event_products
DROP TABLE IF EXISTS public.closing_stock         CASCADE;
DROP TABLE IF EXISTS public.distribution          CASCADE;
DROP TABLE IF EXISTS public.bar_products          CASCADE;
DROP TABLE IF EXISTS public.event_products        CASCADE;

-- Warehouse stock
DROP TABLE IF EXISTS public.warehouse_stock       CASCADE;

-- Recipients / bars
DROP TABLE IF EXISTS public.recipients            CASCADE;
DROP TABLE IF EXISTS public.bars                  CASCADE;

-- Reference + events (last)
DROP TABLE IF EXISTS public.events                CASCADE;
DROP TABLE IF EXISTS public.products              CASCADE;
DROP TABLE IF EXISTS public.warehouses            CASCADE;
DROP TABLE IF EXISTS public.suppliers             CASCADE;
DROP TABLE IF EXISTS public.categories            CASCADE;

-- Verify everything is gone except stock_events:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' ORDER BY table_name;
