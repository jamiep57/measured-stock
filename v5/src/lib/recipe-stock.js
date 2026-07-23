/** Recipe ingredient → event stock unit helpers (ported from v2 Square logic). */

import { productStockPack } from '../pack-metrics.js';

export function normProductName(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normCaseSizeLabel(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\s+/g, '');
}

export function eventProductStockKey(ep) {
  const p = ep?.product;
  if (!p?.name) return '';
  return `${normProductName(p.name)}|${normCaseSizeLabel(p.case_size || '')}`;
}

export function productStockUnit(product, caseSizes = []) {
  return productStockPack(product, caseSizes).stockUnit || 'case';
}

function pickProductByRecipeQty(candidates, qty) {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const q = Number(qty) || 0;
  if (!(q > 0)) return candidates[0];
  let best = candidates[0];
  let bestDiff = Infinity;
  candidates.forEach((p) => {
    const pack = productStockPack(p, []);
    let expected = 1;
    const u = pack.stockUnit;
    if (u === 'keg' || u === 'unit' || u === 'single') {
      expected = pack.servingsPerUnit > 0 ? 1 / pack.servingsPerUnit : 1;
    } else if (u === 'bottle') {
      expected = pack.servingsPerUnit > 0 ? 1 / pack.servingsPerUnit : 1 / 24;
    } else {
      expected = pack.unitsPerCase > 0 ? 1 / pack.unitsPerCase : 1;
    }
    if (!(expected > 0)) return;
    const diff = Math.abs(Math.log(q / expected));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  });
  return best;
}

/** Resolve a recipe ingredient name to a library product. */
export function recipeProductByName(storedName, qtyHint, products = []) {
  const raw = String(storedName ?? '').trim();
  if (!raw) return null;
  const nLower = raw.toLowerCase();
  const dash = raw.indexOf(' \u2014 ');
  if (dash > 0) {
    const name = raw.slice(0, dash).trim().toLowerCase();
    const cs = raw.slice(dash + 3).trim().toLowerCase();
    const byPack = products.find((p) =>
      (p.name || '').trim().toLowerCase() === name
      && (p.case_size || '').trim().toLowerCase() === cs);
    if (byPack) return byPack;
  }
  const byName = products.filter((p) => (p.name || '').trim().toLowerCase() === nLower);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return pickProductByRecipeQty(byName, qtyHint);
  return byName[0] || null;
}

export function recipeIngredientDisplayName(storedName, products = []) {
  const p = recipeProductByName(storedName, null, products);
  if (!p) return storedName || '';
  const pack = p.case_size ? ` — ${p.case_size}` : '';
  return `${p.name}${pack}`;
}

function recipeIngredientStockKey(storedName, qtyHint, products = []) {
  const p = recipeProductByName(storedName, qtyHint, products);
  if (p?.name) return `${normProductName(p.name)}|${normCaseSizeLabel(p.case_size || '')}`;
  return `${normProductName(storedName)}|`;
}

export function pluStockKeyForRecipeIngredient(storedName, qtyHint, eps, products = [], caseSizes = []) {
  const exactKey = recipeIngredientStockKey(storedName, qtyHint, products);
  const p = recipeProductByName(storedName, qtyHint, products);
  if (!p?.name || productStockUnit(p, caseSizes) !== 'keg') return exactKey;
  const eventKeys = new Set((eps || []).filter((ep) => ep.product).map((ep) => eventProductStockKey(ep)));
  if (eventKeys.has(exactKey)) return exactKey;
  const nameNorm = normProductName(p.name);
  const kegEps = (eps || []).filter((ep) =>
    ep.product
    && normProductName(ep.product.name) === nameNorm
    && productStockUnit(ep.product, caseSizes) === 'keg');
  if (kegEps.length === 1) return eventProductStockKey(kegEps[0]);
  return exactKey;
}

/** Recipe qty × sold → stock units (cases / kegs / etc.). */
export function recipeQtyToStockUnits(product, qty, sold, caseSizes = []) {
  const q = Number(qty) || 0;
  const n = Number(sold) || 0;
  if (!(product && q > 0 && n > 0)) return 0;
  const raw = n * q;
  if (q >= 1) {
    const pack = productStockPack(product, caseSizes);
    const ups = pack.unitsPerCase || 1;
    if (ups > 1) return raw / ups;
    const spu = pack.servingsPerUnit;
    const u = pack.stockUnit;
    if (spu > 1 && (u === 'keg' || u === 'unit' || u === 'single')) return raw / spu;
  }
  return raw;
}

export function findSimilarEventProducts(productName, eventProducts = [], products = []) {
  const base = normProductName(productName);
  const tokens = base.split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return [];
  const onEventIds = new Set((eventProducts || []).map((ep) => ep.product_id).filter(Boolean));
  const scored = (products || [])
    .filter((p) => p.id && onEventIds.has(p.id))
    .map((p) => {
      const pn = normProductName(p.name);
      let score = 0;
      if (pn === base) score = 100;
      else if (pn.startsWith(`${base} `) || base.startsWith(`${pn} `)) score = 80;
      else if (tokens.every((t) => pn.includes(t))) score = 60;
      else if (tokens.some((t) => t.length > 3 && pn.includes(t))) score = 30;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.p.name || '').localeCompare(b.p.name || ''));
  return scored.slice(0, 3).map((x) => x.p);
}
