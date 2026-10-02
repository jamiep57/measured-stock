/**
 * Planned vs ordered vs delivered — the bridge from menu planning to stock.
 *
 *   planned    cases needed from projected serves (or a manual override)
 *   confirmed  cases on confirmed purchase orders; when a product has no
 *              orders at all, the legacy event_products.qty_ordered is
 *              used and flagged as "manual"
 *   pending    cases on draft / sent orders (not yet confirmed)
 *   countedIn  cases physically counted in from deliveries
 *
 * None of these create stock — only deliveries do.
 */

import { productStockPack, findOfferForSupplier } from '../pack-metrics.js';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const EPS = 1e-9;

/** Servings in one stock case (serves per unit × units per case). */
export function servesPerCase(servesPerUnit, product, caseSizes = []) {
  const spu = num(servesPerUnit);
  if (spu == null || spu <= 0) return null;
  const upc = productStockPack(product, caseSizes).unitsPerCase || num(product?.units_per_case) || 1;
  return spu * upc;
}

/**
 * Cases to order for one menu line.
 * @returns {{ cases: number|null, source: 'override'|'projection'|null }}
 */
export function plannedCases(item, line, product, caseSizes = [], bufferPct = 0) {
  const override = num(item?.planned_qty_override);
  if (override != null) return { cases: override, source: 'override' };
  if (item?.included === false) return { cases: null, source: null };
  const serves = num(line?.projectedServes ?? item?.projected_serves);
  const perCase = servesPerCase(line?.servesPerUnit, product, caseSizes);
  if (serves == null || serves <= 0 || !perCase) return { cases: null, source: null };
  const buffer = Math.max(0, num(bufferPct) || 0);
  const raw = (serves * (1 + buffer / 100)) / perCase;
  return { cases: Math.ceil(raw - EPS), source: 'projection' };
}

/** Sum PO lines per product by status bucket. Cancelled orders are ignored. */
export function orderedByProduct(purchaseOrders) {
  const map = new Map();
  (purchaseOrders || []).forEach((po) => {
    if (po.status === 'cancelled') return;
    (po.purchase_order_lines || po.lines || []).forEach((line) => {
      const qty = num(line.qty_cases) || 0;
      const cur = map.get(line.product_id) || { confirmed: 0, pending: 0, refs: [] };
      if (po.status === 'confirmed') cur.confirmed += qty;
      else cur.pending += qty;
      cur.refs.push(po.reference);
      map.set(line.product_id, cur);
    });
  });
  return map;
}

export function compareStatus(planned, confirmed) {
  const p = num(planned);
  const c = num(confirmed) || 0;
  if (p == null || p <= 0) return c > 0 ? 'unplanned' : 'none';
  if (c + EPS < p) return 'short';
  if (c - EPS > p) return 'over';
  return 'ok';
}

/**
 * @param {{
 *   productIds: string[],
 *   planned: Map<string, number|null>,
 *   ordered: Map<string, { confirmed: number, pending: number, refs: string[] }>,
 *   eventProducts?: object[],
 *   countedIn?: Record<string, number>|null,
 * }} input
 */
export function compareOrders({ productIds, planned, ordered, eventProducts = [], countedIn = null }) {
  const epByProduct = new Map((eventProducts || []).map((ep) => [ep.product_id, ep]));
  return productIds.map((pid) => {
    const o = ordered.get(pid);
    const ep = epByProduct.get(pid);
    const manual = !o && ep ? num(ep.qty_ordered) || 0 : 0;
    const confirmed = o ? o.confirmed : manual;
    const pending = o ? o.pending : 0;
    const p = planned.get(pid) ?? null;
    const delivered = countedIn && countedIn[pid] != null
      ? num(countedIn[pid]) || 0
      : (ep?.delivered_qty != null ? num(ep.delivered_qty) || 0 : 0);
    const status = compareStatus(p, confirmed);
    return {
      productId: pid,
      planned: p,
      confirmed,
      pending,
      confirmedSource: o ? 'orders' : (manual > 0 ? 'manual' : null),
      refs: o?.refs || [],
      countedIn: delivered,
      gap: p == null ? null : confirmed - p,
      shortfallAfterPending: p == null ? 0 : Math.max(0, p - confirmed - pending),
      undelivered: Math.max(0, confirmed - delivered),
      status,
    };
  });
}

export function compareSummary(rows) {
  const out = { planned: 0, confirmed: 0, pending: 0, countedIn: 0, short: 0, over: 0, unplanned: 0, ok: 0 };
  rows.forEach((r) => {
    out.planned += r.planned || 0;
    out.confirmed += r.confirmed || 0;
    out.pending += r.pending || 0;
    out.countedIn += r.countedIn || 0;
    if (r.status in out) out[r.status] += 1;
  });
  return out;
}

/** Preferred supplier for a product (offer, then legacy supplier_id). */
export function preferredSupplierId(product) {
  const offer = findOfferForSupplier(product, null);
  return offer?.supplier_id || product?.supplier_id || null;
}

/**
 * Group remaining shortfalls (after pending orders) into one draft order
 * per preferred supplier. Products with no supplier come back separately.
 */
export function draftOrdersFromShortfalls(rows, productById) {
  const bySupplier = new Map();
  const unassigned = [];
  rows.forEach((r) => {
    const qty = Math.ceil(r.shortfallAfterPending - EPS);
    if (!(qty > 0)) return;
    const product = productById.get(r.productId);
    const supplierId = preferredSupplierId(product);
    if (!supplierId) {
      unassigned.push({ productId: r.productId, qty });
      return;
    }
    const offer = findOfferForSupplier(product, supplierId);
    const list = bySupplier.get(supplierId) || [];
    list.push({
      product_id: r.productId,
      qty_cases: qty,
      case_price: num(offer?.case_price),
    });
    bySupplier.set(supplierId, list);
  });
  return {
    orders: [...bySupplier.entries()].map(([supplierId, lines]) => ({ supplierId, lines })),
    unassigned,
  };
}

export function orderLinesTotal(lines) {
  let total = 0;
  let priced = 0;
  (lines || []).forEach((l) => {
    const qty = num(l.qty_cases);
    const price = num(l.case_price);
    if (qty == null || price == null) return;
    total += qty * price;
    priced += 1;
  });
  return { total: Math.round(total * 100) / 100, priced, lines: (lines || []).length };
}
