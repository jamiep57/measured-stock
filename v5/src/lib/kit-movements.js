/**
 * Shared kit movement writes — warehouse ↔ event (and paired event ↔ event).
 */

import {
  affectsWarehouse,
  balancesByProduct,
  validateEventStock,
  warehouseQtyDelta,
} from './kit-stock.js';
import { adjustWarehouseStock } from './transfer-form.js';

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/**
 * Ensure each product has an event_kit_items row (own source by default).
 * @returns {Promise<object[]>} updated items list
 */
export async function ensureEventKitItems(DB, eventId, items, productIds, { source = 'own' } = {}) {
  const list = (items || []).slice();
  const onEvent = new Set(list.map((it) => it.product_id));
  for (const productId of productIds || []) {
    if (!productId || onEvent.has(productId)) continue;
    try {
      const [row] = await DB.insert('event_kit_items', {
        event_id: eventId,
        product_id: productId,
        qty_planned: 0,
        qty_packed: 0,
        source,
      });
      list.push({
        ...(row || {}),
        product_id: productId,
        qty_planned: 0,
        qty_packed: 0,
        source,
      });
      onEvent.add(productId);
    } catch (err) {
      if (!/23505/.test(String(err?.message || err))) throw err;
    }
  }
  return list;
}

/**
 * Sync qty_packed after a movement (matches admin Kit panel behaviour).
 * @returns {object[]} items with updated qty_packed
 */
export function applyPackedSync(items, movementType, lines) {
  const list = (items || []).slice();
  const byProduct = new Map(list.map((it, i) => [it.product_id, i]));

  const bump = (productId, delta) => {
    const idx = byProduct.get(productId);
    if (idx == null) return;
    const it = list[idx];
    const next = Math.max(0, round1((Number(it.qty_packed) || 0) + delta));
    list[idx] = { ...it, qty_packed: next };
  };

  if (movementType === 'warehouse_in' || movementType === 'hire_in') {
    for (const line of lines || []) bump(line.product_id, Number(line.qty) || 0);
  }
  if (movementType === 'warehouse_out' || movementType === 'hire_return' || movementType === 'write_off') {
    for (const line of lines || []) bump(line.product_id, -(Number(line.qty) || 0));
  }
  return list;
}

/**
 * Persist one kit movement (+ optional warehouse + packed sync).
 *
 * @param {object} DB
 * @param {{
 *   eventId: string,
 *   movementType: string,
 *   lines: Array<{ product_id: string, qty: number }>,
 *   warehouseId?: string|null,
 *   supplierId?: string|null,
 *   hireCompany?: string|null,
 *   notes?: string|null,
 *   movedAt?: string|null,
 *   items?: object[],
 *   balances?: Map,
 *   syncPacked?: boolean,
 *   ensureItems?: boolean,
 * }} opts
 * @returns {Promise<{ header: object, items: object[], balances: Map }>}
 */
export async function writeKitMovement(DB, opts) {
  const eventId = opts.eventId;
  const movementType = opts.movementType;
  const lines = (opts.lines || [])
    .map((l) => ({
      product_id: l.product_id,
      qty: round1(l.qty),
    }))
    .filter((l) => l.product_id && l.qty > 0);

  if (!eventId) throw new Error('Missing event');
  if (!movementType) throw new Error('Missing movement type');
  if (!lines.length) throw new Error('Add at least one line');

  const needsWarehouse = affectsWarehouse(movementType);
  const warehouseId = needsWarehouse ? String(opts.warehouseId || '') : '';
  if (needsWarehouse && !warehouseId) {
    throw new Error('Select a warehouse');
  }

  let items = (opts.items || []).slice();
  if (opts.ensureItems !== false && (movementType === 'warehouse_in' || movementType === 'hire_in')) {
    items = await ensureEventKitItems(
      DB,
      eventId,
      items,
      lines.map((l) => l.product_id),
      { source: movementType === 'hire_in' ? 'hire' : 'own' },
    );
  }

  const balances = opts.balances || balancesByProduct([]);
  const check = validateEventStock(balances, movementType, lines);
  if (!check.ok) {
    throw new Error(
      `Not enough on event (have ${round1(check.available)}, need ${round1(check.needed)})`,
    );
  }

  if (needsWarehouse) {
    for (const line of lines) {
      const delta = warehouseQtyDelta(movementType, line.qty);
      if (delta) await adjustWarehouseStock(warehouseId, line.product_id, delta);
    }
  }

  const movedAt = opts.movedAt || new Date().toISOString();
  const [header] = await DB.insert('kit_movements', {
    event_id: eventId,
    movement_type: movementType,
    moved_at: movedAt,
    notes: opts.notes || null,
  });
  if (!header?.id) throw new Error('Could not save movement');

  await DB.insert('kit_movement_lines', lines.map((l) => ({
    movement_id: header.id,
    product_id: l.product_id,
    qty: l.qty,
    warehouse_id: needsWarehouse ? warehouseId : null,
    supplier_id: opts.supplierId || null,
    hire_company: opts.hireCompany || null,
  })));

  if (opts.syncPacked !== false) {
    const prevPacked = new Map(
      items.map((it) => [it.product_id, round1(it.qty_packed) || 0]),
    );
    items = applyPackedSync(items, movementType, lines);
    for (const it of items) {
      if (!it?.id) continue;
      const before = prevPacked.has(it.product_id) ? prevPacked.get(it.product_id) : null;
      if (before != null && before === round1(it.qty_packed)) continue;
      await DB.update('event_kit_items', `id=eq.${DB._.enc(it.id)}`, { qty_packed: it.qty_packed });
    }
  }

  // Local balance bump for callers that keep an in-memory map
  const nextBalances = new Map();
  for (const [pid, row] of balances || []) {
    nextBalances.set(pid, {
      onHand: round1(row?.onHand) || 0,
      owned: round1(row?.owned) || 0,
      hired: round1(row?.hired) || 0,
    });
  }
  const sign = movementType === 'warehouse_in' || movementType === 'hire_in' || movementType === 'adjust'
    ? 1
    : movementType === 'warehouse_out' || movementType === 'hire_return' || movementType === 'write_off'
      ? -1
      : 0;
  if (sign) {
    for (const line of lines) {
      const row = nextBalances.get(line.product_id) || { onHand: 0, owned: 0, hired: 0 };
      const field = (movementType === 'hire_in' || movementType === 'hire_return') ? 'hired' : 'owned';
      row[field] = round1(row[field] + sign * line.qty);
      row.onHand = round1(row.owned + row.hired);
      nextBalances.set(line.product_id, row);
    }
  }

  return { header, items, balances: nextBalances };
}

/**
 * Move owned kit from one event to a warehouse (check-in).
 */
export async function transferKitToWarehouse(DB, {
  eventId,
  warehouseId,
  lines,
  items,
  balances,
  notes = 'Phone transfer to warehouse',
}) {
  return writeKitMovement(DB, {
    eventId,
    movementType: 'warehouse_out',
    warehouseId,
    lines,
    items,
    balances,
    notes,
    ensureItems: false,
  });
}

/**
 * Move owned kit from one event to another via a warehouse (net warehouse zero).
 */
export async function transferKitToEvent(DB, {
  fromEventId,
  toEventId,
  warehouseId,
  lines,
  fromItems,
  fromBalances,
  toItems,
  notes = 'Phone transfer to event',
}) {
  if (!toEventId || toEventId === fromEventId) {
    throw new Error('Pick a different event');
  }
  if (!warehouseId) throw new Error('Select a warehouse');

  const out = await writeKitMovement(DB, {
    eventId: fromEventId,
    movementType: 'warehouse_out',
    warehouseId,
    lines,
    items: fromItems,
    balances: fromBalances,
    notes,
    ensureItems: false,
  });

  const into = await writeKitMovement(DB, {
    eventId: toEventId,
    movementType: 'warehouse_in',
    warehouseId,
    lines,
    items: toItems || [],
    balances: balancesByProduct([]),
    notes,
    ensureItems: true,
  });

  return { out, into };
}
