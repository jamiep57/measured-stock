-- =====================================================================
-- 066 — Database audit trail
-- =====================================================================
-- Background:
--   The Audit panel only ran client-side integrity checks. This adds a
--   server-side, append-only audit_log written by triggers so every change
--   to catalogue, pricing, ordering and stock tables records who/what/when.
--   UPDATEs store only changed columns. Clients can read (org admins) but
--   never write; rows are inserted by the SECURITY DEFINER trigger.
--
--   log_audit_event() lets the app record non-row events (e.g. exports
--   that include internal costs).
--
-- Apply: AFTER 065
-- Idempotent: yes
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       uuid        REFERENCES public.organisations(id) ON DELETE CASCADE,
  table_name   text        NOT NULL,
  row_id       text,
  op           text        NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE', 'EVENT')),
  old_data     jsonb,
  new_data     jsonb,
  changed_cols text[],
  actor        uuid,
  actor_email  text,
  at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_at_idx ON public.audit_log (org_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_row_idx ON public.audit_log (table_name, row_id);

COMMENT ON TABLE public.audit_log IS
  'Append-only change history written by audit_row_change() triggers.';

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_key text;
  v_email text;
  v_row jsonb;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'UPDATE' THEN
    v_changed := ARRAY[]::text[];
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_new -> v_key IS DISTINCT FROM v_old -> v_key THEN
        v_changed := v_changed || v_key;
      END IF;
    END LOOP;
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT jsonb_object_agg(k, v_old -> k) INTO v_old FROM unnest(v_changed) k;
    SELECT jsonb_object_agg(k, v_new -> k) INTO v_new FROM unnest(v_changed) k;
  END IF;

  v_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.audit_log (org_id, table_name, row_id, op, old_data, new_data, changed_cols, actor, actor_email)
  VALUES (
    CASE WHEN TG_TABLE_NAME = 'organisations'
      THEN NULLIF(v_row ->> 'id', '')::uuid
      ELSE NULLIF(v_row ->> 'org_id', '')::uuid
    END,
    TG_TABLE_NAME,
    COALESCE(v_row ->> 'id', v_row ->> 'profile_id'),
    TG_OP,
    v_old,
    v_new,
    v_changed,
    auth.uid(),
    v_email
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(p_kind text, p_ref text, p_detail jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_org_id() IS NULL THEN
    RAISE EXCEPTION 'No active organisation' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR btrim(p_kind) = '' THEN
    RAISE EXCEPTION 'Event kind is required';
  END IF;
  INSERT INTO public.audit_log (org_id, table_name, row_id, op, new_data, actor, actor_email)
  SELECT public.current_org_id(), left(p_kind, 60), left(p_ref, 120), 'EVENT', p_detail, auth.uid(), p.email
  FROM public.profiles p WHERE p.id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, jsonb) TO authenticated, service_role;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'organisations','organisation_members',
    'categories','suppliers','warehouses','case_sizes',
    'products','product_suppliers','warehouse_stock',
    'events','bars','recipients','event_products','bar_products','distribution',
    'closing_stock','stock_counts','stock_count_lines',
    'deliveries','delivery_lines','supplier_return_lines',
    'topup_sessions','topup_lines','wastage_batches','wastage_lines',
    'transfers','transfer_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_audit_row_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zz_audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
      t
    );
  END LOOP;
END $$;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.current_org_id()) AND (SELECT public.is_admin()));

GRANT SELECT ON public.audit_log TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE ALL ON public.audit_log FROM anon;

-- =====================================================================
-- Verify:
--   SELECT table_name, op, changed_cols, actor_email, at
--     FROM public.audit_log ORDER BY at DESC LIMIT 20;
-- =====================================================================
