/**
 * Revenue forecast for Orders.
 *
 * A target is takings at menu prices. Each menu line's mix is
 * projected serves × selling price ÷ target. Servings are that share
 * divided by the selling price. The price is the menu price, or the
 * price needed to hit the target GP when the menu price is blank.
 *
 * A sales file sets the mix. It is not stored as this event's till import.
 * When the event has no target, the matched takings are the starting target.
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

/** Stable key for one till item in a sales file. */
export function saleItemKey(row) {
  return [normName(row?.name), normName(row?.variation), normName(row?.sku)].join('|');
}

/**
 * True when one name is the other plus a pack size or extra words,
 * so "Camden Pale Ale" can suggest "Camden Pale Ale 24×330ml".
 */
function looseNamesMatch(a, b) {
  if (!a || !b || a === b) return false;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (shorter.length < 6 || !longer.startsWith(shorter)) return false;
  const next = longer.charAt(shorter.length);
  return next === ' ' || next === '-' || next === '/' || next === '(' || next === '×';
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
      const known = rows.filter((row) => row.mixPct != null);
      const pct = known.length ? known.reduce((sum, row) => sum + row.mixPct, 0) : null;
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

/**
 * A unique menu product or cocktail whose name extends the till name, or the reverse.
 * Exact matches are handled separately so this only fills gaps.
 */
function looseNameHit(row, lines) {
  const want = normName(row?.name);
  if (want.length < 6) return null;
  const included = (lines || []).filter((line) => line.included !== false);
  const hits = [];
  included.forEach((line) => {
    const names = [line.productName, line.menuName, line.name].map(normName).filter(Boolean);
    if (!names.some((name) => looseNamesMatch(name, want))) return;
    hits.push(line);
  });
  const ids = new Set(hits.map((line) => (line.kind === 'cocktail' ? `cocktail:${line.key}` : line.productId)));
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  const chosen = hits.filter((line) => (line.kind === 'cocktail' ? `cocktail:${line.key}` : line.productId) === id);
  if (chosen[0]?.kind === 'cocktail') return chosen[0];
  return pickSize(chosen, row?.variation);
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

function lineFromMappings(row, lines, mappings) {
  const chosen = mappings?.[saleItemKey(row)];
  if (!chosen) return null;
  return (lines || []).find((line) => line.key === chosen && line.included !== false) || null;
}

/**
 * One row per till item, with takings summed. Rows with no takings are left out.
 */
export function groupSalesItems(tillRows) {
  const byKey = new Map();
  (tillRows || []).forEach((row) => {
    const amount = salesAmount(row);
    if (!(amount > 0)) return;
    const key = saleItemKey(row);
    const prev = byKey.get(key) || {
      key,
      name: String(row?.name || '').trim() || 'Unknown',
      variation: String(row?.variation || '').trim(),
      sku: String(row?.sku || '').trim(),
      category: String(row?.category || '').trim(),
      amount: 0,
      itemsSold: 0,
    };
    prev.amount += amount;
    prev.itemsSold += Number(row?.items_sold) || 0;
    if (!prev.category && row?.category) prev.category = String(row.category).trim();
    byKey.set(key, prev);
  });
  const total = [...byKey.values()].reduce((sum, row) => sum + row.amount, 0);
  return [...byKey.values()]
    .map((row) => ({
      ...row,
      amount: roundMoney(row.amount),
      itemsSold: Math.round(row.itemsSold),
      pct: total > 0 ? (row.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || a.variation.localeCompare(b.variation));
}

const GENERIC_SALE_TOKENS = new Set([
  'lager', 'beer', 'ale', 'ipa', 'pale', 'cider', 'wine', 'gin', 'vodka', 'rum',
  'whisky', 'whiskey', 'cola', 'soda', 'water', 'juice', 'mixer', 'spirit',
  'cocktail', 'shot', 'sour', 'tonic', 'lemonade', 'stout', 'pilsner', 'pils',
]);

const SERVE_SALE_TOKENS = new Set([
  'pint', 'half', 'single', 'double', 'regular', 'can', 'cans', 'bottle', 'bottles',
  'nrb', 'ml', 'cl', 'shot', 'keg', 'case',
]);

function saleTokens(value) {
  return normName(value)
    .replace(/×/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !SERVE_SALE_TOKENS.has(word));
}

function lineGroupId(line) {
  return line.kind === 'cocktail' ? `cocktail:${line.key}` : (line.productId || line.key);
}

/**
 * Best menu product for a sales name that is not an exact or prefix match.
 * A generic word such as lager only wins when one product on the menu has it.
 * Two close scores stay blank.
 */
function guessSaleLine(item, lines) {
  const variation = normName(item?.variation) && normName(item?.variation) !== 'regular' ? item.variation : '';
  const want = [...new Set(saleTokens(`${item?.name || ''} ${variation}`))];
  if (!want.length) return null;
  const groups = new Map();
  (lines || []).filter((line) => line.included !== false).forEach((line) => {
    const id = lineGroupId(line);
    const group = groups.get(id) || { lines: [] };
    group.lines.push(line);
    if (!group.have) {
      group.have = new Set(saleTokens(`${line.productName || ''} ${line.menuName || ''} ${line.name || ''}`));
    }
    groups.set(id, group);
  });
  const ranked = [];
  groups.forEach((group) => {
    const overlap = want.filter((token) => group.have.has(token));
    if (!overlap.length) return;
    const distinctive = overlap.filter((token) => !GENERIC_SALE_TOKENS.has(token));
    ranked.push({
      lines: group.lines,
      score: (overlap.length / want.length) + (distinctive.length ? 0.2 : 0),
      distinctive: distinctive.length,
    });
  });
  ranked.sort((a, b) => b.score - a.score || b.distinctive - a.distinctive);
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1];
  if (!best.distinctive) {
    if (second || best.score < 0.3) return null;
  } else if (best.score < 0.45 || (second?.distinctive && best.score - second.score < 0.2)) {
    return null;
  }
  if (best.lines[0]?.kind === 'cocktail') return best.lines[0];
  return pickSize(best.lines, item?.variation);
}

/**
 * Starting map for the import wizard.
 * `auto` is an exact menu line. `suggest` is a unique longer or shorter name.
 * `guess` is a likely name and stays blank until Auto map.
 * Ambiguous names are left blank so the user picks the product.
 */
export function suggestSaleMappings(items, lines, options = {}) {
  return (items || []).map((item) => {
    const exact = matchSaleToLine(item, lines, options);
    if (exact) return { saleKey: item.key, lineKey: exact.key, confidence: 'auto' };
    if (saleIsAmbiguous(item, lines)) return { saleKey: item.key, lineKey: '', confidence: 'ambiguous' };
    const loose = looseNameHit(item, lines);
    if (loose) return { saleKey: item.key, lineKey: loose.key, confidence: 'suggest' };
    const guess = guessSaleLine(item, lines);
    if (guess) return { saleKey: item.key, lineKey: guess.key, confidence: 'guess' };
    return { saleKey: item.key, lineKey: '', confidence: 'none' };
  });
}

/** Label for one row of the mapping wizard. */
export function saleMappingStatus(mapping, suggestion) {
  const lineKey = mapping || '';
  const suggested = suggestion?.lineKey || '';
  const confidence = suggestion?.confidence || 'none';
  if (lineKey) {
    if (lineKey === suggested && confidence === 'auto') return { kind: 'auto', label: 'Matched' };
    if (lineKey === suggested && confidence === 'suggest') return { kind: 'suggest', label: 'Similar name' };
    if (lineKey === suggested && confidence === 'guess') return { kind: 'guess', label: 'Suggested' };
    return { kind: 'mapped', label: 'Mapped' };
  }
  if (confidence === 'ambiguous') return { kind: 'need', label: 'Pick one' };
  if (confidence === 'auto' || confidence === 'suggest') return { kind: 'skip', label: 'Left out' };
  return { kind: 'need', label: 'Choose a product' };
}

/**
 * Historical mix from a till export. Shares are of the whole file,
 * so unmatched sales stay as a percentage the menu does not cover.
 * `options.mappings` is `{ [saleItemKey]: lineKey }` from the import wizard.
 * A blank line key leaves that item out.
 */
export function mixFromSales(tillRows, lines, options = {}) {
  const explicit = options.mappings != null;
  let total = 0;
  const byLine = new Map();
  const unmatched = new Map();
  (tillRows || []).forEach((row) => {
    const amount = salesAmount(row);
    if (!(amount > 0)) return;
    total += amount;
    const line = explicit
      ? lineFromMappings(row, lines, options.mappings)
      : matchSaleToLine(row, lines, options);
    if (!line) {
      const key = explicit ? saleItemKey(row) : `${normName(row.name)}|${normName(row.variation)}`;
      const prev = unmatched.get(key) || {
        name: String(row.name || '').trim() || 'Unknown',
        variation: String(row.variation || '').trim(),
        amount: 0,
        reason: explicit ? 'skipped' : (saleIsAmbiguous(row, lines) ? 'ambiguous' : 'unknown'),
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

/**
 * Starting target when the event has none: takings in the file that
 * matched the menu. Unmatched sales are left out.
 */
export function matchedTakingsTarget(mix) {
  const amount = num(mix?.matchedAmount);
  if (!(amount > 0)) return null;
  return roundMoney(amount);
}

/**
 * Shares of the matched takings, so each line's revenue equals its sales.
 * The file-level mix leaves a gap for unmatched rows.
 */
export function mixSharesOfMatched(mixLines, matchedAmount) {
  const total = num(matchedAmount);
  if (!(total > 0)) return [];
  return (mixLines || []).map((row) => ({
    ...row,
    pct: ((num(row.amount) || 0) / total) * 100,
  }));
}

/** One saved import: each line's share of that file's mapped takings. */
export function importLinesFromMix(mix) {
  const total = num(mix?.matchedAmount);
  return mixSharesOfMatched(mix?.lines || [], total).map((row) => ({
    key: row.key,
    name: row.name,
    serveLabel: row.serveLabel || null,
    category: row.category || 'Uncategorised',
    amount: roundMoney(num(row.amount) || 0),
    pct: row.pct,
  }));
}

/**
 * Equal-weight average of named imports.
 * A line missing from an import counts as 0, so the shares still sum to about 100.
 */
export function averageImportMixes(imports) {
  const list = (imports || []).filter((row) => (row?.lines || []).length);
  const count = list.length;
  if (!count) return [];
  const byKey = new Map();
  list.forEach((row) => {
    (row.lines || []).forEach((line) => {
      if (!line?.key) return;
      const cur = byKey.get(line.key) || {
        key: line.key,
        name: line.name || 'Line',
        serveLabel: line.serveLabel || null,
        category: line.category || 'Uncategorised',
        pctSum: 0,
        amountSum: 0,
      };
      cur.pctSum += num(line.pct) || 0;
      cur.amountSum += num(line.amount) || 0;
      if (line.name) cur.name = line.name;
      if (line.serveLabel) cur.serveLabel = line.serveLabel;
      if (line.category) cur.category = line.category;
      byKey.set(line.key, cur);
    });
  });
  return [...byKey.values()].map((row) => ({
    key: row.key,
    name: row.name,
    serveLabel: row.serveLabel,
    category: row.category,
    amount: roundMoney(row.amountSum / count),
    pct: row.pctSum / count,
  })).sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
}

/**
 * Mix the forecast should use. With no event target, the target is the
 * average of each import's mapped takings.
 */
export function forecastFromImports(imports, { fallbackTarget = null } = {}) {
  const list = (imports || []).filter((row) => (row?.lines || []).length);
  const lines = averageImportMixes(list);
  const totals = list.map((row) => num(row.total)).filter((n) => n > 0);
  const averagedTotal = totals.length
    ? roundMoney(totals.reduce((sum, n) => sum + n, 0) / totals.length)
    : null;
  const chosen = num(fallbackTarget);
  return {
    lines,
    target: chosen > 0 ? chosen : averagedTotal,
    importCount: list.length,
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
