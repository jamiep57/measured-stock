/**
 * One stock product can be sold in more than one size.
 * Pint and half share the keg. Each size has its own price.
 * Portion is how much of one serve that size uses: a half is 0.5.
 */

export function serveKey(label) {
  return String(label ?? '').trim().toLowerCase();
}

export function portionOf(item) {
  const n = Number(item?.portion);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Fields that belong to the keg or bottle, so every size of a product shares them. */
export const SHARED_MENU_FIELDS = new Set([
  'serves_per_unit',
  'unit_cost_override',
  'deal_ref',
  'planned_qty_override',
]);

/** @returns {Map<string, object[]>} */
export function groupMenuItems(items) {
  const map = new Map();
  (items || []).forEach((item) => {
    if (!item?.product_id) return;
    const list = map.get(item.product_id) || [];
    list.push(item);
    map.set(item.product_id, list);
  });
  return map;
}

/** The row that represents one full serve of the product. */
export function baseMenuItem(items) {
  const list = Array.isArray(items) ? items : [];
  return list.find((item) => portionOf(item) === 1) || list[0] || null;
}
