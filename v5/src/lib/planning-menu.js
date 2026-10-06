/**
 * Event menu planning — resolve each menu item to prices, cost and GP.
 *
 * Precedence:
 *   cost/unit   snapshot (locked) → deal override → case price ÷ units → product
 *               (this is the price of one inner unit: a can, bottle, or keg)
 *   case price  the supplier case price. A stored unit price is used only
 *               when there is no case price. Never multiply the case price
 *               by the pack again — that turns a £7.28 case into £174.72.
 *   serves      item → house menu → serves in one case
 *               (pack servings × units in the case, so a 24×330ml case is 24)
 *   cost/serve  portion × (case price ÷ serves). Portion is 1 for a full
 *               serve and 0.5 for a half.
 *   target GP   item → house menu → event → price year → default
 */

import { findOfferForSupplier, productStockPack } from '../pack-metrics.js';
import { servingsPerCase } from './volume-pools.js';
import { menuNameOf } from './product-attributes.js';
import {
  DEFAULT_AMBER_BAND,
  DEFAULT_TARGET_GP_PCT,
  DEFAULT_VAT_RATE,
  costPerServe,
  gpPct,
  gpPerServe,
  gpStatus,
  mixGp,
  netFromGross,
  requiredPrice,
} from './gp.js';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstNum(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n != null) return n;
  }
  return null;
}

/** Price paid for one case: preferred offer, else the product. */
function paidCasePrice(product) {
  if (!product) return null;
  const offer = findOfferForSupplier(product);
  return num(offer?.case_price) ?? num(product.case_price);
}

function packUnits(product, unitsPerCase) {
  const passed = num(unitsPerCase);
  if (passed != null && passed > 0) return passed;
  const onProduct = num(product?.units_per_case);
  return onProduct != null && onProduct > 0 ? onProduct : 1;
}

/**
 * Price of one inner unit (one can, bottle, or keg).
 * The amount you pay is the case price, split across the pack. Older rows
 * stored that same case price on unit price as well; multiplying it by 24
 * prices the case twice.
 */
export function liveUnitCost(product, unitsPerCase) {
  if (!product) return null;
  const paid = paidCasePrice(product);
  const upc = packUnits(product, unitsPerCase);
  if (paid != null && upc > 0) return paid / upc;
  const offer = findOfferForSupplier(product);
  const unit = num(offer?.unit_price);
  if (unit != null) return unit;
  return num(product.unit_price);
}

export function resolveUnitCost(item, product, unitsPerCase) {
  const snap = num(item?.unit_cost_snapshot);
  if (snap != null) return { unitCost: snap, source: 'locked' };
  const deal = num(item?.unit_cost_override);
  if (deal != null) return { unitCost: deal, source: 'deal' };
  const live = liveUnitCost(product, unitsPerCase);
  if (live != null) return { unitCost: live, source: 'supplier' };
  return { unitCost: null, source: null };
}

export function eventVatRate(year) {
  const v = num(year?.vat_rate);
  return v != null ? v : DEFAULT_VAT_RATE;
}

export function eventTargetGp(event, year) {
  return firstNum(event?.target_gp_pct, year?.default_target_gp_pct, DEFAULT_TARGET_GP_PCT);
}

/**
 * @param {object} item event_menu_items row (or a house_menu_prices row for house planning)
 * @param {{ product?: object, house?: object, year?: object, event?: object, caseSizes?: object[] }} ctx
 */
export function resolveMenuLine(item, ctx = {}) {
  const { product, house, year, event, caseSizes = [] } = ctx;
  const vatRate = eventVatRate(year);
  const pack = product ? productStockPack(product, caseSizes) : null;
  const unitsPerCase = pack?.unitsPerCase > 0 ? pack.unitsPerCase : 1;
  // Serves is how many pours you get from one case. A stored 24 on a
  // 24-can case is that same number, not a second split of the can price.
  const servesPerUnit = firstNum(
    item?.serves_per_unit,
    house?.serves_per_unit,
    product ? servingsPerCase(product, caseSizes) : null,
  );
  const { unitCost, source: costSource } = resolveUnitCost(item, product, unitsPerCase);
  const supplierCase = costSource === 'supplier' ? paidCasePrice(product) : null;
  const caseCost = supplierCase != null
    ? supplierCase
    : (unitCost != null ? unitCost * unitsPerCase : null);
  const portion = firstNum(item?.portion) ?? 1;
  const portionSafe = portion > 0 ? portion : 1;
  const baseCost = costPerServe(caseCost, servesPerUnit);
  const cps = baseCost != null ? baseCost * portionSafe : null;
  const targetGpPct = firstNum(item?.target_gp_pct, house?.target_gp_pct, eventTargetGp(event, year));
  const menuPrice = num(item?.menu_price);
  const required = requiredPrice(cps, targetGpPct, vatRate);
  const suggested = firstNum(item?.suggested_price, house?.suggested_price, required);
  const gp = gpPct(menuPrice, cps, vatRate);
  const serves = num(item?.projected_serves);
  const amberBand = firstNum(event?.gp_amber_band, DEFAULT_AMBER_BAND);
  const revenueGross = menuPrice != null && serves != null ? menuPrice * serves : null;
  const perServe = gpPerServe(menuPrice, cps, vatRate);

  const caseSize = (pack?.label || product?.case_size || '').trim();

  return {
    itemId: item?.id || null,
    productId: item?.product_id || product?.id || null,
    name: product?.name || '',
    menuName: menuNameOf(product),
    caseSize,
    stockUnit: pack?.stockUnit || product?.stock_unit || null,
    abv: num(product?.abv),
    category: product?.category?.name || 'Uncategorised',
    included: item?.included !== false,
    serveLabel: item?.serve_label || house?.serve_label || null,
    portion: portionSafe,
    vatRate,
    servesPerUnit,
    unitsPerCase,
    unitCost,
    caseCost,
    costSource,
    costPerServe: cps,
    targetGpPct,
    menuPrice,
    housePrice: num(house?.menu_price),
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

/**
 * Parse a grid cell ("£6.50", "72%", "1,200", "") → { ok, value }.
 * Empty means "clear" (value null). Negative numbers are rejected.
 */
export function parsePlanningNumber(raw, { max } = {}) {
  const text = String(raw ?? '').replace(/[£,%\s]/g, '');
  if (!text) return { ok: true, value: null };
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return { ok: false, value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return { ok: false, value: null };
  if (max != null && value >= max) return { ok: false, value: null };
  return { ok: true, value: Math.round(value * 10000) / 10000 };
}

/** Price typed into a Menu & GP cell, shown as accounting pounds to two decimals. */
export function formatPlanningPriceInput(n) {
  if (n == null || n === '') return '';
  const parsed = parsePlanningNumber(n);
  if (!parsed.ok || parsed.value == null) return '';
  return parsed.value.toFixed(2);
}

/** GP for the same line priced at an alternative (scenario) price. */
export function scenarioGp(line, price) {
  const p = num(price);
  if (p == null) return { gpPct: null, status: null };
  const gp = gpPct(p, line.costPerServe, line.vatRate);
  return { gpPct: gp, status: gpStatus(gp, line.targetGpPct, line.amberBand) };
}

/** Mix totals across included lines (optionally at scenario prices). */
export function menuTotals(lines, { priceFor } = {}) {
  const usable = (lines || []).filter((l) => l.included);
  return mixGp(
    usable.map((l) => ({
      price: priceFor ? priceFor(l) : l.menuPrice,
      costPerServe: l.costPerServe,
      serves: l.projectedServes,
      vatRate: l.vatRate,
    })),
  );
}
