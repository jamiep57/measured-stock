/** Shared helpers for Square till item / modifier → recipe mapping. */

import { displayFractionQty } from '../components/fraction-input.js';

export function normVariation(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s || 'regular';
}

export function recipeKey(item, variation) {
  return `${String(item ?? '').trim().toLowerCase()}|${normVariation(variation)}`;
}

export function findRecipe(recipes, item, variation) {
  const k = recipeKey(item, variation);
  return (recipes || []).find((r) => recipeKey(r.till_item, r.till_variation) === k) || null;
}

/** Product ingredients on a recipe, sorted by position (excludes pools). */
export function recipeProductIngredients(recipe) {
  return (recipe?.ingredients || [])
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .filter((ig) => ig.product_name && !ig.pool_name);
}

export function recipeIsMapped(recipe) {
  return recipeProductIngredients(recipe).length > 0;
}

/** First ingredient product name on a simple single-SKU recipe. */
export function recipeProductName(recipe) {
  return recipeProductIngredients(recipe)[0]?.product_name || '';
}

export function productIdForName(name, eventProducts) {
  if (!name) return '';
  const ep = (eventProducts || []).find((row) => row.product?.name === name);
  return ep?.product_id || '';
}

export function mappedProductId(recipe, eventProducts) {
  return productIdForName(recipeProductName(recipe), eventProducts);
}

export function recipeOnEvent(recipe, eventProducts) {
  const ings = recipeProductIngredients(recipe);
  if (!ings.length) return false;
  return ings.every((ig) =>
    (eventProducts || []).some((row) => row.product?.name === ig.product_name));
}

/** Display qty in recipe inputs — fraction when possible. */
export function qtyDisplay(qty, qtyText) {
  return displayFractionQty({ qty, qty_text: qtyText });
}
