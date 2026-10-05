/**
 * Shared transfer form helpers — source/dest encoding, labels, warehouse stock.
 */

import { escapeHtml, isBoneYard } from './util.js';
import { getDB, productFromEvent } from '../db.js';
import { parseQty, storedToForm, totalUnitsForProduct } from '../stock-entry.js';

export function parseSourceValue(val) {
  if (!val) return null;
  const i = val.indexOf(':');
  if (i < 0) return null;
  return { type: val.slice(0, i), id: val.slice(i + 1) };
}

export function eventServingBars(event) {
  return (event?.bars || [])
    .filter((b) => !isBoneYard(b))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function barNameById(event, barId) {
  const b = (event?.bars || []).find((x) => x.id === barId);
  return b?.name || 'Bar';
}

export function isBoneYardDest(t, eventId) {
  if (!t || !eventId) return false;
  return t.to_event_id === eventId && !t.to_bar_id && !t.recipient_id && !t.to_warehouse_id;
}

export function transferSourceFromSaved(t) {
  if (!t) return null;
  if (t.from_warehouse_id) return { type: 'warehouse', id: t.from_warehouse_id };
  if (t.from_bar_id) return { type: 'bar', id: t.from_bar_id };
  if (t.from_event_id) {
    if (t.recipient_id || t.to_warehouse_id) return { type: 'site', id: t.from_event_id };
    return { type: 'event', id: t.from_event_id };
  }
  return null;
}

export function transferDestValueFromSaved(t) {
  if (!t) return '';
  if (t.recipient_id) return `recipient:${t.recipient_id}`;
  if (t.to_bar_id) return `bar:${t.to_bar_id}`;
  if (t.to_warehouse_id) return `warehouse:${t.to_warehouse_id}`;
  if (isBoneYardDest(t, t.to_event_id)) return `event:${t.to_event_id}`;
  return '';
}

export function transferSourceLabel(t, event, warehouses) {
  if (t.from_bar_id) return barNameById(event, t.from_bar_id);
  if (t.from_event_id && !t.from_warehouse_id && (t.recipient_id || t.to_warehouse_id)) {
    return `${event?.name || 'Event'} — all locations`;
  }
  if (t.from_event_id) return `Bone Yard — ${event?.name || 'Event'}`;
  if (t.from_warehouse_id) {
    const w = warehouses.find((x) => x.id === t.from_warehouse_id);
    return w?.name || 'Warehouse';
  }
  return '—';
}

export function transferDestLabel(t, event, warehouses) {
  if (t.to_bar_id) return barNameById(event, t.to_bar_id);
  if (isBoneYardDest(t, event?.id)) return `Bone Yard — ${event?.name || 'Event'}`;
  if (t.recipients?.name) return t.recipients.name;
  if (t.recipient_id) {
    const r = (event?.recipients || []).find((x) => x.id === t.recipient_id);
    return r?.name || 'Recipient';
  }
  if (t.to_warehouse_id) {
    const w = warehouses.find((x) => x.id === t.to_warehouse_id);
    return w?.name || 'Warehouse';
  }
  return '—';
}

/** Flat options for searchable source picker. */
export function sourceSelectItems(event, warehouses = []) {
  /** @type {Array<{ value: string, label: string, meta?: string, group?: string }>} */
  const items = [];
  if (event) {
    const group = event.name || 'Event';
    items.push({
      value: `site:${event.id}`,
      label: 'Whole event (all locations)',
      group,
      meta: 'All locations',
    });
    items.push({
      value: `event:${event.id}`,
      label: 'Bone Yard (goods in)',
      group,
      meta: 'Bone Yard',
    });
    eventServingBars(event).forEach((b) => {
      items.push({
        value: `bar:${b.id}`,
        label: b.name || 'Bar',
        group,
        meta: 'Bar',
      });
    });
  }
  (warehouses || []).forEach((w) => {
    items.push({
      value: `warehouse:${w.id}`,
      label: w.name || 'Warehouse',
      group: 'Warehouses',
      meta: 'Warehouse',
    });
  });
  return items;
}

/** Flat options for searchable destination picker. */
export function destSelectItems(event, warehouses = [], xferSource = null) {
  /** @type {Array<{ value: string, label: string, meta?: string, group?: string }>} */
  const items = [];
  const recips = event?.recipients || [];
  recips.forEach((r) => {
    items.push({
      value: `recipient:${r.id}`,
      label: r.name || 'Recipient',
      group: 'Recipients',
      meta: 'Recipient',
    });
  });

  const srcIsBone = xferSource?.type === 'event';
  const srcIsSite = xferSource?.type === 'site';
  const srcBarId = xferSource?.type === 'bar' ? xferSource.id : null;
  const internalGroup = `Within ${event?.name || 'event'}`;
  if (!srcIsSite) {
    if (event && !srcIsBone) {
      items.push({
        value: `event:${event.id}`,
        label: 'Bone Yard (goods in)',
        group: internalGroup,
        meta: 'Bone Yard',
      });
    }
    eventServingBars(event).forEach((b) => {
      if (b.id === srcBarId) return;
      items.push({
        value: `bar:${b.id}`,
        label: b.name || 'Bar',
        group: internalGroup,
        meta: 'Bar',
      });
    });
  }

  const srcWhId = xferSource?.type === 'warehouse' ? xferSource.id : null;
  ;(warehouses || [])
    .filter((w) => w.id !== srcWhId)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach((w) => {
      items.push({
        value: `warehouse:${w.id}`,
        label: w.name || 'Warehouse',
        group: 'Warehouses',
        meta: 'Warehouse',
      });
    });

  return items;
}

export function sourceSelectOptions(event, warehouses, current) {
  const items = sourceSelectItems(event, warehouses);
  const eventName = event?.name || 'Event';
  const bars = eventServingBars(event);
  const eventGroup = event
    ? `<optgroup label="${escapeHtml(eventName)}">` +
      `<option value="site:${event.id}">Whole event (all locations)</option>` +
      `<option value="event:${event.id}">Bone Yard (goods in)</option>` +
      bars.map((b) => `<option value="bar:${b.id}">${escapeHtml(b.name)}</option>`).join('') +
      '</optgroup>'
    : '';
  const whGroup = warehouses.length
    ? `<optgroup label="Warehouses">${warehouses.map((w) =>
      `<option value="warehouse:${w.id}">${escapeHtml(w.name)}</option>`).join('')}</optgroup>`
    : '';
  const cur = current ? `${current.type}:${current.id}` : '';
  return {
    html: '<option value="">— Select source —</option>' + eventGroup + whGroup,
    value: cur,
    items,
  };
}

export function destSelectOptions(event, warehouses, xferSource) {
  const items = destSelectItems(event, warehouses, xferSource);
  const recips = event?.recipients || [];
  const recipGroup = recips.length
    ? `<optgroup label="Recipients">${recips.map((r) =>
      `<option value="recipient:${r.id}">${escapeHtml(r.name)}</option>`).join('')}</optgroup>`
    : '';

  const srcIsBone = xferSource?.type === 'event';
  const srcIsSite = xferSource?.type === 'site';
  const srcBarId = xferSource?.type === 'bar' ? xferSource.id : null;
  const internalOpts = [];
  if (!srcIsSite) {
    if (event && !srcIsBone) {
      internalOpts.push(`<option value="event:${event.id}">Bone Yard (goods in)</option>`);
    }
    eventServingBars(event).forEach((b) => {
      if (b.id === srcBarId) return;
      internalOpts.push(`<option value="bar:${b.id}">${escapeHtml(b.name)}</option>`);
    });
  }
  const internalGroup = internalOpts.length
    ? `<optgroup label="Within ${escapeHtml(event?.name || 'event')}">${internalOpts.join('')}</optgroup>`
    : '';

  const srcWhId = xferSource?.type === 'warehouse' ? xferSource.id : null;
  const whOpts = warehouses
    .filter((w) => w.id !== srcWhId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map((w) => `<option value="warehouse:${w.id}">${escapeHtml(w.name)}</option>`)
    .join('');
  const whGroup = whOpts ? `<optgroup label="Warehouses">${whOpts}</optgroup>` : '';

  return '<option value="">— Select destination —</option>' + recipGroup + internalGroup + whGroup;
}

export function buildTransferPayload({ eventId, xferSource, dest, transferredAt }) {
  const isWarehouseSource = xferSource.type === 'warehouse';
  const isBarSource = xferSource.type === 'bar';
  const destIsRecipient = dest.type === 'recipient';
  const destIsBar = dest.type === 'bar';
  const destIsWarehouse = dest.type === 'warehouse';

  let transferType;
  if (destIsRecipient) transferType = isWarehouseSource ? 'warehouse_to_recipient' : 'event_to_recipient';
  else if (destIsWarehouse) transferType = isWarehouseSource ? 'warehouse_to_warehouse' : 'event_to_warehouse';
  else transferType = isWarehouseSource ? 'warehouse_to_event' : 'event_to_event';

  return {
    transfer_type: transferType,
    from_event_id: isWarehouseSource ? null : eventId,
    from_warehouse_id: isWarehouseSource ? xferSource.id : null,
    from_bar_id: isBarSource ? xferSource.id : null,
    to_event_id: (destIsBar || dest.type === 'event') ? eventId : null,
    to_bar_id: destIsBar ? dest.id : null,
    to_warehouse_id: destIsWarehouse ? dest.id : null,
    recipient_id: destIsRecipient ? dest.id : null,
    unit: 'cases',
    transferred_at: transferredAt,
  };
}

export function lineCasesFromForm(line, event, caseSizes) {
  const p = productFromEvent(event, line.productId);
  return totalUnitsForProduct(parseQty(line.cases), parseQty(line.singles), p, caseSizes);
}

export function lineCasesFromDb(line, event, caseSizes) {
  const p = productFromEvent(event, line.product_id);
  const form = storedToForm(line);
  return totalUnitsForProduct(parseQty(form.cases), parseQty(form.singles), p, caseSizes);
}

export async function adjustWarehouseStock(warehouseId, productId, delta) {
  const DB = getDB();
  const rows = await DB.select(
    'warehouse_stock',
    '?warehouse_id=eq.' + DB._.enc(warehouseId) +
    '&product_id=eq.' + DB._.enc(productId) +
    '&select=qty_on_hand',
  );
  const current = rows?.[0] ? Number(rows[0].qty_on_hand) || 0 : 0;
  const next = Math.round((current + delta) * 10) / 10;
  if (next < 0) throw new Error('Insufficient warehouse stock');
  await DB.warehouseStock.setQty(warehouseId, productId, next);
}

export async function loadWarehousesList() {
  try {
    return await getDB().warehouses.list();
  } catch {
    return [];
  }
}
