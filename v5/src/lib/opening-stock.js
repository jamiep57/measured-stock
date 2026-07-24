/** Opening stock and distribution allocation helpers (matches v2). */

import { storedToForm, totalUnitsForProduct, parseQty } from '../stock-entry.js';

export function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function epOpeningStock(ep) {
  const delivered = ep.delivered_qty != null
    ? ep.delivered_qty
    : (ep.qty_ordered != null ? ep.qty_ordered : 0);
  return round1(Number(delivered) - Number(ep.damaged_qty || 0));
}

/** Cases (stock units) on a delivery line. */
export function deliveryLineCases(line, product, caseSizes) {
  if (!product) return parseQty(line?.qty);
  const form = storedToForm(line);
  return totalUnitsForProduct(form.cases, form.singles, product, caseSizes);
}

/**
 * Sum counted-in qty per product_id across all delivery lines.
 * Falls back to nothing for products with no lines (caller may use ep.delivered_qty).
 */
export function countedInFromDeliveries(deliveries, eventProducts, caseSizes) {
  const map = {};
  const eps = eventProducts || [];
  (deliveries || []).forEach((d) => {
    (d.lines || []).forEach((l) => {
      if (!l.product_id) return;
      const p = eps.find((ep) => ep.product_id === l.product_id)?.product;
      map[l.product_id] = round1((map[l.product_id] || 0) + deliveryLineCases(l, p, caseSizes));
    });
  });
  return map;
}

/** Sum damaged qty per product_id across all delivery lines. */
export function damagedFromDeliveries(deliveries) {
  const map = {};
  (deliveries || []).forEach((d) => {
    (d.lines || []).forEach((l) => {
      if (!l.product_id) return;
      map[l.product_id] = round1((map[l.product_id] || 0) + parseQty(l.damaged_qty));
    });
  });
  return map;
}

/** Delivered qty for an event product: prefer summed delivery lines when provided. */
export function epDeliveredQty(ep, countedIn = null) {
  if (countedIn && ep?.product_id != null && countedIn[ep.product_id] != null) {
    return Number(countedIn[ep.product_id]) || 0;
  }
  return ep?.delivered_qty != null ? Number(ep.delivered_qty) || 0 : 0;
}

export function distRowFor(distRows, barId, productId) {
  const sb = String(barId);
  const sp = String(productId);
  return (distRows || []).find(
    (x) => String(x.bar_id) === sb && String(x.product_id) === sp,
  );
}

export function distAllocatedToBars(distRows, productId, bars, isBoneYard) {
  return (bars || []).reduce((sum, b) => {
    if (isBoneYard?.(b)) return sum;
    const d = distRowFor(distRows, b.id, productId);
    return sum + (d ? Number(d.qty_allocated) || 0 : 0);
  }, 0);
}

export function leftToAllocate(opening, allocated) {
  return round1(opening - allocated);
}

export function openingByProduct(eventProducts) {
  const map = {};
  (eventProducts || []).forEach((ep) => {
    if (ep.product_id) map[ep.product_id] = epOpeningStock(ep);
  });
  return map;
}
