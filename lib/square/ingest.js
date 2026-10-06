import sb from '../supabase-admin.js';
import { listLocations, modifierSetNames, retrieveOrder, searchOrders } from './client.js';
import { getConnection, markConnectionError, touchConnection, usableAccessToken } from './connection.js';
import { assignOrderToEvent, eventClosedAtRange, mapSquareOrder } from './map-order.js';

function enc(value) {
  return encodeURIComponent(String(value));
}

export async function loadAssignmentContext(orgId) {
  const [events, links] = await Promise.all([
    sb.get('events', `?org_id=eq.${enc(orgId)}&select=id,start_date,end_date,status,org_id`),
    sb.get('event_bar_square_locations', `?org_id=eq.${enc(orgId)}&select=event_id,square_location_id,square_location_name`),
  ]);
  const byId = new Map(events.map((event) => [event.id, { ...event, locationIds: [] }]));
  const locationNames = new Map();
  for (const link of links) {
    const event = byId.get(link.event_id);
    if (event && link.square_location_id && !event.locationIds.includes(link.square_location_id)) {
      event.locationIds.push(link.square_location_id);
    }
    if (link.square_location_name) locationNames.set(link.square_location_id, link.square_location_name);
  }
  return { events: [...byId.values()], locationNames };
}

async function applyModifierSets(environment, token, orders) {
  const ids = [];
  for (const order of orders) {
    for (const item of order?.line_items || []) {
      for (const mod of item?.modifiers || []) {
        if (mod?.catalog_object_id) ids.push(mod.catalog_object_id);
      }
    }
  }
  if (!ids.length) return new Map();
  try {
    return await modifierSetNames(environment, token, ids);
  } catch (err) {
    console.error('[square] modifier list names', err?.message || err);
    return new Map();
  }
}

function persistableLines(mapped, setNames, eventId) {
  return mapped.lines
    .map((line) => {
      const modifierSet = line.kind === 'modifier'
        ? (setNames.get(line.catalog_object_id) || line.modifier_set || '')
        : null;
      return {
        event_id: eventId,
        line_uid: line.line_uid,
        kind: line.kind,
        name: line.name,
        variation: line.variation,
        sku: line.sku,
        category: line.category,
        items_sold: line.items_sold,
        net_sales: line.net_sales,
        gross_sales: line.gross_sales,
        location: line.location,
        sale_date: line.sale_date,
        modifier_set: modifierSet || null,
        modifier: line.modifier,
        qty_sold: line.qty_sold,
      };
    })
    .filter((line) => (line.kind === 'item' ? line.items_sold > 0 : line.qty_sold > 0));
}

/**
 * Replace this order's stored lines. The same Square order id never inserts twice.
 */
export async function upsertMappedOrder({ orgId, order, events, locationName, setNames }) {
  const mapped = mapSquareOrder(order, { locationName });
  const assignment = assignOrderToEvent({
    locationId: order.location_id,
    closedAt: mapped.closedAt,
    events,
  });
  const saved = await sb.upsert('square_orders', [{
    org_id: orgId,
    event_id: assignment.eventId,
    square_order_id: order.id,
    square_location_id: order.location_id,
    location_name: locationName || null,
    state: mapped.state || order.state || 'UNKNOWN',
    closed_at: mapped.closedAt,
    currency: order.total_money?.currency || order.line_items?.[0]?.gross_sales_money?.currency || null,
    unmatched_reason: assignment.reason,
  }], { onConflict: 'org_id,square_order_id' });
  const row = saved[0];
  if (!row?.id) throw new Error(`Square order ${order.id} did not save`);

  const lines = assignment.eventId
    ? persistableLines(mapped, setNames, assignment.eventId).map((line) => ({
      ...line,
      org_id: orgId,
      order_id: row.id,
    }))
    : [];
  const keep = new Set(lines.map((line) => line.line_uid));
  if (lines.length) {
    await sb.upsert('square_order_lines', lines, { onConflict: 'order_id,line_uid' });
  }
  const existing = await sb.get('square_order_lines', `?order_id=eq.${enc(row.id)}&select=id,line_uid`);
  const stale = existing.filter((line) => !keep.has(line.line_uid)).map((line) => line.id);
  if (stale.length) {
    await sb.delete('square_order_lines', `id=in.(${stale.map(enc).join(',')})`);
  }
  return {
    orderId: order.id,
    eventId: assignment.eventId,
    reason: assignment.reason,
    lines: lines.length,
  };
}

async function locationNameMap(environment, token, fallback) {
  const names = new Map(fallback || []);
  try {
    const locations = await listLocations(environment, token);
    for (const location of locations) names.set(location.id, location.name);
  } catch (err) {
    console.error('[square] locations', err?.message || err);
  }
  return names;
}

export async function ingestOrders(connection, orders) {
  if (!orders.length) return { orders: 0, lines: 0, unmatched: 0 };
  const token = await usableAccessToken(connection);
  const { events, locationNames } = await loadAssignmentContext(connection.org_id);
  const names = await locationNameMap(connection.environment, token, locationNames);
  const setNames = await applyModifierSets(connection.environment, token, orders);
  let lines = 0;
  let unmatched = 0;
  for (const order of orders) {
    if (!order?.id || !order?.location_id) continue;
    if (order.state !== 'COMPLETED' && order.state !== 'CANCELED') continue;
    const result = await upsertMappedOrder({
      orgId: connection.org_id,
      order,
      events,
      locationName: names.get(order.location_id) || null,
      setNames,
    });
    lines += result.lines;
    if (result.reason) unmatched += 1;
  }
  return { orders: orders.length, lines, unmatched };
}

export async function ingestOrderId(connection, orderId) {
  const token = await usableAccessToken(connection);
  const order = await retrieveOrder(connection.environment, token, orderId);
  if (!order) return { orders: 0, lines: 0, unmatched: 0 };
  if (order.state !== 'COMPLETED' && order.state !== 'CANCELED') {
    const existing = await sb.get(
      'square_orders',
      `?org_id=eq.${enc(connection.org_id)}&square_order_id=eq.${enc(order.id)}&select=id`,
    );
    if (existing[0]?.id) await sb.delete('square_orders', `id=eq.${enc(existing[0].id)}`);
    return { orders: 0, lines: 0, unmatched: 0, ignored: order.state };
  }
  return ingestOrders(connection, [order]);
}

/**
 * Pull orders for one event's mapped locations and dates.
 * Assignment still considers every event, so an overlapping show is left unmatched.
 */
export async function syncEventOrders(orgId, eventId) {
  const connection = await getConnection(orgId);
  if (!connection) {
    const error = new Error('Square is not connected');
    error.code = 'not_connected';
    throw error;
  }
  const eventRows = await sb.get(
    'events',
    `?id=eq.${enc(eventId)}&org_id=eq.${enc(orgId)}&select=id,start_date,end_date,status`,
  );
  const event = eventRows[0];
  if (!event) {
    const error = new Error('Event not found');
    error.code = 'not_found';
    throw error;
  }
  const range = eventClosedAtRange(event.start_date, event.end_date);
  const links = await sb.get(
    'event_bar_square_locations',
    `?event_id=eq.${enc(eventId)}&select=square_location_id`,
  );
  const locationIds = [...new Set(links.map((link) => link.square_location_id).filter(Boolean))];
  if (!range || !locationIds.length) {
    return { orders: 0, lines: 0, unmatched: 0, skipped: !range ? 'no_dates' : 'no_locations' };
  }
  try {
    const token = await usableAccessToken(connection);
    const orders = await searchOrders(connection.environment, token, {
      locationIds,
      startAt: range.start_at,
      endAt: range.end_at,
    });
    const result = await ingestOrders(connection, orders);
    await touchConnection(orgId, { last_sync_at: new Date().toISOString(), last_error: null });
    return result;
  } catch (err) {
    await markConnectionError(orgId, err);
    throw err;
  }
}

/** Backfill every active event that has dates and at least one linked location. */
export async function syncActiveEvents(connection) {
  const { events } = await loadAssignmentContext(connection.org_id);
  const active = events.filter((event) => event.status === 'active' && event.locationIds?.length);
  const ranges = active
    .map((event) => eventClosedAtRange(event.start_date, event.end_date))
    .filter(Boolean);
  if (!ranges.length) return { orders: 0, lines: 0, unmatched: 0, events: 0 };
  const startAt = ranges.map((range) => range.start_at).sort()[0];
  const endAt = ranges.map((range) => range.end_at).sort().at(-1);
  const locationIds = [...new Set(active.flatMap((event) => event.locationIds))];
  const token = await usableAccessToken(connection);
  const orders = await searchOrders(connection.environment, token, { locationIds, startAt, endAt });
  const result = await ingestOrders(connection, orders);
  await touchConnection(connection.org_id, { last_sync_at: new Date().toISOString(), last_error: null });
  return { ...result, events: active.length };
}
