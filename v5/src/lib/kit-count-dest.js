/**
 * Mobile kit count destinations — library BOM, event pack, warehouse receive.
 */

export const DEST_LIBRARY = 'library';
export const DEST_EVENT = 'event';
export const DEST_WAREHOUSE = 'warehouse';

export const DEST_LABELS = {
  [DEST_LIBRARY]: 'Library containers',
  [DEST_EVENT]: 'Kit',
  [DEST_WAREHOUSE]: 'Warehouse',
};

export const DEST_HINTS = {
  [DEST_LIBRARY]: 'Count what’s inside boxes / kit crates',
  [DEST_EVENT]: 'Pick an event, then count containers and what’s inside onto the pack list',
  [DEST_WAREHOUSE]: 'Pick a warehouse, then count containers and receive what’s inside',
};

const DEST_STORE_KEY = 'ms_kit_count_destination';

/** @returns {'event'|'warehouse'|null} */
export function normalizeDestType(type) {
  if (type === DEST_EVENT || type === DEST_WAREHOUSE) return type;
  return null;
}

export function loadStoredDestination() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEST_STORE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const type = normalizeDestType(raw.type);
    if (type === DEST_EVENT && raw.eventId) {
      return { type, eventId: String(raw.eventId), eventName: raw.eventName || 'Event' };
    }
    if (type === DEST_WAREHOUSE && raw.warehouseId) {
      return {
        type,
        warehouseId: String(raw.warehouseId),
        warehouseName: raw.warehouseName || 'Warehouse',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function storeDestination(dest) {
  try {
    if (!dest?.type) {
      localStorage.removeItem(DEST_STORE_KEY);
      return;
    }
    localStorage.setItem(DEST_STORE_KEY, JSON.stringify(dest));
  } catch { /* ignore */ }
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/**
 * Apply a packed-qty delta on an event kit list.
 * @returns {Promise<{ items: object[], line: { product_id: string, qty: number, product: object } }>}
 */
export async function applyEventPackDelta(DB, eventId, items, product, delta) {
  if (!eventId || !product?.id) throw new Error('Missing event or product');
  const d = round1(delta);
  if (!d) return { items, line: null };

  const list = (items || []).slice();
  const existing = list.find((it) => it.product_id === product.id);

  if (existing) {
    const next = Math.max(0, round1((Number(existing.qty_packed) || 0) + d));
    await DB.update(
      'event_kit_items',
      `id=eq.${DB._.enc(existing.id)}`,
      { qty_packed: next },
    );
    existing.qty_packed = next;
    existing.product = existing.product || product;
    return {
      items: list,
      line: { product_id: product.id, qty: next, product: existing.product || product },
    };
  }

  if (d < 0) return { items: list, line: null };

  const planned = Math.max(1, d);
  const [row] = await DB.insert('event_kit_items', {
    event_id: eventId,
    product_id: product.id,
    qty_planned: planned,
    qty_packed: d,
    source: 'own',
  });
  const full = {
    ...(row || {}),
    product_id: product.id,
    qty_planned: planned,
    qty_packed: d,
    source: 'own',
    product,
  };
  list.push(full);
  return {
    items: list,
    line: { product_id: product.id, qty: d, product },
  };
}

/**
 * Set absolute packed qty (0 removes from session list visually; keeps event row).
 */
export async function setEventPackedQty(DB, eventId, items, product, qty) {
  const next = Math.max(0, round1(qty));
  const existing = (items || []).find((it) => it.product_id === product.id);
  if (existing) {
    await DB.update(
      'event_kit_items',
      `id=eq.${DB._.enc(existing.id)}`,
      { qty_packed: next },
    );
    existing.qty_packed = next;
    return {
      items,
      line: { product_id: product.id, qty: next, product: existing.product || product },
    };
  }
  if (next <= 0) return { items, line: null };
  return applyEventPackDelta(DB, eventId, items, product, next);
}

/**
 * Load warehouse on-hand map for kit products.
 * @returns {Promise<Map<string, number>>}
 */
export async function loadWarehouseKitStockMap(DB, warehouseId) {
  const map = new Map();
  if (!warehouseId) return map;
  try {
    const rows = await DB.select(
      'warehouse_stock',
      `?warehouse_id=eq.${DB._.enc(warehouseId)}&select=product_id,qty_on_hand`,
    );
    for (const row of rows || []) {
      if (!row.product_id) continue;
      map.set(row.product_id, round1(Number(row.qty_on_hand) || 0));
    }
  } catch { /* empty */ }
  return map;
}

/**
 * Bump warehouse on-hand for a kit product (receive / adjust).
 * @returns {Promise<{ stockMap: Map<string, number>, qty: number }>}
 */
export async function applyWarehouseDelta(DB, warehouseId, stockMap, productId, delta) {
  if (!warehouseId || !productId) throw new Error('Missing warehouse or product');
  const d = round1(delta);
  if (!d) {
    return { stockMap, qty: round1(stockMap.get(productId) || 0) };
  }
  const current = round1(stockMap.get(productId) || 0);
  const next = round1(current + d);
  if (next < 0) throw new Error('On hand can’t go below zero');
  await DB.warehouseStock.setQty(warehouseId, productId, next);
  const map = new Map(stockMap);
  map.set(productId, next);
  return { stockMap: map, qty: next };
}

export async function setWarehouseQty(DB, warehouseId, stockMap, productId, qty) {
  if (!warehouseId || !productId) throw new Error('Missing warehouse or product');
  const next = Math.max(0, round1(qty));
  await DB.warehouseStock.setQty(warehouseId, productId, next);
  const map = new Map(stockMap);
  map.set(productId, next);
  return { stockMap: map, qty: next };
}

/**
 * Build display lines for event pack counting (items with packed > 0, or all touched).
 */
export function eventPackLines(items) {
  return (items || [])
    .filter((it) => (Number(it.qty_packed) || 0) > 0)
    .map((it) => ({
      product_id: it.product_id,
      qty: round1(Number(it.qty_packed) || 0),
      product: it.product || null,
    }))
    .sort((a, b) => String(a.product?.name || '').localeCompare(String(b.product?.name || '')));
}
