/** Shared helpers for Square till item / modifier → recipe mapping. */

import { displayFractionQty } from '../components/fraction-input.js';
import { recipeProductByName } from './recipe-stock.js';
import { normPoolName } from './volume-pools.js';

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

/** All mappable ingredients (product XOR pool), sorted by position. */
export function recipeIngredients(recipe) {
  return (recipe?.ingredients || [])
    .slice()
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .filter((ig) => {
      const product = String(ig.product_name || '').trim();
      const pool = String(ig.pool_name || '').trim();
      return (product && !pool) || (pool && !product);
    });
}

/** Product-only ingredients (excludes pools). */
export function recipeProductIngredients(recipe) {
  return recipeIngredients(recipe).filter((ig) => ig.product_name && !ig.pool_name);
}

export function recipeIsMapped(recipe) {
  return recipeIngredients(recipe).length > 0;
}

/** First ingredient product name on a simple single-SKU recipe. */
export function recipeProductName(recipe) {
  return recipeProductIngredients(recipe)[0]?.product_name || '';
}

function eventLibraryProducts(eventProducts) {
  return (eventProducts || []).map((row) => row.product).filter((p) => p?.name);
}

/**
 * Resolve a stored recipe product label to an event product id.
 * Handles bare names and pack-qualified `Name — Pack` labels; when several
 * SKUs share a name, qty + caseSizes pick the matching pack.
 */
export function productIdForName(name, eventProducts, { qty, caseSizes } = {}) {
  if (!name) return '';
  const products = eventLibraryProducts(eventProducts);
  const resolved = recipeProductByName(name, qty, products, caseSizes || []);
  if (resolved?.id) {
    const ep = (eventProducts || []).find((row) =>
      row.product_id === resolved.id || row.product?.id === resolved.id);
    return ep?.product_id || resolved.id;
  }
  const ep = (eventProducts || []).find((row) => row.product?.name === name);
  return ep?.product_id || '';
}

export function mappedProductId(recipe, eventProducts, caseSizes = []) {
  const ig = recipeProductIngredients(recipe)[0];
  if (!ig?.product_name) return '';
  return productIdForName(ig.product_name, eventProducts, { qty: ig.qty, caseSizes });
}

function poolOnEvent(poolName, eventProducts) {
  const key = normPoolName(poolName);
  if (!key) return false;
  return (eventProducts || []).some((row) =>
    row.product?.pool_name && normPoolName(row.product.pool_name) === key);
}

function ingredientProductOnEvent(ig, eventProducts, caseSizes = []) {
  const products = eventLibraryProducts(eventProducts);
  const resolved = recipeProductByName(ig.product_name, ig.qty, products, caseSizes);
  if (resolved?.id) {
    return (eventProducts || []).some((row) =>
      row.product_id === resolved.id || row.product?.id === resolved.id);
  }
  return (eventProducts || []).some((row) => row.product?.name === ig.product_name);
}

/** True when every ingredient product (or at least one pool member) is on the event. */
export function recipeOnEvent(recipe, eventProducts, caseSizes = []) {
  const ings = recipeIngredients(recipe);
  if (!ings.length) return false;
  return ings.every((ig) => {
    if (ig.pool_name) return poolOnEvent(ig.pool_name, eventProducts);
    return ingredientProductOnEvent(ig, eventProducts, caseSizes);
  });
}

/** Display qty in recipe inputs — fraction when possible. */
export function qtyDisplay(qty, qtyText) {
  return displayFractionQty({ qty, qty_text: qtyText });
}
