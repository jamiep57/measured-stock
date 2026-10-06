/**
 * Revenue forecast for Orders.
 *
 * A target is takings at menu prices. Each menu line's mix is
 * projected serves × selling price ÷ target. Servings are that share
 * divided by the selling price. The price is the menu price, or the
 * price needed to hit the target GP when the menu price is blank.
 *
 * A sales file sets the mix. It is not stored as this event's till import.
 */

import { requiredPrice } from './gp.js';
import { findCocktailForSale } from './cocktail-square.js';
import { resolveCocktailLine } from './menu-cocktails.js';
import { portionOf } from './menu-serves.js';
import { menuNameOf } from './product-attributes.js';
import { resolveMenuLine } from './planning-menu.js';
import { recipeProductByName } from './recipe-stock.js';
import {
  findRecipe,
  recipeIsMapped,
  recipeProductIngredients,
} from './square-recipes.js';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normName(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function roundServes(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * @returns {{ price: number|null, source: 'menu'|'gp'|null }}
 */
export function sellingPrice(line) {
  const menu = num(line?.menuPrice);
  if (menu != null && menu > 0) return { price: menu, source: 'menu' };
  const required = requiredPrice(line?.costPerServe, line?.targetGpPct, line?.vatRate);
  if (required != null && required > 0) return { price: required, source: 'gp' };
  return { price: null, source: null };
}

/** Mix % of target. Null when serves, price or target is missing. */
export function mixPct(serves, price, target) {
  const s = num(serves);
  const p = num(price);
  const t = num(target);
  if (s == null || !(p > 0) || !(t > 0)) return null;
  return (s * p / t) * 100;
}

export function lineRevenue(serves, price) {
  const s = num(serves);
  const p = num(price);
  if (s == null || p == null) return null;
  return roundMoney(s * p);
}

/** Whole servings that produce `pct` percent of `target` at `price`. */
export function servesFromMix(target, pct, price) {
  const t = num(target);
  const share = num(pct);
  const p = num(price);
  if (!(t > 0) || share == null || !(p > 0)) return null;
  return roundServes((t * (share / 100)) / p);
}

/**
 * Rough cases from this line's serves. Sizes of one product are combined
 * and rounded up once when the order is planned; this is the line's share.
 */
export function roughCases(line) {
  if (line?.kind === 'cocktail') return null;
  const serves = num(line?.projectedServes);
  const per = num(line?.servesPerUnit);
  if (!(serves > 0) || !(per > 0)) return null;
  const portion = portionOf(line);
  return Math.round((serves * portion / per) * 10) / 10;
}

export function forecastLineView(line, target) {
  const { price, source } = sellingPrice(line);
  const serves = num(line?.projectedServes);
  return {
    ...line,
    price,
    priceSource: source,
    revenue: lineRevenue(serves, price),
    mixPct: mixPct(serves, price, target),
    cases: roughCases(line),
  };
}

export function groupForecastLines(lines, target) {
  const groups = new Map();
  (lines || []).forEach((line) => {
    const view = forecastLineView(line, target);
    const category = view.category || 'Uncategorised';
    const list = groups.get(category) || [];
    list.push(view);
    groups.set(category, list);
  });
  return [...groups.entries()]
    .map(([category, rows]) => {
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || '')
        || String(a.serveLabel || '').localeCompare(String(b.serveLabel || '')));
      const revenue = roundMoney(rows.reduce((sum, row) => sum + (row.revenue || 0), 0));
      const pct = rows.reduce((sum, row) => sum + (row.mixPct || 0), 0);
      const serves = rows.reduce((sum, row) => sum + (num(row.projectedServes) || 0), 0);
      return { category, revenue, pct, serves, lines: rows };
    })
    .sort((a, b) => a.category.localeCompare(b.category));
}

export function forecastTotals(lines, target) {
  const views = (lines || []).map((line) => forecastLineView(line, target));
  const revenue = roundMoney(views.reduce((sum, line) => sum + (line.revenue || 0), 0));
  const t = num(target);
  return {
    revenue,
    pct: t > 0 ? (revenue / t) * 100 : null,
    serves: views.reduce((sum, line) => sum + (num(line.projectedServes) || 0), 0),
  };
}

function withIdentity(line, serves) {
  return {
    key: line.key,
    kind: line.kind,
    itemId: line.itemId,
    productId: line.productId || null,
    serves,
  };
}

/**
 * Scale priced lines so the category is `newPct` of target.
 * Relative mix is kept. With no current revenue, the new takings are
 * split evenly across lines that have a price.
 */
export function scaleCategoryServes(lines, newPct, target) {
  const t = num(target);
  const pct = num(newPct);
  if (!(t > 0) || pct == null) return [];
  const priced = (lines || []).map((line) => {
    const price = sellingPrice(line).price;
    return price > 0 ? { line, price } : null;
  }).filter(Boolean);
  if (!priced.length) return [];
  const newRevenue = t * (pct / 100);
  const current = priced.reduce((sum, row) => sum + (num(row.line.projectedServes) || 0) * row.price, 0);
  if (!(current > 0)) {
    const each = newRevenue / priced.length;
    return priced.map((row) => withIdentity(row.line, roundServes(each / row.price)));
  }
  const factor = newRevenue / current;
  return priced.map((row) => withIdentity(
    row.line,
    roundServes((num(row.line.projectedServes) || 0) * factor),
  ));
}

/** Multiply serves so the current split hits `newTarget`. */
export function keepMixServes(lines, oldTarget, newTarget) {
  const oldT = num(oldTarget);
  const newT = num(newTarget);
  if (!(oldT > 0) || !(newT > 0)) return [];
  const factor = newT / oldT;
  return (lines || [])
    .filter((line) => num(line.projectedServes) > 0)
    .map((line) => withIdentity(line, roundServes(line.projectedServes * factor)));
}

function pickSize(lines, variation) {
  if (!lines?.length) return null;
  const v = normName(variation);
  if (v && v !== 'regular') {
    const exact = lines.find((line) => normName(line.serveLabel) === v);
    if (exact) return exact;
  }
  return lines.find((line) => portionOf(line) === 1) || lines[0];
}

function menuLines(lines) {
  return (lines || []).filter((line) => line.kind !== 'cocktail' && line.included !== false);
}

function matchRecipe(row, lines, recipes, products, caseSizes) {
  const recipe = findRecipe(recipes, row?.name, row?.variation);
  if (!recipeIsMapped(recipe)) return null;
  const ingredients = recipeProductIngredients(recipe);
  if (ingredients.length !== 1) return null;
  const product = recipeProductByName(ingredients[0].product_name, ingredients[0].qty, products, caseSizes);
  if (!product?.id) return null;
  const sizes = menuLines(lines).filter((line) => line.productId === product.id);
  return pickSize(sizes, row?.variation);
}

function uniqueProduct(lines, predicate) {
  const ids = new Set();
  lines.forEach((line) => {
    if (predicate(line)) ids.add(line.productId);
  });
  if (ids.size !== 1) return null;
  const productId = [...ids][0];
  return lines.filter((line) => line.productId === productId);
}

function matchBySku(row, lines) {
  const sku = normName(row?.sku);
  if (!sku) return null;
  const sizes = uniqueProduct(menuLines(lines), (line) => normName(line.sku) === sku);
  return sizes ? pickSize(sizes, row?.variation) : null;
}

function matchByName(row, lines) {
  const want = normName(row?.name);
  if (!want) return null;
  const sizes = uniqueProduct(menuLines(lines), (line) => {
    const names = [line.productName, line.menuName, line.name].map(normName).filter(Boolean);
    return names.includes(want);
  });
  return sizes ? pickSize(sizes, row?.variation) : null;
}

/** More than one product on the menu uses this till item's name or SKU. */
function saleIsAmbiguous(row, lines) {
  const want = normName(row?.name);
  const sku = normName(row?.sku);
  const ids = new Set();
  menuLines(lines).forEach((line) => {
    const names = [line.productName, line.menuName, line.name].map(normName).filter(Boolean);
    if ((want && names.includes(want)) || (sku && normName(line.sku) === sku)) ids.add(line.productId);
  });
  return ids.size > 1;
}

/** Cocktail Square name, then a one-product recipe, then SKU, then name. */
export function matchSaleToLine(row, lines, { recipes = [], products = [], caseSizes = [] } = {}) {
  const included = (lines || []).filter((line) => line.included !== false);
  const cocktails = included.filter((line) => line.kind === 'cocktail').map((line) => ({
    id: line.key,
    included: true,
    square_item_name: line.squareItemName,
    square_variation: line.squareVariation,
  }));
  const cocktail = findCocktailForSale(cocktails, row?.name, row?.variation);
  if (cocktail) return included.find((line) => line.key === cocktail.id) || null;
  return matchRecipe(row, included, recipes, products, caseSizes)
    || matchBySku(row, included)
    || matchByName(row, included);
}

function salesAmount(row) {
  const gross = num(row?.gross_sales);
  if (gross > 0) return gross;
  const net = num(row?.net_sales);
  return net > 0 ? net : 0;
}

/**
 * Historical mix from a till export. Shares are of the whole file,
 * so unmatched sales stay as a percentage the menu does not cover.
 */
export function mixFromSales(tillRows, lines, options = {}) {
  let total = 0;
  const byLine = new Map();
  const unmatched = new Map();
  (tillRows || []).forEach((row) => {
    const amount = salesAmount(row);
    if (!(amount > 0)) return;
    total += amount;
    const line = matchSaleToLine(row, lines, options);
    if (!line) {
      const key = `${normName(row.name)}|${normName(row.variation)}`;
      const prev = unmatched.get(key) || {
        name: String(row.name || '').trim() || 'Unknown',
        variation: String(row.variation || '').trim(),
        amount: 0,
        reason: saleIsAmbiguous(row, lines) ? 'ambiguous' : 'unknown',
      };
      prev.amount += amount;
      unmatched.set(key, prev);
      return;
    }
    const prev = byLine.get(line.key) || {
      key: line.key,
      name: line.name,
      serveLabel: line.serveLabel || null,
      category: line.category || 'Uncategorised',
      amount: 0,
    };
    prev.amount += amount;
    byLine.set(line.key, prev);
  });
  const share = (amount) => (total > 0 ? (amount / total) * 100 : 0);
  const matched = [...byLine.values()].map((line) => ({
    ...line,
    amount: roundMoney(line.amount),
    pct: share(line.amount),
  }));
  const missed = [...unmatched.values()].map((line) => ({
    ...line,
    amount: roundMoney(line.amount),
    pct: share(line.amount),
  }));
  const matchedAmount = matched.reduce((sum, line) => sum + line.amount, 0);
  const categories = [...matched.reduce((map, line) => {
    const cur = map.get(line.category) || { category: line.category, amount: 0, pct: 0 };
    cur.amount += line.amount;
    cur.pct += line.pct;
    map.set(line.category, cur);
    return map;
  }, new Map()).values()]
    .map((row) => ({ ...row, amount: roundMoney(row.amount) }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  return {
    total: roundMoney(total),
    matchedAmount: roundMoney(matchedAmount),
    matchedPct: share(matchedAmount),
    unmatchedPct: share(total - matchedAmount),
    lines: matched.sort((a, b) => b.amount - a.amount || (a.name || '').localeCompare(b.name || '')),
    unmatched: missed.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    categories,
  };
}

/** Projected serves for matched lines that have a selling price. */
export function servesForMix(lines, mixLines, target) {
  const byKey = new Map((lines || []).map((line) => [line.key, line]));
  const applied = [];
  const skipped = [];
  (mixLines || []).forEach((mix) => {
    const line = byKey.get(mix.key);
    if (!line) return;
    const price = sellingPrice(line).price;
    if (!(price > 0)) {
      skipped.push({ key: line.key, name: line.name, reason: 'price' });
      return;
    }
    const serves = servesFromMix(target, mix.pct, price);
    if (serves == null) {
      skipped.push({ key: line.key, name: line.name, reason: 'target' });
      return;
    }
    applied.push(withIdentity(line, serves));
  });
  return { applied, skipped };
}

/**
 * Included menu sizes and cocktails, ready to forecast.
 * `items` is the product → sizes map from the orders page.
 */
export function buildForecastLines({
  items,
  cocktails = [],
  productById,
  caseSizes = [],
  event,
} = {}) {
  const map = items instanceof Map ? items : new Map();
  const lines = [];
  map.forEach((list, productId) => {
    const product = productById?.get(productId) || null;
    (list || []).forEach((item) => {
      if (!item || item.included === false) return;
      const resolved = resolveMenuLine(item, { product, caseSizes, event });
      lines.push({
        key: item.id,
        kind: 'menu',
        itemId: item.id,
        productId,
        name: resolved.name || product?.name || 'Product',
        menuName: menuNameOf(product),
        productName: product?.name || '',
        sku: product?.sku || '',
        serveLabel: item.serve_label || null,
        caseSize: resolved.caseSize || '',
        portion: portionOf(item),
        category: resolved.category || 'Uncategorised',
        included: true,
        menuPrice: resolved.menuPrice,
        costPerServe: resolved.costPerServe,
        targetGpPct: resolved.targetGpPct,
        vatRate: resolved.vatRate,
        projectedServes: resolved.projectedServes,
        servesPerUnit: resolved.servesPerUnit,
        caseCost: resolved.caseCost,
      });
    });
  });
  (cocktails || []).forEach((cocktail) => {
    if (!cocktail || cocktail.included === false) return;
    const resolved = resolveCocktailLine(cocktail, cocktail.ingredients || [], {
      productById,
      items: map,
      caseSizes,
      event,
    });
    lines.push({
      key: `cocktail:${cocktail.id}`,
      kind: 'cocktail',
      itemId: cocktail.id,
      productId: null,
      name: resolved.name || 'Drink',
      menuName: resolved.menuName || resolved.name || '',
      productName: '',
      sku: '',
      serveLabel: cocktail.serve_label || null,
      portion: 1,
      category: resolved.category || 'Cocktails',
      included: true,
      menuPrice: resolved.menuPrice,
      costPerServe: resolved.costPerServe,
      targetGpPct: resolved.targetGpPct,
      vatRate: resolved.vatRate,
      projectedServes: resolved.projectedServes,
      servesPerUnit: null,
      caseCost: null,
      squareItemName: cocktail.square_item_name || '',
      squareVariation: cocktail.square_variation || '',
    });
  });
  return lines;
}

/** Planned cases × case cost. Unpriced products are counted, not guessed. */
export function plannedOrderCost(rows, caseCostByProduct) {
  let total = 0;
  let unpriced = 0;
  (rows || []).forEach((row) => {
    const cases = num(row?.planned);
    if (!(cases > 0)) return;
    const cost = caseCostByProduct(row.productId);
    if (cost == null || !Number.isFinite(Number(cost))) {
      unpriced += 1;
      return;
    }
    total += cases * Number(cost);
  });
  return { total: roundMoney(total), unpriced };
}
