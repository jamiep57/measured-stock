/**
 * Purchase orders data access (migration 069). Orders are a ledger of
 * what was asked of suppliers — they never write event stock quantities.
 */

import { getDB } from '../db.js';

const enc = (v) => encodeURIComponent(v);

export function isOrdersSchemaMissing(err) {
  const msg = String(err?.message || err || '');
  return /PGRST205|42P01|42703|does not exist|Could not find the table|schema cache/i.test(msg)
    && /purchase_order|order_buffer_pct/i.test(msg);
}

function cleanPatch(patch) {
  const out = {};
  Object.entries(patch || {}).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v === '' ? null : v;
  });
  return out;
}

const PO_SELECT = '*,purchase_order_lines(id,product_id,qty_cases,case_price,notes)';

export function listPurchaseOrders(eventId) {
  return getDB().select(
    'purchase_orders',
    `?event_id=eq.${enc(eventId)}&select=${PO_SELECT}&order=created_at.asc`,
  );
}

export async function getPurchaseOrder(id) {
  const rows = await getDB().select('purchase_orders', `?id=eq.${enc(id)}&select=${PO_SELECT}`);
  return rows?.[0] || null;
}

export async function createPurchaseOrder(fields) {
  const rows = await getDB().insert('purchase_orders', cleanPatch(fields));
  return rows?.[0] || null;
}

export async function updatePurchaseOrder(id, patch) {
  const rows = await getDB().update('purchase_orders', `id=eq.${enc(id)}`, cleanPatch(patch));
  return rows?.[0] || null;
}

export function deletePurchaseOrder(id) {
  return getDB().remove('purchase_orders', `id=eq.${enc(id)}`);
}

export function confirmPurchaseOrder(id, supplierRef) {
  return getDB().rpc('confirm_purchase_order', { p_po: id, p_supplier_ref: supplierRef || null });
}

/**
 * Replace a draft/sent order's lines with `lines` (product_id, qty_cases,
 * case_price, notes). Rows not in the list are deleted.
 */
export async function savePurchaseOrderLines(poId, lines, existing = []) {
  const DB = getDB();
  const keep = new Set(lines.map((l) => l.product_id));
  const removed = existing.filter((l) => !keep.has(l.product_id));
  for (const l of removed) {
    await DB.remove('purchase_order_lines', `id=eq.${enc(l.id)}`);
  }
  if (!lines.length) return [];
  return DB.upsert(
    'purchase_order_lines',
    lines.map((l) => cleanPatch({
      po_id: poId,
      product_id: l.product_id,
      qty_cases: l.qty_cases,
      case_price: l.case_price,
      notes: l.notes,
    })),
    { onConflict: 'po_id,product_id' },
  );
}

export async function loadOrderBuffer(eventId) {
  const rows = await getDB().select('events', `?id=eq.${enc(eventId)}&select=order_buffer_pct`);
  return Number(rows?.[0]?.order_buffer_pct) || 0;
}

export function saveOrderBuffer(eventId, pct) {
  return getDB().update('events', `id=eq.${enc(eventId)}`, { order_buffer_pct: pct });
}

/** Audit trail rows for one order (header + lines). */
export function orderHistory(poId) {
  return getDB().select(
    'audit_log',
    `?or=(and(table_name.eq.purchase_orders,row_id.eq.${enc(poId)}),and(table_name.eq.purchase_order_lines,new_data->>po_id.eq.${enc(poId)}),and(table_name.eq.purchase_order_lines,old_data->>po_id.eq.${enc(poId)}))`
      + '&select=id,op,table_name,at,actor_email,changed_cols,old_data,new_data&order=at.desc&limit=100',
  );
}
