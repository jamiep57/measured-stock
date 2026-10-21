-- =====================================================================
-- 097 — Named sales imports for the orders forecast
-- =====================================================================
-- Each import is a mapped mix from another event's sales file.
-- The forecast is the equal-weight average of every import on the event.
--
-- Apply: AFTER 096
-- Idempotent: yes
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.forecast_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  total numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forecast_imports_event_idx
  ON public.forecast_imports (event_id, created_at);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.forecast_imports;
CREATE TRIGGER planning_touch_updated_at
  BEFORE UPDATE ON public.forecast_imports
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

SELECT public.tenant_enable('forecast_imports', '''derive:event_id:events''', true);

COMMENT ON TABLE public.forecast_imports IS
  'Named sales mixes mapped onto an event menu. The forecast is the average of every import on the event.';
