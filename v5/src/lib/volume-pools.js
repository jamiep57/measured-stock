/**
 * Volume pools — group interchangeable SKUs (e.g. Sprite + 7up, 70cl + 1L)
 * so till recipes can consume one shared pool.
 *
 * Authors enter a **fraction of one case/SKU per serving** (e.g. 1/24 for a
 * can from a 24-pack, 1/12 from a 12-pack, 1/28 of a bottle). That text is
 * stored on pool_servings_text; pool_servings_per_unit is derived for recon.
 */

import { productStockPack } from '../pack-metrics.js';
import { parseFractionQty, formatQtyAsFraction } from '../components/fraction-input.js';

export function normPoolName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function unitsPerCase(product, caseSizes = []) {
  return productStockPack(product, caseSizes).unitsPerCase || 1;
}

/**
 * Servings one stock unit contributes (recon field).
 * Prefer stored value; else case-size servings; else 1.
 */
export function defaultPoolServings(product, caseSizes = []) {
  const existing = Number(product?.pool_servings_per_unit);
  if (Number.isFinite(existing) && existing > 0) return existing;
  const pack = productStockPack(product, caseSizes);
  const fromPack = Number(pack.servingsPerUnit);
  if (Number.isFinite(fromPack) && fromPack > 0) return fromPack;
  return 1;
}

/** Servings one full case/SKU contributes. */
export function servingsPerCase(product, caseSizes = []) {
  const spu = Number(product?.pool_servings_per_unit);
  const servings = Number.isFinite(spu) && spu > 0 ? spu : defaultPoolServings(product, caseSizes);
  return servings * unitsPerCase(product, caseSizes);
}

/**
 * Display / default fraction of one case per serving (e.g. "1/24").
 * Prefers author text; otherwise derives from servings × units/case.
 */
export function poolFractionText(product, caseSizes = []) {
  const text = String(product?.pool_servings_text ?? '').trim();
  if (text) return text;
  const perCase = servingsPerCase(product, caseSizes);
  if (!(perCase > 0)) return '1';
  return formatQtyAsFraction(1 / perCase);
}

/**
 * Default fraction when adding a product to a pool (from pack metrics).
 */
export function defaultPoolFractionText(product, caseSizes = []) {
  const text = String(product?.pool_servings_text ?? '').trim();
  if (text) return text;
  const pack = productStockPack(product, caseSizes);
  const spu = Number(pack.servingsPerUnit);
  const servings = Number.isFinite(spu) && spu > 0 ? spu : 1;
  const perCase = servings * (pack.unitsPerCase || 1);
  if (!(perCase > 0)) return '1';
  return formatQtyAsFraction(1 / perCase);
}

/**
 * Parse author fraction → { pool_servings_text, pool_servings_per_unit }.
 * Fraction is of one case/SKU per serving (1/24 of a 24-pack = one can).
 */
export function poolServingsFromFraction(fractionText, product, caseSizes = []) {
  const raw = String(fractionText ?? '').trim();
  const fraction = parseFractionQty(raw);
  if (!(fraction > 0)) return null;
  const upc = unitsPerCase(product, caseSizes);
  const servingsPerCaseVal = 1 / fraction;
  const pool_servings_per_unit = servingsPerCaseVal / upc;
  if (!(pool_servings_per_unit > 0) || !Number.isFinite(pool_servings_per_unit)) return null;
  return {
    pool_servings_text: raw,
    pool_servings_per_unit,
  };
}

/**
 * Group library products into pools keyed by normalised name.
 * @returns {{ name: string, key: string, members: object[] }[]}
 */
export function groupProductsByPool(products = []) {
  const map = new Map();
  (products || []).forEach((p) => {
    const raw = (p.pool_name || '').trim();
    if (!raw) return;
    const key = normPoolName(raw);
    if (!map.has(key)) {
      map.set(key, { name: raw, key, members: [] });
    }
    map.get(key).members.push(p);
  });

  return [...map.values()]
    .map((pool) => ({
      ...pool,
      members: pool.members
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function poolSummary(pool, caseSizes = []) {
  const n = pool?.members?.length || 0;
  if (!n) return 'No products';
  const packs = new Set(
    (pool.members || []).map((p) => productStockPack(p, caseSizes).label || p.case_size || '').filter(Boolean),
  );
  const packNote = packs.size ? ` · ${packs.size} pack${packs.size === 1 ? '' : 's'}` : '';
  return `${n} product${n === 1 ? '' : 's'}${packNote}`;
}
