/**
 * Cocktails on Menu & GP.
 *
 * A cocktail is sold as one drink. Its cost is the stock products in the
 * recipe added together: one measure is one serve of that product, using
 * the same cost and serves-per-unit as that product’s own menu line.
 */

import { gpPct, gpPerServe, gpStatus, netFromGross, requiredPrice } from './gp.js';
import { eventTargetGp, eventVatRate, resolveMenuLine } from './planning-menu.js';

export const COCKTAIL_CATEGORY = 'Cocktails';
export const MAX_COCKTAIL_INGREDIENTS = 8;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cocktailLineKey(id) {
  return `cocktail:${id}`;
}

/**
 * How many serves of each product the event’s cocktails will pour.
 * Excluded cocktails and cocktails with no projected serves are skipped.
 * A manual planned-quantity override is handled by the caller.
 * @returns {Map<string, number>}
 */
export function cocktailServesByProduct(cocktails) {
  const map = new Map();
  (cocktails || []).forEach((cocktail) => {
    if (cocktail?.included === false) return;
    const projected = num(cocktail.projected_serves);
    if (!(projected > 0)) return;
    (cocktail.ingredients || []).forEach((ing) => {
      const measures = num(ing.measures);
      if (!ing.product_id || !(measures > 0)) return;
      map.set(ing.product_id, (map.get(ing.product_id) || 0) + projected * measures);
    });
  });
  return map;
}

/**
 * Serves to buy for one product once cocktail pours are included.
 * An explicit planned-quantity override is left untouched.
 * @returns {{ mode: 'override'|'projection'|'none', serves: number|null }}
 */
export function projectedServesWithCocktails(item, extraServes) {
  if (num(item?.planned_qty_override) != null) return { mode: 'override', serves: null };
  const onMenu = item && item.included !== false;
  const own = onMenu ? (num(item.projected_serves) || 0) : 0;
  const extra = Math.max(0, num(extraServes) || 0);
  const serves = own + extra;
  if (!(serves > 0)) return { mode: 'none', serves: null };
  return { mode: 'projection', serves };
}

function ingredientPart(ing, ctx) {
  const product = ctx.productById?.get(ing.product_id) || null;
  const menuItem = ctx.items?.get(ing.product_id) || null;
  const measures = num(ing.measures);
  if (!product) {
    return {
      productId: ing.product_id,
      name: 'Removed product',
      pack: '',
      stockUnit: null,
      measures,
      servesPerUnit: null,
      unitCost: null,
      costPerMeasure: null,
      cost: null,
      costSource: null,
    };
  }
  const line = resolveMenuLine(
    menuItem || { product_id: product.id, included: true },
    { product, caseSizes: ctx.caseSizes || [], event: ctx.event },
  );
  const cost = line.costPerServe != null && measures != null && measures > 0
    ? line.costPerServe * measures
    : null;
  return {
    productId: product.id,
    name: line.name || product.name || '',
    pack: line.caseSize || '',
    stockUnit: line.stockUnit || null,
    measures,
    servesPerUnit: line.servesPerUnit,
    unitCost: line.unitCost,
    costPerMeasure: line.costPerServe,
    cost,
    costSource: line.costSource,
  };
}

/**
 * One cocktail as a menu line. Shape matches resolveMenuLine so totals,
 * exports and the grid can treat it as a sold item.
 */
export function resolveCocktailLine(cocktail, ingredients, ctx = {}) {
  const parts = (ingredients || []).map((ing) => ingredientPart(ing, ctx));
  const priced = parts.length > 0 && parts.every((p) => p.cost != null);
  const costPerServe = priced ? parts.reduce((sum, p) => sum + p.cost, 0) : null;
  const event = ctx.event;
  const vatRate = eventVatRate(ctx.year);
  const targetGpPct = num(cocktail?.target_gp_pct) ?? eventTargetGp(event, ctx.year);
  const menuPrice = num(cocktail?.menu_price);
  const required = requiredPrice(costPerServe, targetGpPct, vatRate);
  const suggested = num(cocktail?.suggested_price) ?? required;
  const gp = gpPct(menuPrice, costPerServe, vatRate);
  const serves = num(cocktail?.projected_serves);
  const amberBand = num(event?.gp_amber_band) ?? 5;
  const revenueGross = menuPrice != null && serves != null ? menuPrice * serves : null;
  const perServe = gpPerServe(menuPrice, costPerServe, vatRate);

  return {
    kind: 'cocktail',
    cocktailId: cocktail?.id || null,
    productId: null,
    name: String(cocktail?.name || '').trim(),
    menuName: String(cocktail?.name || '').trim(),
    caseSize: '',
    stockUnit: null,
    abv: null,
    category: COCKTAIL_CATEGORY,
    included: cocktail?.included !== false,
    serveLabel: cocktail?.serve_label || null,
    ingredientSummary: parts.map((p) => p.name).filter((n) => n && n !== 'Removed product').join(' · '),
    ingredients: parts,
    vatRate,
    servesPerUnit: null,
    unitCost: null,
    costSource: priced ? 'recipe' : null,
    costPerServe,
    targetGpPct,
    menuPrice,
    housePrice: null,
    requiredPrice: required,
    suggestedPrice: suggested,
    gpPct: gp,
    status: gpStatus(gp, targetGpPct, amberBand),
    amberBand,
    projectedServes: serves,
    revenueGross,
    revenueNet: revenueGross != null ? netFromGross(revenueGross, vatRate) : null,
    gpAmount: perServe != null && serves != null ? perServe * serves : null,
  };
}
