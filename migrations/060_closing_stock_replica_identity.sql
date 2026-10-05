-- 060 — closing_stock needs FULL replica identity for Realtime filters on event_id.
ALTER TABLE public.closing_stock REPLICA IDENTITY FULL;
