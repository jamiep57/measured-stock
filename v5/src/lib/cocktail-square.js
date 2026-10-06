/**
 * Event cocktails as Square mappings.
 *
 * A cocktail names the till item it will be sold as. Later item sales on
 * this event follow that recipe. The shared recipes library is not written.
 * Modifier sales are unchanged.
 */

import { formatQtyAsFraction } from '../components/fraction-input.js';
import { resolveCocktailLine } from './menu-cocktails.js';
import { resolveMenuLine } from './planning-menu.js';
import { recipeStoredProductName } from './recipe-stock.js';
import { baseMenuItem, portionOf } from './menu-serves.js';
import { findRecipe, normVariation, recipeIsMapped } from './square-recipes.js';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function squareItemName(cocktail) {
  return String(cocktail?.square_item_name ?? '').trim();
}

/**
 * The Serves figure Menu & GP shows beside Cost. A blank menu row uses
 * the same case default the grid shows, so cocktail cost and the Square
 * stock fraction divide that one number and nothing else.
 */
export function knownServesPerUnit(product, menuItem, caseSizes = []) {
  if (!product && !menuItem) return null;
  const line = resolveMenuLine(menuItem || { product_id: product?.id, included: true }, {
    product: product || null,
    caseSizes,
  });
  const serves = num(line.servesPerUnit);
  return serves > 0 ? serves : null;
}

function portionText(measures, serves) {
  if (Number.isInteger(measures) && Number.isInteger(serves) && serves > 0) {
    const g = gcd(measures, serves);
    const n = measures / g;
    const d = serves / g;
    return d === 1 ? String(n) : `${n}/${d}`;
  }
  return formatQtyAsFraction(measures / serves, Math.max(72, Math.ceil(Number(serves) || 1)));
}

/**
 * Included cocktail whose Square item matches the till line.
 * A pinned variation wins over a cocktail that matches any variation.
 */
export function findCocktailForSale(cocktails, item, variation) {
  const want = String(item ?? '').trim().toLowerCase();
  if (!want) return null;
  const wantVar = normVariation(variation);
  const named = (cocktails || []).filter((c) => {
    if (c?.included === false) return false;
    return squareItemName(c).toLowerCase() === want;
  });
  const pinned = named.filter((c) => {
    const variationName = String(c.square_variation ?? '').trim();
    return variationName && normVariation(variationName) === wantVar;
  });
  if (pinned.length) return pinned[0];
  return named.find((c) => !String(c.square_variation ?? '').trim()) || null;
}

/**
 * Cocktails with a Square item that no imported till line has matched yet.
 */
export function cocktailsAwaitingSales(cocktails, tillRows) {
  return (cocktails || []).filter((cocktail) => {
    if (cocktail?.included === false) return false;
    if (!squareItemName(cocktail)) return false;
    return !(tillRows || []).some((row) => findCocktailForSale([cocktail], row.name, row.variation));
  });
}

export function saleCtxFrom({
  cocktails = [],
  menuItems = [],
  products = [],
  caseSizes = [],
  event = null,
} = {}) {
  const productById = new Map();
  const add = (product, id) => {
    if (!product) return;
    const key = id || product.id;
    if (key && !productById.has(key)) productById.set(key, product);
  };
  (products || []).forEach((p) => add(p, p?.id));
  (event?.event_products || []).forEach((ep) => add(ep.product, ep.product_id || ep.product?.id));
  const items = menuItems instanceof Map
    ? menuItems
    : new Map((menuItems || []).filter((row) => row?.product_id).map((row) => [row.product_id, row]));
  const menuRows = menuItems instanceof Map
    ? [...menuItems.values()].flat()
    : (menuItems || []).filter((row) => row?.product_id);
  return {
    cocktails: cocktails || [],
    productById,
    items,
    menuRows,
    caseSizes: caseSizes || [],
    event,
  };
}

/** Virtual recipe. source is 'cocktail' so Sales must not write the shared library. */
export function cocktailToRecipe(cocktail, ctx = {}) {
  const line = resolveCocktailLine(cocktail, cocktail?.ingredients || [], ctx);
  const ingredients = [];
  const incomplete = [];
  (line.ingredients || []).forEach((part) => {
    const product = ctx.productById?.get(part.productId) || null;
    const rawItem = ctx.items?.get(part.productId) || null;
    const menuItem = Array.isArray(rawItem) ? baseMenuItem(rawItem) : rawItem;
    const serves = knownServesPerUnit(product, menuItem, ctx.caseSizes);
    const measures = num(part.measures);
    if (!product || !(serves > 0) || !(measures > 0)) {
      incomplete.push({
        productId: part.productId || null,
        name: part.name && part.name !== 'Removed product' ? part.name : 'Product',
      });
      return;
    }
    ingredients.push({
      product_name: recipeStoredProductName(product, ctx.caseSizes || []),
      pool_name: null,
      qty: measures / serves,
      qty_text: portionText(measures, serves),
      position: ingredients.length,
    });
  });
  return {
    source: 'cocktail',
    cocktailId: cocktail?.id || null,
    cocktailName: String(cocktail?.name || '').trim(),
    till_item: squareItemName(cocktail),
    till_variation: String(cocktail?.square_variation || '').trim(),
    ingredients,
    incomplete,
  };
}

/**
 * Menu row sold under its Square name: item is the product's menu name and the
 * variation is the serve size, as the Square menu push creates them.
 */
export function menuRowRecipe(item, variation, ctx = {}) {
  const want = String(item ?? '').trim().toLowerCase();
  if (!want) return null;
  const wantVar = normVariation(variation);
  for (const row of ctx.menuRows || []) {
    if (row?.included === false) continue;
    const product = ctx.productById?.get(row.product_id);
    if (!product) continue;
    const name = String(product.menu_name || '').trim() || String(product.name || '').trim();
    if (name.toLowerCase() !== want) continue;
    if (normVariation(row.serve_label) !== wantVar) continue;
    const siblings = (ctx.menuRows || []).filter((r) => r?.product_id === row.product_id);
    const serves = knownServesPerUnit(product, baseMenuItem(siblings) || row, ctx.caseSizes);
    if (!(serves > 0)) return null;
    const portion = portionOf(row);
    return {
      source: 'menu',
      till_item: name,
      till_variation: String(row.serve_label || '').trim(),
      ingredients: [{
        product_name: recipeStoredProductName(product, ctx.caseSizes || []),
        pool_name: null,
        qty: portion / serves,
        qty_text: portionText(portion, serves),
        position: 0,
      }],
    };
  }
  return null;
}

/**
 * Cocktail on this event wins. Otherwise the shared recipe, then the event's
 * menu row with the same Square name and serve size.
 * Modifier lines should keep calling findRecipe directly.
 */
export function resolveSaleRecipe(item, variation, recipes, ctx = {}) {
  const cocktail = findCocktailForSale(ctx.cocktails, item, variation);
  if (!cocktail) {
    const shared = findRecipe(recipes, item, variation);
    return {
      recipe: recipeIsMapped(shared) ? shared : (menuRowRecipe(item, variation, ctx) || shared),
      fromCocktail: false,
      sharedIgnored: false,
      cocktail: null,
      incomplete: [],
    };
  }
  const recipe = cocktailToRecipe(cocktail, ctx);
  const shared = findRecipe(recipes, item, variation);
  return {
    recipe,
    fromCocktail: true,
    sharedIgnored: recipeIsMapped(shared),
    cocktail,
    incomplete: recipe.incomplete || [],
  };
}
