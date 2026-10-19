-- =====================================================================
-- 089 — Supplier address as separate fields
-- =====================================================================
-- The supplier form used one free-text address. Split it into line 1,
-- line 2, town, city, county and postcode. `address` stays as the joined
-- lines so purchase orders and search keep reading one string.
--
-- Existing text is split once: newlines first, otherwise commas, with a
-- UK postcode taken off the end.
--
-- Apply: AFTER 088
-- Idempotent: yes
-- =====================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS town          text,
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS county        text,
  ADD COLUMN IF NOT EXISTS postcode      text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_address_line1_len') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_address_line1_len CHECK (address_line1 IS NULL OR char_length(address_line1) <= 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_address_line2_len') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_address_line2_len CHECK (address_line2 IS NULL OR char_length(address_line2) <= 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_town_len') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_town_len CHECK (town IS NULL OR char_length(town) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_city_len') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_city_len CHECK (city IS NULL OR char_length(city) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_county_len') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_county_len CHECK (county IS NULL OR char_length(county) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_postcode_len') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_postcode_len CHECK (postcode IS NULL OR char_length(postcode) <= 16);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._089_split_supplier_address(raw text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  text_in text := btrim(replace(coalesce(raw, ''), E'\r\n', E'\n'));
  chunks text[] := ARRAY[]::text[];
  last_part text;
  pc text[];
  rest text;
  n int;
  line1 text := '';
  line2 text := '';
  town text := '';
  city text := '';
  county text := '';
  postcode text := '';
BEGIN
  IF text_in = '' THEN
    RETURN jsonb_build_object(
      'line1', '', 'line2', '', 'town', '', 'city', '', 'county', '', 'postcode', ''
    );
  END IF;

  IF position(E'\n' IN text_in) > 0 THEN
    SELECT coalesce(array_agg(part ORDER BY ord), ARRAY[]::text[])
      INTO chunks
      FROM (
        SELECT btrim(x) AS part, ord
          FROM unnest(string_to_array(text_in, E'\n')) WITH ORDINALITY AS u(x, ord)
      ) s
     WHERE part <> '';
  ELSE
    SELECT coalesce(array_agg(part ORDER BY ord), ARRAY[]::text[])
      INTO chunks
      FROM (
        SELECT btrim(x) AS part, ord
          FROM unnest(string_to_array(text_in, ',')) WITH ORDINALITY AS u(x, ord)
      ) s
     WHERE part <> '';
  END IF;

  n := coalesce(array_length(chunks, 1), 0);
  IF n > 0 THEN
    last_part := chunks[n];
    pc := regexp_match(
      last_part,
      '([A-Za-z]{1,2}[0-9][0-9A-Za-z]?)[[:space:]]*([0-9][A-Za-z]{2})[[:space:]]*$'
    );
    IF pc IS NOT NULL THEN
      postcode := upper(pc[1]) || ' ' || upper(pc[2]);
      rest := btrim(regexp_replace(
        last_part,
        '([A-Za-z]{1,2}[0-9][0-9A-Za-z]?)[[:space:]]*([0-9][A-Za-z]{2})[[:space:]]*$',
        ''
      ));
      rest := regexp_replace(rest, '[,[:space:]]+$', '');
      IF rest <> '' THEN
        chunks[n] := rest;
      ELSIF n = 1 THEN
        chunks := ARRAY[]::text[];
      ELSE
        chunks := chunks[1:n - 1];
      END IF;
    END IF;
  END IF;

  n := coalesce(array_length(chunks, 1), 0);
  IF n >= 1 THEN line1 := chunks[1]; END IF;
  IF n = 2 THEN
    city := chunks[2];
  ELSIF n = 3 THEN
    line2 := chunks[2];
    city := chunks[3];
  ELSIF n = 4 THEN
    line2 := chunks[2];
    town := chunks[3];
    city := chunks[4];
  ELSIF n >= 5 THEN
    line2 := chunks[2];
    town := chunks[3];
    city := chunks[4];
    county := array_to_string(chunks[5:n], ', ');
  END IF;

  RETURN jsonb_build_object(
    'line1', line1,
    'line2', line2,
    'town', town,
    'city', city,
    'county', county,
    'postcode', postcode
  );
END;
$$;

UPDATE public.suppliers AS s
   SET address_line1 = NULLIF(parts->>'line1', ''),
       address_line2 = NULLIF(parts->>'line2', ''),
       town          = NULLIF(parts->>'town', ''),
       city          = NULLIF(parts->>'city', ''),
       county        = NULLIF(parts->>'county', ''),
       postcode      = NULLIF(parts->>'postcode', '')
  FROM (
    SELECT id, public._089_split_supplier_address(address) AS parts
      FROM public.suppliers
     WHERE NULLIF(btrim(address), '') IS NOT NULL
       AND address_line1 IS NULL
       AND address_line2 IS NULL
       AND town IS NULL
       AND city IS NULL
       AND county IS NULL
       AND postcode IS NULL
  ) split
 WHERE s.id = split.id;

UPDATE public.suppliers
   SET address = NULLIF(concat_ws(
         E'\n',
         NULLIF(btrim(address_line1), ''),
         NULLIF(btrim(address_line2), ''),
         NULLIF(btrim(town), ''),
         NULLIF(btrim(city), ''),
         NULLIF(btrim(county), ''),
         NULLIF(btrim(postcode), '')
       ), '')
 WHERE address_line1 IS NOT NULL
    OR address_line2 IS NOT NULL
    OR town IS NOT NULL
    OR city IS NOT NULL
    OR county IS NOT NULL
    OR postcode IS NOT NULL;

DROP FUNCTION IF EXISTS public._089_split_supplier_address(text);
