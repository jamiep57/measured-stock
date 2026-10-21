-- =====================================================================
-- 096 — Remove loose stock payments
-- =====================================================================
-- Loose stock stays a charge for opened singles above the agreed
-- allowance. Recording money received against that charge is unused,
-- and the table is empty. Allowances are unchanged.
--
-- Apply: AFTER 095. Idempotent: yes.
-- =====================================================================

DROP TABLE IF EXISTS public.loose_stock_payments;
