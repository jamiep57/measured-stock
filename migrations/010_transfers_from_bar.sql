-- 010_transfers_from_bar.sql
-- Additive: lets a transfer record which bar (within an event) the stock left from.
-- NULL = the event's Bone Yard (goods-in pool), matching prior behaviour.
-- transfer_type stays 'event_to_recipient' / 'event_to_event' etc.; from_bar_id
-- simply narrows the source location to a specific serving bar.
-- Safe for the live V4 app: the relational transfers table is a projection only.

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS from_bar_id uuid REFERENCES public.bars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transfers_from_bar ON public.transfers(from_bar_id);
