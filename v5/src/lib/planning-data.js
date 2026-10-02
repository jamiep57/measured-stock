/**
 * Planning data access — price years, house / event menus, scenarios.
 * Tables from migration 068; all admin-only under RLS.
 */

import { getDB } from '../db.js';

const enc = (v) => encodeURIComponent(v);

/** True when the planning tables are not deployed yet (068 not applied). */
export function isPlanningSchemaMissing(err) {
  const msg = String(err?.message || err || '');
  return /PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(msg)
    && /price_years|house_menu_prices|event_menu_items|pricing_scenarios|scenario_prices|price_year_id|target_gp_pct/i.test(msg);
}

function cleanPatch(patch) {
  const out = {};
  Object.entries(patch || {}).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v === '' ? null : v;
  });
  return out;
}

// ---------- price years ----------------------------------------------

export function listPriceYears() {
  return getDB().select('price_years', '?select=*&order=label.desc');
}

export async function createPriceYear(fields) {
  const rows = await getDB().insert('price_years', cleanPatch(fields));
  return rows?.[0] || null;
}

export async function updatePriceYear(id, patch) {
  const rows = await getDB().update('price_years', 'id=eq.' + enc(id), cleanPatch(patch));
  return rows?.[0] || null;
}

export function deletePriceYear(id) {
  return getDB().remove('price_years', 'id=eq.' + enc(id));
}

export function rollPriceYear(fromId, label, upliftPct, roundTo) {
  return getDB().rpc('roll_price_year', {
    p_from: fromId,
    p_label: label,
    p_uplift_pct: upliftPct ?? 0,
    p_round_to: roundTo ?? 0.05,
  });
}

// ---------- house menu -----------------------------------------------

export function listHousePrices(yearId) {
  if (!yearId) return Promise.resolve([]);
  return getDB().select('house_menu_prices', '?price_year_id=eq.' + enc(yearId) + '&select=*');
}

export async function upsertHousePrice(yearId, productId, patch) {
  const rows = await getDB().upsert(
    'house_menu_prices',
    { price_year_id: yearId, product_id: productId, ...cleanPatch(patch) },
    { onConflict: 'price_year_id,product_id' },
  );
  return rows?.[0] || null;
}

export function removeHousePrice(yearId, productId) {
  return getDB().remove(
    'house_menu_prices',
    'price_year_id=eq.' + enc(yearId) + '&product_id=eq.' + enc(productId),
  );
}

// ---------- event pricing context ------------------------------------

export async function loadEventPricing(eventId) {
  const rows = await getDB().select(
    'events',
    '?id=eq.' + enc(eventId) + '&select=id,name,status,start_date,end_date,venue,price_year_id,target_gp_pct,gp_amber_band',
  );
  return rows?.[0] || null;
}

export async function updateEventPricing(eventId, patch) {
  const rows = await getDB().update('events', 'id=eq.' + enc(eventId), cleanPatch(patch));
  return rows?.[0] || null;
}

export function isEventPricingLocked(event) {
  return event?.status === 'reconciled' || event?.status === 'archived';
}

// ---------- event menu -----------------------------------------------

export function listEventMenu(eventId) {
  return getDB().select('event_menu_items', '?event_id=eq.' + enc(eventId) + '&select=*');
}

export async function upsertEventMenuItem(eventId, productId, patch) {
  const rows = await getDB().upsert(
    'event_menu_items',
    { event_id: eventId, product_id: productId, ...cleanPatch(patch) },
    { onConflict: 'event_id,product_id' },
  );
  return rows?.[0] || null;
}

export function seedEventMenu(eventId, refreshPrices = false) {
  return getDB().rpc('seed_event_menu', { p_event: eventId, p_refresh_prices: !!refreshPrices });
}

export function snapshotEventCosts(eventId) {
  return getDB().rpc('snapshot_event_menu_costs', { p_event: eventId });
}

export function clearEventCostSnapshots(eventId) {
  return getDB().rpc('clear_event_menu_cost_snapshots', { p_event: eventId });
}

// ---------- scenarios ------------------------------------------------

export function listScenarios(eventId) {
  return getDB().select(
    'pricing_scenarios',
    '?event_id=eq.' + enc(eventId) + '&select=*,scenario_prices(id,product_id,price)&order=sort_order.asc.nullslast,created_at.asc',
  );
}

export async function createScenario(eventId, fields) {
  const rows = await getDB().insert('pricing_scenarios', { event_id: eventId, ...cleanPatch(fields) });
  return rows?.[0] || null;
}

export async function updateScenario(id, patch) {
  const rows = await getDB().update('pricing_scenarios', 'id=eq.' + enc(id), cleanPatch(patch));
  return rows?.[0] || null;
}

export function deleteScenario(id) {
  return getDB().remove('pricing_scenarios', 'id=eq.' + enc(id));
}

/** Set (or clear with null) one product's price in a scenario. */
export async function setScenarioPrice(scenarioId, productId, price) {
  if (price == null) {
    await getDB().remove(
      'scenario_prices',
      'scenario_id=eq.' + enc(scenarioId) + '&product_id=eq.' + enc(productId),
    );
    return null;
  }
  const rows = await getDB().upsert(
    'scenario_prices',
    { scenario_id: scenarioId, product_id: productId, price },
    { onConflict: 'scenario_id,product_id' },
  );
  return rows?.[0] || null;
}

/** Copy every menu price (or house price) into a scenario with a % change. */
export function scenarioPricesFrom(lines, upliftPct, roundTo, roundFn) {
  const mult = 1 + (Number(upliftPct) || 0) / 100;
  return lines
    .filter((l) => l.menuPrice != null)
    .map((l) => ({ product_id: l.productId, price: roundFn(l.menuPrice * mult, roundTo) }));
}

export async function replaceScenarioPrices(scenarioId, rows) {
  if (!rows.length) return [];
  return getDB().upsert(
    'scenario_prices',
    rows.map((r) => ({ scenario_id: scenarioId, product_id: r.product_id, price: r.price })),
    { onConflict: 'scenario_id,product_id' },
  );
}
