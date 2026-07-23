-- 047 — Preserve fraction display text on recipe ingredients (V5 WYSIWYG qty)

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS qty_text text;

COMMENT ON COLUMN public.recipe_ingredients.qty_text IS
  'Author-entered qty string (e.g. 1/24, 3/24+1/48). Numeric qty is used for calculations.';
