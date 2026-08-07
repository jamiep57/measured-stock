/**
 * V5 data layer — extends window.DB with enriched event reads.
 */

const EVENT_CACHE_TTL_MS = 45_000;
const REF_CACHE_TTL_MS = 5 * 60_000;
const RECIPES_CACHE_TTL_MS = 5 * 60_000;
const LIBRARY_CACHE_TTL_MS = 60_000;

const EVENT_MUTATION_TABLES = new Set([
  'events',
  'bars',
  'recipients',
  'bar_products',
  'event_products',
  'distribution',
  'deliveries',
  'delivery_lines',
  'transfers',
  'transfer_lines',
  'wastage_batches',
  'wastage_lines',
  'stock_counts',
  'stock_count_lines',
  'closing_stock',
  'supplier_return_lines',
  'till_imports',
  'till_sale_rows',
  'modifier_imports',
  'modifier_sale_rows',
  'topup_sessions',
  'topup_lines',
  'event_kit_items',
  'kit_movements',
  'kit_movement_lines',
]);

const REF_MUTATION_TABLES = new Set([
  'case_sizes',
  'categories',
  'suppliers',
]);

const LIBRARY_MUTATION_TABLES = new Set([
  'products',
  'product_suppliers',
]);

const RECIPE_MUTATION_TABLES = new Set([
  'recipes',
  'recipe_ingredients',
]);

/** @type {Map<string, { at: number, value: any }>} */
const eventCache = new Map();
/** @type {Map<string, Promise<any>>} */
const eventInflight = new Map();

/** @type {{ at: number, value: any } | null} */
let caseSizesCache = null;
/** @type {Promise<any> | null} */
let caseSizesInflight = null;

/** @type {{ at: number, value: any } | null} */
let suppliersCache = null;
/** @type {Promise<any> | null} */
let suppliersInflight = null;

/** @type {{ at: number, value: any } | null} */
let categoriesCache = null;
/** @type {Promise<any> | null} */
let categoriesInflight = null;

/** @type {{ at: number, value: any } | null} */
let recipesCache = null;
/** @type {Promise<any> | null} */
let recipesInflight = null;

/** @type {{ at: number, value: any } | null} */
let libraryCache = null;
/** @type {Promise<any> | null} */
let libraryInflight = null;

function cacheFresh(entry, ttl) {
  return !!(entry && (Date.now() - entry.at) < ttl);
}

export function invalidateEventCache(eventId) {
  if (eventId) {
    const id = String(eventId);
    eventCache.delete(id);
    eventInflight.delete(id);
    return;
  }
  eventCache.clear();
  eventInflight.clear();
}

export function invalidateRefCaches() {
  caseSizesCache = null;
  caseSizesInflight = null;
  suppliersCache = null;
  suppliersInflight = null;
  categoriesCache = null;
  categoriesInflight = null;
}

export function invalidateRecipesCache() {
  recipesCache = null;
  recipesInflight = null;
}

export function invalidateLibraryCache() {
  libraryCache = null;
  libraryInflight = null;
}

function noteMutation(table) {
  const name = String(table || '');
  if (EVENT_MUTATION_TABLES.has(name)) invalidateEventCache();
  if (REF_MUTATION_TABLES.has(name)) invalidateRefCaches();
  if (LIBRARY_MUTATION_TABLES.has(name)) {
    invalidateLibraryCache();
    invalidateEventCache();
  }
  if (RECIPE_MUTATION_TABLES.has(name)) invalidateRecipesCache();
}

const READ_REPO_METHODS = new Set([
  'list', 'get', 'where', 'forEvent', 'lines', 'ingredients',
  'listFull', 'listActive', 'byLegacyId', 'getFull',
]);

function wrapRepoMutations(repo) {
  if (!repo || repo.__v5Wrapped) return;
  repo.__v5Wrapped = true;
  const table = repo.table;
  for (const key of Object.keys(repo)) {
    if (typeof repo[key] !== 'function') continue;
    if (READ_REPO_METHODS.has(key)) continue;
    const orig = repo[key].bind(repo);
    repo[key] = async (...args) => {
      const result = await orig(...args);
      if (table) noteMutation(table);
      else invalidateEventCache();
      return result;
    };
  }
}

function ensureCacheInvalidationHooks(DB) {
  if (DB.__v5CacheHooks) return;
  DB.__v5CacheHooks = true;

  for (const method of ['insert', 'update', 'upsert', 'remove']) {
    if (typeof DB[method] !== 'function') continue;
    const orig = DB[method].bind(DB);
    DB[method] = async (table, ...args) => {
      const result = await orig(table, ...args);
      noteMutation(table);
      return result;
    };
  }

  const repos = [
    DB.categories, DB.suppliers, DB.warehouses, DB.caseSizes,
    DB.products, DB.productSuppliers, DB.warehouseStock,
    DB.events, DB.eventProducts, DB.bars, DB.recipients,
    DB.distribution, DB.barProducts, DB.stockCounts, DB.closing,
    DB.supplierReturns, DB.transfers, DB.deliveries, DB.topups,
    DB.wastage, DB.tillImports, DB.modifierImports, DB.recipes, DB.bugs,
  ];
  for (const repo of repos) wrapRepoMutations(repo);
}

function getDB() {
  if (typeof window === 'undefined' || !window.DB) {
    throw new Error('db.js not loaded — include /assets/js/db.js before V5 modules');
  }
  ensureCacheInvalidationHooks(window.DB);
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
  if (cacheFresh(caseSizesCache, REF_CACHE_TTL_MS)) return caseSizesCache.value;
  if (caseSizesInflight) return caseSizesInflight;
  caseSizesInflight = (async () => {
    const DB = getDB();
    try {
      const rows = await DB.caseSizes.list();
      caseSizesCache = { at: Date.now(), value: rows || [] };
      return caseSizesCache.value;
    } catch {
      caseSizesCache = { at: Date.now(), value: [] };
      return [];
    } finally {
      caseSizesInflight = null;
    }
  })();
  return caseSizesInflight;
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

async function fetchEventFull(eventId) {
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

/**
 * @param {string} eventId
 * @param {{ force?: boolean }} [opts]
 */
export async function loadEventFull(eventId, opts = {}) {
  const id = String(eventId || '');
  if (!id) return null;
  if (opts.force) invalidateEventCache(id);

  const hit = eventCache.get(id);
  if (!opts.force && cacheFresh(hit, EVENT_CACHE_TTL_MS)) return hit.value;

  const pending = eventInflight.get(id);
  if (pending) return pending;

  const request = fetchEventFull(id)
    .then((value) => {
      eventCache.set(id, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      eventInflight.delete(id);
    });
  eventInflight.set(id, request);
  return request;
}

/** Product rows embedded on an event — enough for projection/recon matching. */
export function productsFromEvent(event) {
  const byId = new Map();
  for (const ep of event?.event_products || []) {
    const p = ep?.product;
    if (!p?.id && !p?.name) continue;
    const key = p.id || p.name;
    if (!byId.has(key)) byId.set(key, p);
  }
  return [...byId.values()];
}

export async function loadSuppliers() {
  if (cacheFresh(suppliersCache, REF_CACHE_TTL_MS)) return suppliersCache.value;
  if (suppliersInflight) return suppliersInflight;
  suppliersInflight = (async () => {
    try {
      const rows = await getDB().suppliers.list();
      suppliersCache = { at: Date.now(), value: rows || [] };
      return suppliersCache.value;
    } finally {
      suppliersInflight = null;
    }
  })();
  return suppliersInflight;
}

export async function loadCategories() {
  if (cacheFresh(categoriesCache, REF_CACHE_TTL_MS)) return categoriesCache.value;
  if (categoriesInflight) return categoriesInflight;
  categoriesInflight = (async () => {
    try {
      const rows = await getDB().categories.list();
      const filtered = (rows || []).filter((c) => !c.kind || c.kind === 'stock');
      categoriesCache = { at: Date.now(), value: filtered };
      return filtered;
    } catch {
      categoriesCache = { at: Date.now(), value: [] };
      return [];
    } finally {
      categoriesInflight = null;
    }
  })();
  return categoriesInflight;
}

export async function loadRecipesFull() {
  if (cacheFresh(recipesCache, RECIPES_CACHE_TTL_MS)) return recipesCache.value;
  if (recipesInflight) return recipesInflight;
  recipesInflight = (async () => {
    try {
      const rows = await getDB().recipes.listFull();
      recipesCache = { at: Date.now(), value: rows || [] };
      return recipesCache.value;
    } catch {
      recipesCache = { at: Date.now(), value: [] };
      return [];
    } finally {
      recipesInflight = null;
    }
  })();
  return recipesInflight;
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
  if (cacheFresh(libraryCache, LIBRARY_CACHE_TTL_MS)) return libraryCache.value;
  if (libraryInflight) return libraryInflight;
  libraryInflight = (async () => {
    const DB = getDB();
    try {
      let rows;
      try {
        rows = await DB.products.listFull();
      } catch {
        rows = await DB.products.list();
      }
      const filtered = (rows || []).filter((p) => !p.product_kind || p.product_kind === 'stock');
      libraryCache = { at: Date.now(), value: filtered };
      return filtered;
    } finally {
      libraryInflight = null;
    }
  })();
  return libraryInflight;
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
