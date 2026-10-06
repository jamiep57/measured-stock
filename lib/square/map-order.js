/**
 * Pure Square order → till/modifier rows, and which event an order belongs to.
 * No network. London dates match how event start/end dates are stored.
 */

const LONDON = 'Europe/London';

/** @param {string|number|Date|null|undefined} iso */
export function saleDateLondon(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * UTC instant for a clock time in Europe/London.
 * @param {string} ymd YYYY-MM-DD
 * @param {string} time HH:MM:SS
 */
export function londonTimeToUtc(ymd, time) {
  const asUtc = new Date(`${ymd}T${time}Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: LONDON,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(asUtc).map((part) => [part.type, part.value]));
  const asZoned = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(asUtc.getTime() - (asZoned - asUtc.getTime()));
}

/** Inclusive closed_at window for an event's dates. */
export function eventClosedAtRange(startDate, endDate) {
  const start = startDate || endDate;
  const end = endDate || startDate;
  if (!start || !end) return null;
  const startAt = londonTimeToUtc(start, '00:00:00');
  const endAt = londonTimeToUtc(end, '23:59:59');
  if (!startAt || !endAt) return null;
  return { start_at: startAt.toISOString(), end_at: endAt.toISOString() };
}

function moneyAmount(money) {
  if (!money || money.amount == null || money.amount === '') return 0;
  return Number(money.amount) / 100;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function returnedByLine(order) {
  const map = new Map();
  for (const ret of order?.returns || []) {
    for (const line of ret?.return_line_items || []) {
      const uid = line?.source_line_item_uid;
      if (!uid) continue;
      map.set(uid, (map.get(uid) || 0) + (Number(line.quantity) || 0));
    }
  }
  return map;
}

/**
 * One Square order becomes item rows (till shape) and modifier rows.
 * Canceled orders and fully returned lines contribute nothing.
 * A later sync replaces the previous lines for this order.
 *
 * @param {object} order
 * @param {{ locationName?: string|null }} [opts]
 */
export function mapSquareOrder(order, opts = {}) {
  const state = String(order?.state || '');
  const closedAt = order?.closed_at || order?.updated_at || order?.created_at || null;
  const saleDate = saleDateLondon(closedAt);
  const location = opts.locationName || null;
  if (state === 'CANCELED' || state === 'CANCELLED') {
    return { state, closedAt, saleDate, location, lines: [] };
  }

  const returned = returnedByLine(order);
  const lines = [];
  for (const item of order?.line_items || []) {
    const original = Number(item?.quantity) || 0;
    if (!(original > 0) || !item?.uid) continue;
    const remaining = Math.max(0, original - (returned.get(item.uid) || 0));
    if (!(remaining > 0)) continue;
    const scale = remaining / original;
    const gross = moneyAmount(item.gross_sales_money);
    const discount = moneyAmount(item.total_discount_money);
    const name = String(item.name || '').trim();
    if (!name) continue;
    lines.push({
      line_uid: String(item.uid),
      kind: 'item',
      name,
      variation: String(item.variation_name || '').trim() || 'Regular',
      sku: null,
      category: null,
      items_sold: remaining,
      net_sales: roundMoney((gross - discount) * scale),
      gross_sales: roundMoney(gross * scale),
      location,
      sale_date: saleDate,
      modifier_set: null,
      modifier: null,
      qty_sold: 0,
      catalog_object_id: null,
    });

    for (const mod of item.modifiers || []) {
      const stated = mod?.quantity == null || mod.quantity === ''
        ? original
        : Number(mod.quantity);
      const modQty = stated * scale;
      if (!(modQty > 0)) continue;
      const modName = String(mod?.name || '').trim();
      if (!modName) continue;
      const uid = mod?.uid ? String(mod.uid) : modName;
      lines.push({
        line_uid: `${item.uid}:${uid}`,
        kind: 'modifier',
        name: modName,
        variation: null,
        sku: null,
        category: null,
        items_sold: 0,
        net_sales: roundMoney(moneyAmount(mod.total_price_money) * scale),
        gross_sales: roundMoney(moneyAmount(mod.base_price_money) * (Number(mod.quantity) || 0) * scale),
        location,
        sale_date: saleDate,
        modifier_set: '',
        modifier: modName,
        qty_sold: modQty,
        catalog_object_id: mod.catalog_object_id || null,
      });
    }
  }
  return { state, closedAt, saleDate, location, lines };
}

/**
 * @param {{ locationId: string, closedAt: string|null, events: Array<{ id: string, start_date: string|null, end_date: string|null, locationIds?: string[] }> }} input
 * @returns {{ eventId: string|null, reason: null|'no_event'|'overlap' }}
 */
export function assignOrderToEvent({ locationId, closedAt, events }) {
  const day = saleDateLondon(closedAt);
  if (!locationId || !day) return { eventId: null, reason: 'no_event' };
  const hits = (events || []).filter((event) => {
    if (!(event.locationIds || []).includes(locationId)) return false;
    const start = event.start_date;
    const end = event.end_date || event.start_date;
    if (!start || !end) return false;
    return day >= start && day <= end;
  });
  if (hits.length === 1) return { eventId: hits[0].id, reason: null };
  if (hits.length > 1) return { eventId: null, reason: 'overlap' };
  return { eventId: null, reason: 'no_event' };
}
