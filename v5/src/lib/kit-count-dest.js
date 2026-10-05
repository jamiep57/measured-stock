import { validateEventStock } from './kit-stock.js';

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

function cloneBalances(balances) {
  const map = new Map();
  for (const [pid, row] of balances || []) {
    map.set(pid, {
      onHand: round1(row?.onHand) || 0,
      owned: round1(row?.owned) || 0,
      hired: round1(row?.hired) || 0,
    });
  }
  return map;
}

function bumpBalanceOwned(balances, productId, delta) {
  const map = cloneBalances(balances);
  const row = map.get(productId) || { onHand: 0, owned: 0, hired: 0 };
  const owned = round1(row.owned + delta);
  const hired = round1(row.hired);
  map.set(productId, {
    owned,
    hired,
    onHand: round1(owned + hired),
  });
  return map;
}

/**
 * Ensure an event_kit_items row exists without inventing Need/Packed.
 * @returns {Promise<{ items: object[], item: object }>}
 */
export async function ensureEventKitRow(DB, eventId, items, product, { source = 'own' } = {}) {
  if (!eventId || !product?.id) throw new Error('Missing event or product');
  const list = (items || []).slice();
  const existing = list.find((it) => it.product_id === product.id);
  if (existing) {
    existing.product = existing.product || product;
    return { items: list, item: existing };
  }
  const [row] = await DB.insert('event_kit_items', {
    event_id: eventId,
    product_id: product.id,
    qty_planned: 0,
    qty_packed: 0,
    source,
  });
  const full = {
    ...(row || {}),
    product_id: product.id,
    qty_planned: 0,
    qty_packed: 0,
    source,
    product,
  };
  list.push(full);
  return { items: list, item: full };
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
 * Count physical kit onto / off an event via adjust / write_off movements.
 * Does not change warehouse stock.
 * @returns {Promise<{ items: object[], balances: Map, line: { product_id: string, qty: number, product: object } | null, onHand: number }>}
 */
export async function applyEventPhysicalDelta(
  DB,
  eventId,
  items,
  balances,
  product,
  delta,
  { notes = 'Phone count' } = {},
) {
  if (!eventId || !product?.id) throw new Error('Missing event or product');
  const d = round1(delta);
  const current = round1(balances?.get(product.id)?.onHand) || 0;
  if (!d) {
    return { items, balances, line: { product_id: product.id, qty: current, product }, onHand: current };
  }

  const next = round1(current + d);
  if (next < 0) throw new Error('On event can’t go below zero');

  const movementType = d > 0 ? 'adjust' : 'write_off';
  const qty = Math.abs(d);
  if (movementType === 'write_off') {
    const check = validateEventStock(balances || new Map(), movementType, [
      { product_id: product.id, qty },
    ]);
    if (!check.ok) {
      throw new Error(
        `Not enough on event (have ${round1(check.available)}, need ${round1(check.needed)})`,
      );
    }
  }

  const ensured = await ensureEventKitRow(DB, eventId, items, product);
  const list = ensured.items;

  const [header] = await DB.insert('kit_movements', {
    event_id: eventId,
    movement_type: movementType,
    moved_at: new Date().toISOString(),
    notes: notes || null,
  });
  if (!header?.id) throw new Error('Could not save event count');

  await DB.insert('kit_movement_lines', [{
    movement_id: header.id,
    product_id: product.id,
    qty,
    warehouse_id: null,
    supplier_id: null,
    hire_company: null,
  }]);

  const nextBalances = bumpBalanceOwned(balances, product.id, d);
  return {
    items: list,
    balances: nextBalances,
    line: { product_id: product.id, qty: next, product },
    onHand: next,
  };
}

/**
 * Set absolute physical on-event qty via adjust / write_off.
 */
export async function setEventPhysicalQty(
  DB,
  eventId,
  items,
  balances,
  product,
  qty,
  opts = {},
) {
  const current = round1(balances?.get(product.id)?.onHand) || 0;
  const next = Math.max(0, round1(qty));
  return applyEventPhysicalDelta(
    DB,
    eventId,
    items,
    balances,
    product,
    next - current,
    opts,
  );
}

/**
 * Display lines for physical on-event counting (onHand > 0).
 */
export function eventPhysicalLines(balances, productsById = new Map()) {
  const out = [];
  for (const [productId, bal] of balances || []) {
    const onHand = round1(bal?.onHand) || 0;
    if (onHand <= 0) continue;
    out.push({
      product_id: productId,
      qty: onHand,
      product: productsById.get(productId) || null,
    });
  }
  out.sort((a, b) =>
    String(a.product?.name || '').localeCompare(String(b.product?.name || '')));
  return out;
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
