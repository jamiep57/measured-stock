-- 013_warehouse_transfer_fk_set_null.sql
-- Allow warehouse deletion when transfers still reference it: keep transfer
-- history but clear from/to warehouse links (same pattern as recipients).

ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS transfers_from_warehouse_id_fkey,
  DROP CONSTRAINT IF EXISTS transfers_to_warehouse_id_fkey;

ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_from_warehouse_id_fkey
    FOREIGN KEY (from_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD CONSTRAINT transfers_to_warehouse_id_fkey
    FOREIGN KEY (to_warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;
