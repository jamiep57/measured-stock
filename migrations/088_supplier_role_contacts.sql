-- =====================================================================
-- 088 — Supplier contacts by role
-- =====================================================================
-- A supplier needs three people: the account manager, whoever takes
-- orders, and whoever handles accounts. The original contact_name /
-- email / phone stay, and existing values are copied onto the account
-- manager so current records still show a contact.
--
-- Apply: AFTER 087
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS account_manager_name  text,
  ADD COLUMN IF NOT EXISTS account_manager_phone text,
  ADD COLUMN IF NOT EXISTS account_manager_email text,
  ADD COLUMN IF NOT EXISTS orders_name           text,
  ADD COLUMN IF NOT EXISTS orders_phone          text,
  ADD COLUMN IF NOT EXISTS orders_email          text,
  ADD COLUMN IF NOT EXISTS accounts_name         text,
  ADD COLUMN IF NOT EXISTS accounts_phone        text,
  ADD COLUMN IF NOT EXISTS accounts_email        text;

UPDATE public.suppliers
   SET account_manager_name = contact_name
 WHERE account_manager_name IS NULL
   AND NULLIF(btrim(contact_name), '') IS NOT NULL;

UPDATE public.suppliers
   SET account_manager_phone = phone
 WHERE account_manager_phone IS NULL
   AND NULLIF(btrim(phone), '') IS NOT NULL;

UPDATE public.suppliers
   SET account_manager_email = email
 WHERE account_manager_email IS NULL
   AND NULLIF(btrim(email), '') IS NOT NULL;
