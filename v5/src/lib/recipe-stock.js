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

function pickProductByRecipeQty(candidates, qty, caseSizes = []) {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  const q = Number(qty) || 0;
  if (!(q > 0)) return candidates[0];
  let best = candidates[0];
  let bestDiff = Infinity;
  candidates.forEach((p) => {
    const pack = productStockPack(p, caseSizes);
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

/** Em dash separator used when multiple SKUs share a product name. */
export const RECIPE_PACK_SEP = ' \u2014 ';

/**
 * Persistable recipe ingredient label. When a pack label exists, store
 * `Name — Pack` so cans / 30L / 50L (same name) stay distinct on reload.
 */
export function recipeStoredProductName(product, caseSizes = []) {
  const name = String(product?.name || '').trim();
  if (!name) return '';
  const pack = productStockPack(product, caseSizes);
  const label = (pack.label || product.case_size || '').trim();
  return label ? `${name}${RECIPE_PACK_SEP}${label}` : name;
}

/**
 * Exact product_name strings that should be rewritten when a catalogue
 * product is renamed or its pack label changes. Recipes store names (not
 * ids), so renames must update recipe_ingredients or mappings appear empty.
 */
export function recipeProductNameRewrites(oldProduct, newProduct, caseSizes = []) {
  const oldStored = recipeStoredProductName(oldProduct, caseSizes);
  const newStored = recipeStoredProductName(newProduct, caseSizes);
  if (!oldStored || !newStored || oldStored === newStored) return [];

  const rewrites = [{ from: oldStored, to: newStored }];
  const oldName = String(oldProduct?.name || '').trim();
  const newName = String(newProduct?.name || '').trim();
  // Legacy bare labels (no pack suffix) still need updating when the name
  // itself changes. Skip on pack-only edits so shared bare names stay put.
  if (oldName && newName && oldName !== newName && oldName !== oldStored) {
    rewrites.push({ from: oldName, to: newStored });
  }
  return rewrites;
}

/**
 * Update recipe_ingredients.product_name after a product rename / pack change.
 * Mirrors volume-pool rename behaviour. Failures are ignored so a missing
 * recipes table never blocks saving the product.
 */
export async function syncRecipeIngredientsForProductRename(
  DB,
  oldProduct,
  newProduct,
  caseSizes = [],
) {
  const rewrites = recipeProductNameRewrites(oldProduct, newProduct, caseSizes);
  const oldName = String(oldProduct?.name || '').trim();
  const newName = String(newProduct?.name || '').trim();
  if (!rewrites.length && !(oldName && newName && oldName !== newName)) return;

  const enc = DB._.enc;
  for (const { from, to } of rewrites) {
    try {
      await DB.update(
        'recipe_ingredients',
        'product_name=eq.' + enc(from),
        { product_name: to },
      );
    } catch {
      // Recipe table may be empty / unavailable — product rename still matters.
    }
  }

  // Catch pack-qualified variants that differ slightly from recipeStoredProductName
  // (e.g. × vs x) when the product name itself changed.
  if (oldName && newName && oldName !== newName) {
    try {
      const rows = await DB.select(
        'recipe_ingredients',
        '?product_name=like.' + enc(oldName + RECIPE_PACK_SEP) + '*&select=id,product_name',
      );
      for (const row of rows || []) {
        const raw = String(row.product_name || '');
        const sepAt = raw.indexOf(RECIPE_PACK_SEP);
        if (sepAt < 0) continue;
        const next = newName + raw.slice(sepAt);
        if (!next || next === raw) continue;
        await DB.update(
          'recipe_ingredients',
          'id=eq.' + enc(row.id),
          { product_name: next },
        );
      }
    } catch {
      // Same as above — product save should still succeed.
    }
  }
}

function productPackLabel(product, caseSizes = []) {
  const pack = productStockPack(product, caseSizes);
  return (pack.label || product?.case_size || '').trim();
}

/**
 * Resolve a recipe ingredient name to a library product.
 * When several SKUs share a name, prefer the pack whose size matches qtyHint
 * (case fraction), using caseSizes / legacy units_per_case.
 * Stored names may be bare (`Gin`) or pack-qualified (`Gin — 70cl`).
 */
export function recipeProductByName(storedName, qtyHint, products = [], caseSizes = []) {
  const raw = String(storedName ?? '').trim();
  if (!raw) return null;
  const nLower = raw.toLowerCase();
  const dash = raw.indexOf(RECIPE_PACK_SEP);
  if (dash > 0) {
    const name = raw.slice(0, dash).trim().toLowerCase();
    const cs = normCaseSizeLabel(raw.slice(dash + RECIPE_PACK_SEP.length));
    const byPack = products.find((p) => {
      if ((p.name || '').trim().toLowerCase() !== name) return false;
      const pack = normCaseSizeLabel(productPackLabel(p, caseSizes));
      const legacy = normCaseSizeLabel(p.case_size || '');
      return (pack && pack === cs) || (legacy && legacy === cs);
    });
    if (byPack) return byPack;
  }
  const byName = products.filter((p) => (p.name || '').trim().toLowerCase() === nLower);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return pickProductByRecipeQty(byName, qtyHint, caseSizes);
  return byName[0] || null;
}

export function recipeIngredientDisplayName(storedName, products = [], qtyHint = null, caseSizes = []) {
  const p = recipeProductByName(storedName, qtyHint, products, caseSizes);
  if (!p) return storedName || '';
  const pack = p.case_size ? ` — ${p.case_size}` : '';
  return `${p.name}${pack}`;
}

function recipeIngredientStockKey(storedName, qtyHint, products = [], caseSizes = []) {
  const p = recipeProductByName(storedName, qtyHint, products, caseSizes);
  if (p?.name) return `${normProductName(p.name)}|${normCaseSizeLabel(p.case_size || '')}`;
  return `${normProductName(storedName)}|`;
}

export function pluStockKeyForRecipeIngredient(storedName, qtyHint, eps, products = [], caseSizes = []) {
  const exactKey = recipeIngredientStockKey(storedName, qtyHint, products, caseSizes);
  const p = recipeProductByName(storedName, qtyHint, products, caseSizes);
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
