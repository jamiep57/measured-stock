-- =====================================================================
-- 082 — Global serve sizes
-- =====================================================================
-- The pour a customer buys (330ml, pint, half), shared by every event.
-- Pack size stays on the product. A menu row stores the label it uses;
-- this catalogue is the list those dropdowns choose from.
--
-- Apply: AFTER 081
-- Idempotent: yes
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.serve_sizes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organisations(id),
  label      text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS serve_sizes_org_label_key
  ON public.serve_sizes (org_id, lower(btrim(label)));

COMMENT ON TABLE public.serve_sizes IS
  'Serve sizes shared across the organisation: 330ml, pint, half and any sizes added later.';

SELECT public.tenant_enable('serve_sizes', '', false);

DROP POLICY IF EXISTS serve_sizes_delete ON public.serve_sizes;
CREATE POLICY serve_sizes_delete ON public.serve_sizes
  FOR DELETE TO authenticated
  USING (org_id = (SELECT public.current_org_id()) AND (SELECT public.is_admin()));

INSERT INTO public.serve_sizes (org_id, label, sort_order)
SELECT o.id, s.label, s.sort_order
FROM public.organisations o
CROSS JOIN (VALUES
  ('25ml', 10),
  ('50ml', 20),
  ('125ml', 30),
  ('175ml', 40),
  ('200ml', 50),
  ('250ml', 60),
  ('330ml', 70),
  ('440ml', 80),
  ('500ml', 90),
  ('Half', 100),
  ('Pint', 110),
  ('Single', 120),
  ('Double', 130)
) AS s(label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.serve_sizes existing
  WHERE existing.org_id = o.id
    AND lower(btrim(existing.label)) = lower(s.label)
);

-- Keep sizes already typed on menus, so they stay selectable.
INSERT INTO public.serve_sizes (org_id, label, sort_order)
SELECT src.org_id, src.label, 1000
FROM (
  SELECT org_id, btrim(serve_label) AS label
  FROM public.event_menu_items
  WHERE serve_label IS NOT NULL AND btrim(serve_label) <> ''
  UNION
  SELECT org_id, btrim(serve_label)
  FROM public.event_cocktails
  WHERE serve_label IS NOT NULL AND btrim(serve_label) <> ''
  UNION
  SELECT org_id, btrim(serve_label)
  FROM public.house_menu_prices
  WHERE serve_label IS NOT NULL AND btrim(serve_label) <> ''
  UNION
  SELECT org_id, btrim(serve_label)
  FROM public.saved_menu_items
  WHERE serve_label IS NOT NULL AND btrim(serve_label) <> ''
) src
WHERE char_length(src.label) BETWEEN 1 AND 40
  AND NOT EXISTS (
    SELECT 1 FROM public.serve_sizes existing
    WHERE existing.org_id = src.org_id
      AND lower(btrim(existing.label)) = lower(src.label)
  );
