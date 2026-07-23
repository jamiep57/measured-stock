/**
 * WYSIWYG stock entry — no save/load conversion, no evalMath.
 */

import { productStockPack } from './pack-metrics.js';

export function parseQty(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Form → DB shape for delivery_lines (qty + singles). */
export function formToStored({ cases, singles, qty }) {
  return {
    qty: parseQty(cases ?? qty),
    singles: parseQty(singles),
  };
}

/** DB row → form display strings. Passthrough — no splitting. */
export function storedToForm(line) {
  if (!line) return { cases: '', singles: '' };
  const casesVal = line.cases ?? line.qty;
  return {
    cases: casesVal != null && casesVal !== 0 ? String(casesVal) : '',
    singles: line.singles != null && line.singles !== 0 ? String(line.singles) : '',
  };
}

/** stock_count_lines use cases + singles columns. */
export function formToCountStored({ cases, singles }) {
  return {
    cases: parseQty(cases),
    singles: parseQty(singles),
  };
}

export function countStoredToForm(line) {
  return storedToForm({ cases: line?.cases, singles: line?.singles });
}

/**
 * Total stock units for reports/progress only — never rewrite inputs.
 * @param {number} cases — primary column (cases, bottles, kegs)
 * @param {number} singles — secondary (loose singles, or decimal partial of one unit)
 * @param {object} pack — from packMetrics / productStockPack
 */
export function totalUnits(cases, singles, pack) {
  const c = parseQty(cases);
  const s = parseQty(singles);
  const ups = pack?.unitsPerCase > 0 ? pack.unitsPerCase : 1;

  if (pack?.stockUnit === 'bottle') {
    return c + s;
  }

  if (pack?.stockUnit === 'case') {
    return c + s / ups;
  }

  if (pack?.stockUnit === 'keg' || pack?.stockUnit === 'unit') {
    return c + s;
  }

  return c + (ups > 1 ? s / ups : s);
}

export function totalUnitsForProduct(cases, singles, product, caseSizes) {
  const pack = productStockPack(product, caseSizes);
  return totalUnits(cases, singles, pack);
}

export function hasQuantity(cases, singles) {
  return parseQty(cases) > 0 || parseQty(singles) > 0;
}

export function inputAttrsForSecondary(mode) {
  if (mode?.secondaryStep === '0.1') {
    return { type: 'number', inputMode: 'decimal', step: '0.1', min: '0', max: '0.99' };
  }
  if (mode?.secondaryStep) {
    return { type: 'number', inputMode: 'numeric', step: mode.secondaryStep, min: '0' };
  }
  return null;
}

export function inputAttrsPrimary() {
  return { type: 'number', inputMode: 'decimal', step: 'any', min: '0' };
}
