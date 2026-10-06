-- 085: Square catalogue push. Remembers which Square object each app item became,
-- so later pushes update the same item instead of creating duplicates.

BEGIN;

ALTER TABLE public.org_square_connections
  ADD COLUMN IF NOT EXISTS last_catalog_push_at timestamptz;

GRANT SELECT (last_catalog_push_at) ON public.org_square_connections TO authenticated;

CREATE TABLE IF NOT EXISTS public.square_catalog_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organisations(id),
  environment     text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  kind            text NOT NULL CHECK (kind IN ('item', 'variation', 'category')),
  app_key         text NOT NULL CHECK (char_length(app_key) BETWEEN 1 AND 300),
  square_id       text NOT NULL CHECK (char_length(square_id) BETWEEN 1 AND 64),
  square_item_id  text CHECK (square_item_id IS NULL OR char_length(square_item_id) <= 64),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS square_catalog_map_key
  ON public.square_catalog_map (org_id, environment, kind, app_key);

DROP TRIGGER IF EXISTS planning_touch_updated_at ON public.square_catalog_map;
CREATE TRIGGER planning_touch_updated_at BEFORE UPDATE ON public.square_catalog_map
  FOR EACH ROW EXECUTE FUNCTION public.planning_touch_updated_at();

SELECT public.tenant_enable('square_catalog_map', '', false);

-- Only the server writes the map.
REVOKE INSERT, UPDATE, DELETE ON public.square_catalog_map FROM authenticated;
DROP POLICY IF EXISTS square_catalog_map_insert ON public.square_catalog_map;
DROP POLICY IF EXISTS square_catalog_map_update ON public.square_catalog_map;
DROP POLICY IF EXISTS square_catalog_map_delete ON public.square_catalog_map;
DROP TRIGGER IF EXISTS zz_audit_row_change ON public.square_catalog_map;

GRANT ALL ON public.square_catalog_map TO service_role;

COMMIT;
