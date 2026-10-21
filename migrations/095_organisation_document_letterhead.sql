-- =====================================================================
-- 095 — Organisation letterhead for purchase orders and invoices
-- =====================================================================
-- The address, email and website printed under the logo. Existing
-- organisations keep the address that was previously hardcoded.
--
-- Apply: AFTER 094
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS document_address text NOT NULL DEFAULT E'124 City Road\nLondon, EC1V 2NX',
  ADD COLUMN IF NOT EXISTS document_email text NOT NULL DEFAULT 'live@measured.events',
  ADD COLUMN IF NOT EXISTS document_website text NOT NULL DEFAULT 'measured.events';

COMMENT ON COLUMN public.organisations.document_address IS
  'Postal address printed under the logo on purchase orders and invoices. One line per row.';

COMMENT ON COLUMN public.organisations.document_email IS
  'Email printed under the logo on purchase orders and invoices.';

COMMENT ON COLUMN public.organisations.document_website IS
  'Website printed under the logo on purchase orders and invoices.';
