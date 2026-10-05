/**
 * Per-bar product menus — matches v2 Distribution barServesProduct rules.
 * Empty bar_products for a bar means it serves the full event catalogue.
 */

export function barProductRows(barProducts, barId) {
  if (!barId) return [];
  return (barProducts || []).filter((r) => r.bar_id === barId);
}

export function barServesProduct(barProducts, barId, productId) {
  if (!barId || !productId) return false;
  const rows = barProductRows(barProducts, barId);
  if (!rows.length) return true;
  return rows.some((r) => r.product_id === productId);
}

export function filterEventProductsForBar(eventProducts, barProducts, barId) {
  if (!barId) return [];
  return (eventProducts || []).filter(
    (ep) => ep.product?.name && barServesProduct(barProducts, barId, ep.product_id),
  );
}

export function hasBarMenu(barProducts, barId) {
  return barProductRows(barProducts, barId).length > 0;
}
