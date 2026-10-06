#!/usr/bin/env node
/**
 * Create paid test orders in the Square Sandbox so the live sales feed has something to receive.
 *
 *   SQUARE_SANDBOX_TOKEN=EAAA... node scripts/square-sandbox-sales.mjs [--orders 40] [--catalog] [--dry-run]
 *
 * --catalog sells the Square items each location actually offers (as pushed from the app)
 * instead of free-typed lines, so sales arrive with real item and serve size names.
 *
 * The token is the Sandbox access token on the app's Credentials page in the Square Developer Console.
 * Square stamps each order with the current time, so orders only land on an event whose dates include today.
 */

const BASE = 'https://connect.squareupsandbox.com';
const VERSION = (process.env.SQUARE_VERSION || '2026-09-16').trim();
const TOKEN = (process.env.SQUARE_SANDBOX_TOKEN || '').trim();

const BARS = ['Lakeside', 'Forest', 'Walled Garden', 'Ampitheatre'];

// Names and prices from the Peep 2026 till export; weight is roughly relative volume.
const MENU = [
  { name: 'Utopian Lager (Can)', price: 6.95, weight: 30 },
  { name: 'Utopian Lager (Pint)', price: 7.45, weight: 26 },
  { name: 'Peach Jubel (Can)', price: 6.95, weight: 16 },
  { name: 'Compulsory Cup', price: 2.0, weight: 10 },
  { name: 'Peach Jubel (Pint)', price: 7.45, weight: 9 },
  { name: 'Still Water', price: 3.2, weight: 8 },
  { name: 'White Claw Raspberry', price: 7.95, weight: 7 },
  { name: 'Apple Cider Brothers (Can)', price: 6.95, weight: 7 },
  { name: 'Utopian Pale (Pint)', price: 7.45, weight: 6 },
  { name: 'Frozen Margarita', price: 8.95, weight: 5, modifiers: [{ name: 'Extra Shot', price: 2.0, chance: 0.3 }] },
  { name: 'Coke', price: 3.45, weight: 5 },
  { name: 'Finlandia Vodka (Double)', price: 10.95, weight: 4, modifiers: [{ name: 'Coke', price: 0, chance: 0.5 }, { name: 'Lemonade', price: 0, chance: 0.3 }] },
  { name: 'Guinness (Pint)', price: 7.45, weight: 3 },
  { name: 'Cazcabel Reposado Tequila (Double)', price: 10.95, weight: 4 },
  { name: 'Diet Coke', price: 3.4, weight: 3 },
  { name: 'Aperol Spritz', price: 10.0, weight: 2 },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function square(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Square-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.errors || []).map((e) => `${e.code}: ${e.detail}`).join('; ') || res.statusText;
    throw new Error(`${method} ${path} failed (${res.status}) ${detail}`);
  }
  return data;
}

const pence = (pounds) => Math.round(pounds * 100);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function weightedItem() {
  const total = MENU.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of MENU) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return MENU[0];
}

async function ensureLocations(dryRun) {
  const { locations = [] } = await square('/v2/locations');
  const byName = new Map(locations.map((loc) => [loc.name.trim().toLowerCase(), loc]));
  const currency = locations[0]?.currency || 'GBP';
  const out = [];
  for (const name of BARS) {
    let loc = byName.get(name.toLowerCase());
    if (!loc && dryRun) {
      console.log(`would create location ${name}`);
      continue;
    }
    if (!loc) {
      ({ location: loc } = await square('/v2/locations', {
        method: 'POST',
        body: { location: { name, description: 'Stock app test bar' } },
      }));
      console.log(`created location ${name}`);
    }
    out.push(loc);
  }
  return { locations: out, currency: out[0]?.currency || currency };
}

async function catalogMenus(locations) {
  const items = [];
  let cursor = '';
  do {
    const qs = new URLSearchParams({ types: 'ITEM' });
    if (cursor) qs.set('cursor', cursor);
    const json = await square(`/v2/catalog/list?${qs}`);
    items.push(...(json.objects || []));
    cursor = json.cursor || '';
  } while (cursor);
  const offered = (obj, locId) => (obj.present_at_all_locations
    ? !(obj.absent_at_location_ids || []).includes(locId)
    : (obj.present_at_location_ids || []).includes(locId));
  const menus = new Map();
  for (const loc of locations) {
    const variations = [];
    for (const item of items) {
      if (item.is_deleted || !offered(item, loc.id)) continue;
      for (const v of item.item_data?.variations || []) {
        if (!offered(v, loc.id) || v.item_variation_data?.pricing_type !== 'FIXED_PRICING') continue;
        variations.push({ id: v.id, label: `${item.item_data.name} (${v.item_variation_data.name})` });
      }
    }
    menus.set(loc.id, variations);
  }
  return menus;
}

function buildCatalogLines(variations) {
  const count = 1 + Math.floor(Math.random() * 3);
  return Array.from({ length: count }, () => ({
    catalog_object_id: pick(variations).id,
    quantity: String(1 + Math.floor(Math.random() * 2)),
  }));
}

function buildLineItems(currency) {
  const lines = [];
  const count = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i += 1) {
    const item = weightedItem();
    const modifiers = (item.modifiers || [])
      .filter((mod) => Math.random() < mod.chance)
      .map((mod) => ({ name: mod.name, base_price_money: { amount: pence(mod.price), currency } }));
    lines.push({
      name: item.name,
      quantity: String(1 + Math.floor(Math.random() * 2)),
      base_price_money: { amount: pence(item.price), currency },
      ...(modifiers.length ? { modifiers } : {}),
    });
  }
  return lines;
}

async function main() {
  const orders = Number(arg('orders', 40)) || 40;
  const dryRun = arg('dry-run', false) === true;
  if (!TOKEN) {
    console.error('Set SQUARE_SANDBOX_TOKEN to the Sandbox access token from the Square Developer Console.');
    process.exit(1);
  }

  const { locations, currency } = await ensureLocations(dryRun);
  if (dryRun) {
    console.log(`dry run: would create ${orders} paid orders across ${BARS.join(', ')}`);
    return;
  }

  const menus = arg('catalog', false) === true ? await catalogMenus(locations) : null;
  const selling = menus ? locations.filter((loc) => menus.get(loc.id)?.length) : locations;
  if (!selling.length) {
    console.error('No location offers any priced Square items yet. Push the menu from the app first.');
    process.exit(1);
  }
  if (menus) {
    for (const loc of locations) console.log(`${loc.name}: ${menus.get(loc.id).length} serve sizes on the till`);
  }

  const totals = new Map();
  for (let i = 0; i < orders; i += 1) {
    const loc = pick(selling);
    const lineItems = menus ? buildCatalogLines(menus.get(loc.id)) : buildLineItems(currency);
    const { order } = await square('/v2/orders', {
      method: 'POST',
      body: {
        idempotency_key: crypto.randomUUID(),
        order: { location_id: loc.id, line_items: lineItems },
      },
    });
    await square('/v2/payments', {
      method: 'POST',
      body: {
        idempotency_key: crypto.randomUUID(),
        source_id: 'cnon:card-nonce-ok',
        amount_money: order.total_money,
        order_id: order.id,
        location_id: loc.id,
        autocomplete: true,
      },
    });
    const row = totals.get(loc.name) || { orders: 0, items: 0, gross: 0 };
    row.orders += 1;
    row.items += order.line_items.reduce((sum, line) => sum + Number(line.quantity), 0);
    row.gross += Number(order.total_money.amount) / 100;
    totals.set(loc.name, row);
    process.stdout.write(`\rpaid ${i + 1}/${orders}`);
  }
  process.stdout.write('\n');

  console.log('\nCreated:');
  for (const [name, row] of totals) {
    console.log(`  ${name.padEnd(14)} ${String(row.orders).padStart(3)} orders  ${String(row.items).padStart(4)} items  £${row.gross.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
