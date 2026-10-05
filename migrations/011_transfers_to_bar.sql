-- 011_transfers_to_bar.sql
-- Additive: lets a transfer record which bar (within an event) the stock moved TO,
-- enabling bar-to-bar and Bone-Yard<->bar internal moves.
-- NULL = the event's Bone Yard (when to_event_id is set and recipient_id is null).
-- Pairs with 010_transfers_from_bar.sql. Safe for the live V4 app (projection only).

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS to_bar_id uuid REFERENCES public.bars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transfers_to_bar ON public.transfers(to_bar_id);
