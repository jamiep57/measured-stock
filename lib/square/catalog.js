/**
 * Square catalogue push for one event: load the app menu, read the Square catalogue,
 * plan the changes, and (when applying) upsert them and remember the Square IDs.
 */

import sb from '../supabase-admin.js';
import { squareFetch } from './client.js';
import { getConnection, usableAccessToken } from './connection.js';
import { buildDesiredCatalog, diffCatalog } from './catalog-plan.js';

const enc = (value) => encodeURIComponent(String(value));

async function getIn(table, column, ids, select) {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100).map(enc).join(',');
    out.push(...await sb.get(table, `?${column}=in.(${chunk})&select=${select}`));
  }
  return out;
}

export async function listCatalog(environment, token) {
  const objects = [];
  let cursor = '';
  for (let page = 0; page < 200; page += 1) {
    const qs = new URLSearchParams({ types: 'ITEM,CATEGORY' });
    if (cursor) qs.set('cursor', cursor);
    const json = await squareFetch(environment, token, `/v2/catalog/list?${qs}`);
    objects.push(...(json.objects || []));
    cursor = json.cursor || '';
    if (!cursor) break;
  }
  return objects;
}

export async function listLocationsRaw(environment, token) {
  const json = await squareFetch(environment, token, '/v2/locations');
  return json.locations || [];
}

export async function batchUpsert(environment, token, objects) {
  const idMap = new Map();
  for (let i = 0; i < objects.length; i += 100) {
    const json = await squareFetch(environment, token, '/v2/catalog/batch-upsert', {
      method: 'POST',
      body: {
        idempotency_key: crypto.randomUUID(),
        batches: [{ objects: objects.slice(i, i + 100) }],
      },
    });
    for (const m of json.id_mappings || []) idMap.set(m.client_object_id, m.object_id);
  }
  return idMap;
}

export function swapCategoryIds(obj, idMap) {
  const data = obj.item_data;
  if (!data) return obj;
  const swap = (ref) => (ref?.id && idMap.has(ref.id) ? { ...ref, id: idMap.get(ref.id) } : ref);
  return {
    ...obj,
    item_data: {
      ...data,
      ...(data.categories ? { categories: data.categories.map(swap) } : {}),
      ...(data.reporting_category ? { reporting_category: swap(data.reporting_category) } : {}),
    },
  };
}

async function loadEventInput(orgId, eventId) {
  const [events, menuItems, cocktails, distribution, barProducts, bars, barLinks, categories] = await Promise.all([
    sb.get('events', `?id=eq.${enc(eventId)}&org_id=eq.${enc(orgId)}&select=id,name,status`),
    sb.get('event_menu_items', `?event_id=eq.${enc(eventId)}&select=product_id,included,serve_label,menu_price,sort_order&order=sort_order.asc.nullslast`),
    sb.get('event_cocktails', `?event_id=eq.${enc(eventId)}&select=id,name,included,serve_label,menu_price,square_item_name,square_variation,sort_order&order=sort_order.asc.nullslast`),
    sb.get('distribution', `?event_id=eq.${enc(eventId)}&select=bar_id,product_id,qty_allocated`),
    sb.get('bar_products', `?event_id=eq.${enc(eventId)}&select=bar_id,product_id`),
    sb.get('bars', `?event_id=eq.${enc(eventId)}&select=id,name`),
    sb.get('event_bar_square_locations', `?event_id=eq.${enc(eventId)}&select=bar_id,square_location_id,square_location_name`),
    sb.get('categories', `?org_id=eq.${enc(orgId)}&select=id,name`),
  ]);
  if (!events[0]) {
    const err = new Error('Event not found');
    err.code = 'not_found';
    throw err;
  }
  const [products, ingredients] = await Promise.all([
    getIn('products', 'id', menuItems.map((m) => m.product_id), 'id,name,menu_name,category_id,case_size,stock_unit'),
    getIn('event_cocktail_ingredients', 'cocktail_id', cocktails.map((c) => c.id), 'cocktail_id,product_id'),
  ]);
  return { event: events[0], menuItems, cocktails, distribution, barProducts, bars, barLinks, categories, products, ingredients };
}

/**
 * @param {string} orgId
 * @param {string} eventId
 * @param {{ apply?: boolean }} [opts]
 */
export async function planEventCatalog(orgId, eventId, opts = {}) {
  const connection = await getConnection(orgId);
  if (!connection) {
    const err = new Error('Square is not connected');
    err.code = 'not_connected';
    throw err;
  }
  const canWrite = String(connection.scopes || '').split(/\s+/).includes('ITEMS_WRITE');
  if (opts.apply && !canWrite) {
    const err = new Error('Reconnect Square in Settings to allow menu sync');
    err.code = 'needs_reconnect';
    throw err;
  }

  const input = await loadEventInput(orgId, eventId);
  if (!input.barLinks.length) {
    const err = new Error('Link this event’s bars to Square locations on the sales page first');
    err.code = 'no_links';
    throw err;
  }
  const env = connection.environment;
  const token = await usableAccessToken(connection);
  const [objects, locations, map] = await Promise.all([
    listCatalog(env, token),
    listLocationsRaw(env, token),
    sb.get('square_catalog_map', `?org_id=eq.${enc(orgId)}&environment=eq.${enc(env)}&select=kind,app_key,square_id`),
  ]);

  const desired = buildDesiredCatalog(input);
  const linkedLocationIds = input.barLinks.map((l) => l.square_location_id);
  const currency = locations.find((l) => linkedLocationIds.includes(l.id))?.currency || locations[0]?.currency || 'GBP';
  const plan = diffCatalog({
    desired: desired.items,
    objects,
    map,
    linkedLocationIds,
    allLocationIds: locations.map((l) => l.id),
    currency,
  });

  const barName = new Map(input.bars.map((b) => [b.id, b.name]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const preview = {
    event: input.event.name,
    currency,
    canWrite,
    lastPushAt: connection.last_catalog_push_at || null,
    warnings: [...desired.warnings, ...plan.warnings],
    itemCount: desired.items.length,
    changes: plan.upserts.length,
    summary: {
      ...plan.summary,
      locations: input.barLinks.map((link) => ({
        bar: barName.get(link.bar_id) || 'Bar',
        location: locationName.get(link.square_location_id) || link.square_location_name || link.square_location_id,
        add: plan.summary.locations[link.square_location_id]?.add || [],
        remove: plan.summary.locations[link.square_location_id]?.remove || [],
      })),
    },
  };
  if (!opts.apply) return preview;

  const categories = plan.upserts.filter((o) => o.type === 'CATEGORY');
  const idMap = categories.length ? await batchUpsert(env, token, categories) : new Map();
  const items = plan.upserts.filter((o) => o.type !== 'CATEGORY').map((o) => swapCategoryIds(o, idMap));
  if (items.length) {
    for (const [k, v] of await batchUpsert(env, token, items)) idMap.set(k, v);
  }

  const resolve = (id) => (id && id.startsWith('#') ? idMap.get(id) || null : id);
  const rows = plan.mapRows
    .map((r) => ({
      org_id: orgId,
      environment: env,
      kind: r.kind,
      app_key: r.app_key,
      square_id: resolve(r.square_id),
      square_item_id: resolve(r.square_item_id),
    }))
    .filter((r) => r.square_id);
  const unique = [...new Map(rows.map((r) => [`${r.kind}:${r.app_key}`, r])).values()];
  for (let i = 0; i < unique.length; i += 500) {
    await sb.upsert('square_catalog_map', unique.slice(i, i + 500), { onConflict: 'org_id,environment,kind,app_key' });
  }
  const pushedAt = new Date().toISOString();
  await sb.update('org_square_connections', `org_id=eq.${enc(orgId)}`, {
    last_catalog_push_at: pushedAt,
    updated_at: pushedAt,
  });
  return { ...preview, applied: true, lastPushAt: pushedAt };
}
