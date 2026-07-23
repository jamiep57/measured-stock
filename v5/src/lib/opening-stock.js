/** Opening stock and distribution allocation helpers (matches v2). */

export function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

export function epOpeningStock(ep) {
  const delivered = ep.delivered_qty != null
    ? ep.delivered_qty
    : (ep.qty_ordered != null ? ep.qty_ordered : 0);
  return round1(Number(delivered) - Number(ep.damaged_qty || 0));
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
