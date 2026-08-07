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
  'id,name,case_size,case_size_id,stock_case_size_id,units_per_case,stock_unit,product_kind,' +
  'case_price,unit_price,supplier_id,sku,abv,pool_name,pool_servings_per_unit,pool_servings_text,' +
  'category:categories(id,name,colour_key,kind),' +
  'product_suppliers(id,supplier_id,sku,pack_size,units_per_case,case_price,unit_price,is_preferred,purchase_case_size_id,supplier:suppliers(id,name))';

const KIT_PRODUCT_SELECT =
  'id,name,sku,barcode,stock_unit,units_per_case,product_kind,category_id,notes,archived,is_container,' +
  'image_url,unit_price,case_price,' +
  'category:categories(id,name,colour_key,kind,sort_order)';

const KIT_PRODUCT_SELECT_FALLBACK =
  'id,name,sku,stock_unit,units_per_case,product_kind,category_id,' +
  'category:categories(id,name,colour_key,kind,sort_order)';

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
  const listQuery = '?select=id,name,legacy_id,status,image_url&order=created_at.desc';
  const [events, blobs] = await Promise.all([
    DB.events.list(listQuery).catch(async (err) => {
      if (/image_url|column/.test(String(err?.message || err))) {
        return DB.events.list('?select=id,name,legacy_id,status&order=created_at.desc');
      }
      throw err;
    }),
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
    const rows = await getDB().categories.list();
    return (rows || []).filter((c) => !c.kind || c.kind === 'stock');
  } catch {
    return [];
  }
}

export async function loadKitCategories() {
  try {
    return await getDB().categories.list('?kind=eq.kit&select=*&order=sort_order,name');
  } catch {
    try {
      const rows = await getDB().categories.list();
      return (rows || []).filter((c) => c.kind === 'kit');
    } catch {
      return [];
    }
  }
}

export async function loadLibraryProducts() {
  const DB = getDB();
  try {
    const rows = await DB.products.listFull();
    return (rows || []).filter((p) => !p.product_kind || p.product_kind === 'stock');
  } catch {
    const rows = await DB.products.list();
    return (rows || []).filter((p) => !p.product_kind || p.product_kind === 'stock');
  }
}

function isNetworkFetchError(err) {
  const msg = String(err?.message || err);
  return /Failed to fetch|NetworkError|Load failed|ERR_NETWORK|network error/i.test(msg);
}

export { isNetworkFetchError };

export async function loadKitLibraryProducts() {
  const DB = getDB();
  try {
    return await DB.select(
      'products',
      '?product_kind=eq.kit' +
      '&select=' + KIT_PRODUCT_SELECT +
      '&order=name',
    );
  } catch (err) {
    const msg = String(err?.message || err);
    if (/barcode|is_container|notes|archived|column/.test(msg)) {
      try {
        return await DB.select(
          'products',
          '?product_kind=eq.kit' +
          '&select=' + KIT_PRODUCT_SELECT_FALLBACK +
          '&order=name',
        );
      } catch (fallbackErr) {
        if (isNetworkFetchError(fallbackErr)) throw fallbackErr;
        return [];
      }
    }
    // Surface real connectivity failures to the kit library panel.
    if (isNetworkFetchError(err)) throw err;
    return [];
  }
}

/**
 * Packing lists for kit containers.
 * @param {string[]} [containerIds] — if set, only these containers; else all.
 */
export async function loadKitContainerContents(containerIds) {
  const DB = getDB();
  const enc = DB._.enc;
  const childSelect =
    'id,name,sku,barcode,product_kind,category_id,is_container,' +
    'category:categories(id,name)';
  try {
    let q = '?select=id,container_product_id,child_product_id,qty,sort_order,'
      + 'child:products!child_product_id(' + childSelect + ')'
      + '&order=sort_order,created_at';
    if (Array.isArray(containerIds) && containerIds.length) {
      q += '&container_product_id=in.(' + containerIds.map(enc).join(',') + ')';
    }
    return await DB.select('kit_container_contents', q);
  } catch (err) {
    const msg = String(err?.message || err);
    // Contents are optional for the catalogue list — never blank the whole panel.
    if (
      isNetworkFetchError(err)
      || /kit_container_contents|does not exist|PGRST|column|relationship/.test(msg)
    ) {
      return [];
    }
    console.warn('loadKitContainerContents', err);
    return [];
  }
}

/**
 * Replace the packing list for one container product.
 * @param {string} containerProductId
 * @param {Array<{ child_product_id: string, qty?: number }>} lines
 */
export async function replaceKitContainerContents(containerProductId, lines) {
  const DB = getDB();
  const enc = DB._.enc;
  await DB.remove(
    'kit_container_contents',
    'container_product_id=eq.' + enc(containerProductId),
  );
  const clean = (lines || [])
    .filter((r) => r && r.child_product_id && r.child_product_id !== containerProductId)
    .map((r, i) => ({
      container_product_id: containerProductId,
      child_product_id: r.child_product_id,
      qty: Math.max(Number(r.qty) || 0, 0.0001),
      sort_order: i,
    }));
  if (!clean.length) return [];
  return DB.insert('kit_container_contents', clean);
}

export async function loadEventKit(eventId) {
  const DB = getDB();
  const enc = DB._.enc;
  const selectKit = KIT_PRODUCT_SELECT;
  const selectFallback = KIT_PRODUCT_SELECT_FALLBACK;
  async function loadItems(productSelect) {
    return DB.select(
      'event_kit_items',
      '?event_id=eq.' + enc(eventId) +
      '&select=*,product:products(' + productSelect + ')' +
      '&order=created_at',
    );
  }
  async function loadMovements(productSelect) {
    return DB.select(
      'kit_movements',
      '?event_id=eq.' + enc(eventId) +
      '&select=*,lines:kit_movement_lines(*,product:products(' + productSelect + '),warehouse:warehouses(id,name),supplier:suppliers(id,name))' +
      '&order=moved_at.desc',
    );
  }
  let items;
  let movements;
  try {
    [items, movements] = await Promise.all([
      loadItems(selectKit),
      loadMovements(selectKit),
    ]);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/barcode|is_container|notes|archived|column/.test(msg)) {
      [items, movements] = await Promise.all([
        loadItems(selectFallback),
        loadMovements(selectFallback),
      ]);
    } else {
      throw err;
    }
  }
  const containerIds = [...new Set(
    (items || [])
      .filter((it) => it.product?.is_container)
      .map((it) => it.product_id)
      .filter(Boolean),
  )];
  const contents = containerIds.length
    ? await loadKitContainerContents(containerIds)
    : [];
  return {
    items: items || [],
    movements: movements || [],
    contents: contents || [],
  };
}

export function productFromEvent(event, productId) {
  const ep = (event?.event_products || []).find((x) => x.product_id === productId);
  return ep?.product || null;
}

export { getDB };
