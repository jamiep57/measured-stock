-- =====================================================================
-- 057 — Kit phone barcode scanner sessions
-- Short-lived pairing sessions so a phone camera can push barcodes to
-- the desktop Kit pack list (pack / check-in modes).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.kit_scan_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  mode       text NOT NULL DEFAULT 'pack'
               CHECK (mode IN ('pack', 'check_in')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kit_scan_sessions_event
  ON public.kit_scan_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_kit_scan_sessions_expires
  ON public.kit_scan_sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.kit_scan_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.kit_scan_sessions(id) ON DELETE CASCADE,
  barcode      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  consumed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kit_scan_events_session
  ON public.kit_scan_events(session_id);
CREATE INDEX IF NOT EXISTS idx_kit_scan_events_pending
  ON public.kit_scan_events(session_id)
  WHERE consumed_at IS NULL;

-- ---------- RLS (open anon policies, match 051) -----------------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['kit_scan_sessions', 'kit_scan_events'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_select ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_select ON public.%I FOR SELECT USING (true);',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_insert ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_insert ON public.%I FOR INSERT WITH CHECK (true);',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_update ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_update ON public.%I FOR UPDATE USING (true) WITH CHECK (true);',
      t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_anon_delete ON public.%I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_anon_delete ON public.%I FOR DELETE USING (true);',
      t, t
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.kit_scan_sessions IS
  'Short-lived Kit pack-list scan sessions for phone-as-scanner pairing.';
COMMENT ON TABLE public.kit_scan_events IS
  'Barcode payloads from a paired phone; desktop consumes and applies.';
COMMENT ON COLUMN public.kit_scan_sessions.mode IS
  'pack = bump qty_packed / add lines; check_in = accumulate return batch.';
