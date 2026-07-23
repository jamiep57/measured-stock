/**
 * V5 data layer — extends window.DB with enriched event reads.
 */

function getDB() {
  if (typeof window === 'undefined' || !window.DB) {
    throw new Error('db.js not loaded — include /assets/js/db.js before V5 modules');
  }
  return window.DB;
}

const PRODUCT_SELECT =
  'id,name,case_size,case_size_id,stock_case_size_id,units_per_case,stock_unit,' +
  'case_price,unit_price,supplier_id,sku,abv,' +
  'category:categories(id,name,colour_key),' +
  'product_suppliers(id,supplier_id,sku,pack_size,units_per_case,case_price,unit_price,is_preferred,purchase_case_size_id,supplier:suppliers(id,name))';

export async function loadCaseSizes() {
  const DB = getDB();
  try {
    return await DB.caseSizes.list();
  } catch {
    return [];
  }
}

export async function loadEventsList() {
  const DB = getDB();
  const [events, blobs] = await Promise.all([
    DB.events.list('?select=id,name,legacy_id,status&order=created_at.desc'),
    DB.select('stock_events', '?select=id&order=name').catch(() => []),
  ]);
  const blobIds = new Set((blobs || []).map((b) => b.id));
  return (events || []).filter((e) => !e.legacy_id || blobIds.has(e.legacy_id));
}

export async function loadEventFull(eventId) {
  const DB = getDB();
  try {
    const row = await DB.select(
      'events',
      '?id=eq.' + DB._.enc(eventId) +
      '&select=*' +
      ',bars:bars(*)' +
      ',recipients:recipients(*)' +
      ',bar_products:bar_products(*)' +
      ',event_products:event_products(*,product:products(' + PRODUCT_SELECT + '))'
    );
    return (row && row[0]) || null;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/stock_case_size_id|purchase_case_size_id|column/.test(msg)) {
      const ev = await DB.events.getFull(eventId);
      if (ev) {
        ev.bar_products = await DB.barProducts.forEvent(eventId).catch(() => []);
      }
      return ev;
    }
    throw err;
  }
}

export async function loadSuppliers() {
  return getDB().suppliers.list();
}

export async function loadCategories() {
  try {
    return await getDB().categories.list();
  } catch {
    return [];
  }
}

export async function loadLibraryProducts() {
  const DB = getDB();
  try {
    return await DB.products.listFull();
  } catch {
    return await DB.products.list();
  }
}

export function productFromEvent(event, productId) {
  const ep = (event?.event_products || []).find((x) => x.product_id === productId);
  return ep?.product || null;
}

export { getDB };
