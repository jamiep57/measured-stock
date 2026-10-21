-- Loose stock payments are gone. Allowances stay.
\set ON_ERROR_STOP 1
BEGIN;

-- Re-applying the drop is safe.
\ir ../../migrations/096_drop_loose_stock_payments.sql

DO $$
BEGIN
  ASSERT to_regclass('public.loose_stock_payments') IS NULL, 'payments table is gone';
  ASSERT to_regclass('public.loose_stock_allowances') IS NOT NULL, 'allowances stay';
END $$;

ROLLBACK;
