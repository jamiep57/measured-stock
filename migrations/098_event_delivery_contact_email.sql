-- =====================================================================
-- 098 — Email for the on-site delivery contact
-- =====================================================================
-- Purchase orders print the person on site as their own block: name,
-- phone and email. Name and phone already live on the event.
--
-- Apply: AFTER 097
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS delivery_contact_email text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_delivery_contact_email_len') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_delivery_contact_email_len
      CHECK (delivery_contact_email IS NULL OR char_length(delivery_contact_email) <= 160);
  END IF;
END $$;

COMMENT ON COLUMN public.events.delivery_contact_email IS
  'Email for the on-site delivery contact, shown on purchase orders.';
