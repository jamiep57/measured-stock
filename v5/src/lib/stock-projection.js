/**
 * Stock run-out projection — scales imported Square sales to target revenue.
 */

import { findRecipe } from './square-recipes.js';
import { epOpeningStock, round1 } from './opening-stock.js';
import {
  eventProductStockKey,
  recipeProductByName,
  recipeIngredientDisplayName,
  recipeQtyToStockUnits,
  pluStockKeyForRecipeIngredient,
  findSimilarEventProducts,
} from './recipe-stock.js';

export function computeStockProjection({
  event,
  tillRows = [],
  recipes = [],
  products = [],
  caseSizes = [],
}) {
  const rows = tillRows || [];
  const baselineNet = rows.reduce((a, r) => a + (Number(r.net_sales) || 0), 0);
  const target = Number(event?.target_revenue) || 0;
  const eps = event?.event_products || [];

  const byName = {};
  let mappedNet = 0;

  rows.forEach((r) => {
    const recipe = findRecipe(recipes, r.name, r.variation);
    if (!recipe) return;
    mappedNet += Number(r.net_sales) || 0;
    const sold = Number(r.items_sold) || 0;
    const seenProd = new Set();
    (recipe.ingredients || []).forEach((ig) => {
      if (ig.pool_name) return;
      const qty = Number(ig.qty) || 0;
      if (!(qty > 0)) return;
      const p = recipeProductByName(ig.product_name, qty, products);
      const key = pluStockKeyForRecipeIngredient(ig.product_name, qty, eps, products, caseSizes);
      if (!key) return;
      if (!byName[key]) {
        byName[key] = {
          name: recipeIngredientDisplayName(ig.product_name, products),
          baselineCases: 0,
          baselineServingsSold: 0,
        };
      }
      byName[key].baselineCases += recipeQtyToStockUnits(p, qty, sold, caseSizes);
      if (!seenProd.has(key)) {
        byName[key].baselineServingsSold += sold;
        seenProd.add(key);
      }
    });
  });

  const stockByName = {};
  eps.forEach((ep) => {
    if (!ep.product?.name) return;
    const key = eventProductStockKey(ep);
    if (!stockByName[key]) stockByName[key] = { available: 0, pid: ep.product_id };
    stockByName[key].available += epOpeningStock(ep);
  });

  const factor = baselineNet > 0 && target > 0 ? target / baselineNet : null;

  const items = Object.keys(byName).map((key) => {
    const b = byName[key];
    const st = stockByName[key] || null;
    const available = st ? st.available : null;
    const projectedCases = factor != null ? b.baselineCases * factor : null;
    const runOutRevenue = b.baselineCases > 0 && available != null
      ? (available / b.baselineCases) * baselineNet
      : null;
    const libProduct = recipeProductByName(b.name, null, products)
      || products.find((p) => eventProductStockKey({ product: p }) === key)
      || null;
    let stockStatus = st ? 'ok' : (libProduct ? 'not_on_event' : 'unknown');
    let stockHint = null;
    if (!st && libProduct) {
      const suggestions = findSimilarEventProducts(libProduct.name, eps, products);
      stockHint = suggestions.length
        ? `On this event as ${suggestions.map((p) => `${p.name}${p.case_size ? ` — ${p.case_size}` : ''}`).join(', ')}`
        : 'Add this product to the event, or update the recipe to use a stocked SKU.';
    } else if (!st && !libProduct) {
      stockHint = 'Not in the product library — check spelling or pick from the library.';
    }
    return {
      name: b.name,
      unit: 'cases',
      pid: st?.pid || null,
      inEvent: !!st,
      stockStatus,
      stockHint,
      baselineCases: b.baselineCases,
      projectedCases,
      servingsSold: factor != null ? b.baselineServingsSold * factor : null,
      available,
      runOutRevenue,
    };
  });

  return {
    rows,
    baselineNet,
    mappedNet,
    target,
    factor,
    items,
  };
}

export function defaultProjectionSort(a, b) {
  if (a.inEvent !== b.inEvent) return a.inEvent ? -1 : 1;
  const ar = a.runOutRevenue == null ? Infinity : a.runOutRevenue;
  const br = b.runOutRevenue == null ? Infinity : b.runOutRevenue;
  if (ar !== br) return ar - br;
  return (a.name || '').localeCompare(b.name || '');
}

export function projectionSortValue(item, key, target) {
  switch (key) {
    case 'name': return item.name || '';
    case 'servingsSold': return item.servingsSold;
    case 'projectedCases': return item.projectedCases;
    case 'available': return item.available;
    case 'runOutRevenue': return item.runOutRevenue;
    case 'pct':
      return item.runOutRevenue != null && target > 0
        ? (item.runOutRevenue / target) * 100
        : null;
    default: return null;
  }
}

export function sortProjectionItems(items, sortKey, sortDir, target) {
  const sorted = (items || []).slice();
  if (!sortKey) {
    sorted.sort(defaultProjectionSort);
    return sorted;
  }
  sorted.sort((a, b) => {
    const av = projectionSortValue(a, sortKey, target);
    const bv = projectionSortValue(b, sortKey, target);
    const an = av == null;
    const bn = bv == null;
    if (an && bn) return (a.name || '').localeCompare(b.name || '');
    if (an) return 1;
    if (bn) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av !== bv) return (av - bv) * sortDir;
    } else {
      const c = String(av).localeCompare(String(bv));
      if (c) return c * sortDir;
    }
    return (a.name || '').localeCompare(b.name || '');
  });
  return sorted;
}

export function projectionStatus(item, target) {
  if (!item.inEvent) {
    const label = item.stockStatus === 'unknown' ? 'Unknown product' : 'Not on event';
    return { label, tone: 'warn', icon: item.stockStatus === 'unknown' ? '?' : '!' };
  }
  const pct = item.runOutRevenue != null && target > 0
    ? (item.runOutRevenue / target) * 100
    : null;
  if (!(item.available > 0)) return { label: 'No stock', tone: 'danger', icon: 'x', pct };
  if (pct != null && pct < 100) return { label: 'Runs out', tone: 'danger', icon: '!', pct };
  if (pct != null && pct < 110) return { label: 'Tight', tone: 'warn', icon: '~', pct };
  return { label: 'Lasts', tone: 'ok', icon: 'ok', pct };
}

export function formatQtyCell(value, unitSuffix = '') {
  if (value == null) return '—';
  return `${round1(value)}${unitSuffix}`;
}
