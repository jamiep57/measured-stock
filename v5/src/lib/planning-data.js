/**
 * Planning data access — price years, event menus, saved menus, scenarios.
 * Tables from migrations 068 and 076; all admin-only under RLS.
 */

import { getDB } from '../db.js';

const enc = (v) => encodeURIComponent(v);

/** True when the planning tables are not deployed yet (068 not applied). */
export function isPlanningSchemaMissing(err) {
  const msg = String(err?.message || err || '');
  return /PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(msg)
    && /price_years|house_menu_prices|event_menu_items|pricing_scenarios|scenario_prices|saved_menus|saved_menu_items|event_cocktails|price_year_id|target_gp_pct/i.test(msg);
}

/** True when the cocktail tables are not deployed yet (077 not applied). */
export function isCocktailSchemaMissing(err) {
  const msg = String(err?.message || err || '');
  return /PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(msg)
    && /event_cocktails|event_cocktail_ingredients|saved_menu_cocktails/i.test(msg);
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

// ---------- saved menus ----------------------------------------------

export function listSavedMenus() {
  return getDB().select(
    'saved_menus',
    '?select=id,name,updated_at,saved_menu_items(product_id)&order=name.asc',
  );
}

export function savedMenuProductCount(menu) {
  return Array.isArray(menu?.saved_menu_items) ? menu.saved_menu_items.length : 0;
}

/** Save the products currently on an event menu. Rejects a name clash unless replace is set. */
export function saveEventMenu(eventId, name, replace = false) {
  return getDB().rpc('save_event_menu', {
    p_event: eventId,
    p_name: name,
    p_replace: !!replace,
  });
}

/** Copy a saved menu onto an event. Returns how many products were newly added. */
export function applySavedMenu(eventId, menuId, refreshPrices = false) {
  return getDB().rpc('apply_saved_menu', {
    p_event: eventId,
    p_menu: menuId,
    p_refresh_prices: !!refreshPrices,
  });
}

export function deleteSavedMenu(menuId) {
  return getDB().remove('saved_menus', 'id=eq.' + enc(menuId));
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
    .filter((l) => l.kind !== 'cocktail' && l.productId && l.menuPrice != null)
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

// ---------- cocktails ------------------------------------------------

export function normaliseCocktail(row) {
  const ingredients = (row?.event_cocktail_ingredients || row?.ingredients || [])
    .map((ing) => ({
      id: ing.id || null,
      product_id: ing.product_id,
      measures: Number(ing.measures),
      position: Number(ing.position) || 0,
    }))
    .filter((ing) => ing.product_id)
    .sort((a, b) => a.position - b.position || String(a.product_id).localeCompare(String(b.product_id)));
  return { ...row, ingredients };
}

export async function listEventCocktails(eventId) {
  const rows = await getDB().select(
    'event_cocktails',
    '?event_id=eq.' + enc(eventId) + '&select=*,event_cocktail_ingredients(id,product_id,measures,position)&order=name.asc',
  );
  return (rows || []).map(normaliseCocktail);
}

/** Cocktails plus menu serves, for Square matching on this event. Schema-missing → empty. */
export async function loadEventCocktailMapping(eventId) {
  const [cocktails, menuItems] = await Promise.all([
    listEventCocktails(eventId).catch((err) => (isCocktailSchemaMissing(err) ? [] : Promise.reject(err))),
    listEventMenu(eventId).catch(() => []),
  ]);
  return { cocktails: cocktails || [], menuItems: menuItems || [] };
}

export async function createEventCocktail(eventId, fields, ingredients) {
  const rows = await getDB().insert('event_cocktails', {
    event_id: eventId,
    included: true,
    ...cleanPatch(fields),
  });
  const cocktail = rows?.[0];
  if (!cocktail) throw new Error('Could not create cocktail');
  let saved;
  try {
    saved = await replaceCocktailIngredients(cocktail.id, ingredients);
  } catch (err) {
    await deleteEventCocktail(cocktail.id).catch(() => {});
    throw err;
  }
  return normaliseCocktail({ ...cocktail, ingredients: saved });
}

export async function updateEventCocktail(id, patch) {
  const rows = await getDB().update('event_cocktails', 'id=eq.' + enc(id), cleanPatch(patch));
  return rows?.[0] || null;
}

export async function replaceCocktailIngredients(cocktailId, ingredients) {
  await getDB().remove('event_cocktail_ingredients', 'cocktail_id=eq.' + enc(cocktailId));
  const list = (ingredients || []).filter((ing) => ing?.product_id && Number(ing.measures) > 0);
  if (!list.length) return [];
  const rows = await getDB().insert('event_cocktail_ingredients', list.map((ing, i) => ({
    cocktail_id: cocktailId,
    product_id: ing.product_id,
    measures: Number(ing.measures),
    position: i,
  })));
  return rows || [];
}

export function deleteEventCocktail(id) {
  return getDB().remove('event_cocktails', 'id=eq.' + enc(id));
}
