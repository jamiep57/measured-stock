/**
 * Kit stock balance helpers — event on-hand from movement lines.
 *
 * Movement types and event qty sign:
 *   warehouse_in  +   (owned kit arrives from warehouse)
 *   warehouse_out -   (owned kit returns to warehouse)
 *   hire_in       +   (hired kit arrives)
 *   hire_return   -   (hired kit returned)
 *   write_off     -   (lost / damaged)
 *   adjust        +   (qty may still be positive; use type for direction —
 *                     adjust always adds; for reductions use write_off or a
 *                     dedicated negative path via warehouse_out/hire_return)
 *
 * Planned source on event_kit_items:
 *   own  — cover from warehouse stock
 *   hire — cover via external hire-in
 */

export const KIT_SOURCES = ['own', 'hire'];

export const KIT_SOURCE_LABELS = {
  own: 'Own',
  hire: 'Hire-in',
};

export const KIT_MOVEMENT_TYPES = [
  'warehouse_in',
  'warehouse_out',
  'hire_in',
  'hire_return',
  'write_off',
  'adjust',
];

export const KIT_MOVEMENT_LABELS = {
  warehouse_in: 'Send own kit',
  warehouse_out: 'Check in (warehouse)',
  hire_in: 'Hire in',
  hire_return: 'Return hire',
  write_off: 'Write-off',
  adjust: 'Adjust',
};

/** @param {string} source */
export function normalizeKitSource(source) {
  return source === 'hire' ? 'hire' : 'own';
}

/** @param {string} source */
export function isOwnSource(source) {
  return normalizeKitSource(source) === 'own';
}

/**
 * Own line is short when need exceeds warehouse avail.
 * @param {{ source?: string, qty_planned?: number }} item
 * @param {number} avail
 */
export function isOwnShort(item, avail) {
  if (!isOwnSource(item?.source)) return false;
  const need = Number(item?.qty_planned) || 0;
  return need > 0 && need > (Number(avail) || 0);
}

/**
 * Hire-in line is uncovered when need exceeds hired qty already on event.
 * @param {{ source?: string, qty_planned?: number }} item
 * @param {{ hired?: number } | null | undefined} balance
 */
export function isHireUncovered(item, balance) {
  if (isOwnSource(item?.source)) return false;
  const need = Number(item?.qty_planned) || 0;
  const hired = Number(balance?.hired) || 0;
  return need > 0 && need > hired;
}

/**
 * Line needs attention (own short or hire uncovered).
 * @param {{ source?: string, qty_planned?: number }} item
 * @param {number} avail
 * @param {{ hired?: number } | null | undefined} balance
 */
export function isLineShort(item, avail, balance) {
  return isOwnShort(item, avail) || isHireUncovered(item, balance);
}

/**
 * Aggregate planning stats for toolbar / filters.
 * @param {Array<{ source?: string, qty_planned?: number, product_id?: string }>} items
 * @param {Map<string, number>} availMap
 * @param {Map<string, { owned?: number, hired?: number, onHand?: number }>} balanceMap
 */
export function packListStats(items, availMap, balanceMap) {
  let own = 0;
  let hire = 0;
  let short = 0;
  for (const it of items || []) {
    if (isOwnSource(it.source)) own += 1;
    else hire += 1;
    const avail = Number(availMap?.get(it.product_id)) || 0;
    const bal = balanceMap?.get(it.product_id);
    if (isLineShort(it, avail, bal)) short += 1;
  }
  return { lines: (items || []).length, own, hire, short };
}

/** @param {string} movementType */
export function eventQtySign(movementType) {
  switch (movementType) {
    case 'warehouse_in':
    case 'hire_in':
    case 'adjust':
      return 1;
    case 'warehouse_out':
    case 'hire_return':
    case 'write_off':
      return -1;
    default:
      return 0;
  }
}

/** @param {string} movementType */
export function affectsWarehouse(movementType) {
  return movementType === 'warehouse_in' || movementType === 'warehouse_out';
}

/**
 * Warehouse stock delta for one line (positive = increase warehouse on hand).
 * warehouse_in removes from warehouse; warehouse_out adds back.
 */
export function warehouseQtyDelta(movementType, qty) {
  const n = Number(qty) || 0;
  if (movementType === 'warehouse_in') return -n;
  if (movementType === 'warehouse_out') return n;
  return 0;
}

/**
 * Aggregate event on-hand per product from movements (+ nested lines).
 * @param {Array<{ movement_type: string, lines?: Array<{ product_id: string, qty: number }> }>} movements
 * @returns {Map<string, { onHand: number, owned: number, hired: number }>}
 */
export function balancesByProduct(movements) {
  const map = new Map();

  function bump(productId, field, delta) {
    if (!productId || !delta) return;
    let row = map.get(productId);
    if (!row) {
      row = { onHand: 0, owned: 0, hired: 0 };
      map.set(productId, row);
    }
    row[field] += delta;
    row.onHand = row.owned + row.hired;
  }

  for (const m of movements || []) {
    const type = m.movement_type;
    const sign = eventQtySign(type);
    if (!sign) continue;
    for (const line of m.lines || []) {
      const qty = Number(line.qty) || 0;
      if (qty <= 0) continue;
      const delta = sign * qty;
      if (type === 'hire_in' || type === 'hire_return') {
        bump(line.product_id, 'hired', delta);
      } else if (type === 'warehouse_in' || type === 'warehouse_out') {
        bump(line.product_id, 'owned', delta);
      } else if (type === 'write_off' || type === 'adjust') {
        // Prefer reducing/adding owned first for display; still count in onHand.
        bump(line.product_id, 'owned', delta);
      }
    }
  }

  return map;
}

/**
 * Ensure on-hand never goes negative after applying a movement.
 * @returns {{ ok: true } | { ok: false, productId: string, available: number, needed: number }}
 */
export function validateEventStock(balances, movementType, lines) {
  const sign = eventQtySign(movementType);
  if (sign >= 0) return { ok: true };

  const next = new Map();
  for (const [pid, row] of balances || new Map()) {
    next.set(pid, { ...(row || { onHand: 0, owned: 0, hired: 0 }) });
  }

  for (const line of lines || []) {
    const pid = line.product_id;
    const qty = Number(line.qty) || 0;
    if (!pid || qty <= 0) continue;
    const row = next.get(pid) || { onHand: 0, owned: 0, hired: 0 };
    const available = Number(row.onHand) || 0;
    if (qty > available + 1e-9) {
      return { ok: false, productId: pid, available, needed: qty };
    }
  }
  return { ok: true };
}

/**
 * Group kit_container_contents rows by container product id.
 * @param {Array<{ container_product_id: string, child_product_id: string, qty?: number, sort_order?: number, child?: object }>} rows
 * @returns {Map<string, Array<{ child_product_id: string, qty: number, sort_order: number, child?: object }>>}
 */
export function contentsByContainer(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const cid = row.container_product_id;
    if (!cid || !row.child_product_id) continue;
    const list = map.get(cid) || [];
    list.push({
      child_product_id: row.child_product_id,
      qty: Number(row.qty) || 0,
      sort_order: Number(row.sort_order) || 0,
      child: row.child || row.product || null,
    });
    map.set(cid, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      (a.sort_order - b.sort_order)
      || String(a.child?.name || '').localeCompare(String(b.child?.name || '')));
  }
  return map;
}

/**
 * Scale a container's packing list by how many containers are needed.
 * Container still counts as 1 stock unit; this is for display / checklists.
 * @param {Array<{ child_product_id: string, qty?: number, child?: object }>} contents
 * @param {number} containerQty
 */
export function scaledContainerContents(contents, containerQty) {
  const n = Number(containerQty);
  const scale = Number.isFinite(n) && n > 0 ? n : 1;
  return (contents || []).map((c) => ({
    ...c,
    qty: (Number(c.qty) || 0) * scale,
  }));
}
