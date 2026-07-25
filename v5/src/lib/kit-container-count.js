/**
 * Mobile kit container counting — pure helpers for draft contents + scan routing.
 *
 * Workflow: create/scan a container → add items (match library or create new).
 */

const RECENT_KEY = 'ms_kit_count_recent_containers';
const RECENT_MAX = 8;

export function parseContentsQty(raw) {
  const n = Number(String(raw ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {Array<{ child_product_id: string, qty: number, child?: object }>} lines
 * @param {string} childId
 * @param {number} delta
 * @param {object} [child]
 */
export function bumpContentsLine(lines, childId, delta, child = null) {
  const list = (lines || []).map((l) => ({ ...l }));
  const idx = list.findIndex((l) => l.child_product_id === childId);
  const d = Number(delta) || 0;
  if (!childId || !d) return list;
  if (idx < 0) {
    if (d < 0) return list;
    list.push({
      child_product_id: childId,
      qty: parseContentsQty(d),
      child: child || null,
    });
    return list;
  }
  const next = (Number(list[idx].qty) || 0) + d;
  if (!Number.isFinite(next) || next <= 0) {
    list.splice(idx, 1);
    return list;
  }
  list[idx] = {
    ...list[idx],
    qty: parseContentsQty(next),
    child: child || list[idx].child || null,
  };
  return list;
}

/**
 * @param {Array<{ child_product_id: string, qty: number, child?: object }>} lines
 * @param {string} childId
 * @param {number} qty
 * @param {object} [child]
 */
export function setContentsQty(lines, childId, qty, child = null) {
  const list = (lines || []).map((l) => ({ ...l }));
  const idx = list.findIndex((l) => l.child_product_id === childId);
  if (!childId) return list;
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    if (idx >= 0) list.splice(idx, 1);
    return list;
  }
  const clean = parseContentsQty(n);
  if (idx < 0) {
    list.push({ child_product_id: childId, qty: clean, child: child || null });
    return list;
  }
  list[idx] = {
    ...list[idx],
    qty: clean,
    child: child || list[idx].child || null,
  };
  return list;
}

export function removeContentsLine(lines, childId) {
  return (lines || []).filter((l) => l.child_product_id !== childId);
}

/**
 * Case-insensitive name/sku/barcode filter for quick add.
 * @param {Array<object>} products
 * @param {string} query
 * @param {{ excludeIds?: Set<string>|string[], limit?: number }} [opts]
 */
export function filterKitProducts(products, query, opts = {}) {
  const q = String(query || '').trim().toLowerCase();
  const exclude = opts.excludeIds instanceof Set
    ? opts.excludeIds
    : new Set(opts.excludeIds || []);
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 40;
  const list = (products || []).filter((p) => {
    if (!p?.id || exclude.has(p.id) || p.archived) return false;
    if (!q) return true;
    const hay = [p.name, p.sku, p.barcode, p.category?.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return list.slice(0, limit);
}

/**
 * Decide what a scanned code means when picking a container.
 * @returns {{ kind: 'container'|'item'|'unknown', product?: object, barcode: string }}
 */
export function resolveContainerScan(products, barcode, findProductByBarcode) {
  const code = String(barcode || '').trim();
  if (!code) return { kind: 'unknown', barcode: '' };
  const product = findProductByBarcode?.(products, code) || null;
  if (!product) return { kind: 'unknown', barcode: code, product: null };
  if (product.is_container) return { kind: 'container', barcode: code, product };
  return { kind: 'item', barcode: code, product };
}

/**
 * Decide what a scanned code means while counting inside a container.
 * @returns {{ kind: 'match'|'unknown'|'self', product?: object, barcode: string }}
 */
export function resolveItemScan(products, barcode, containerId, findProductByBarcode) {
  const code = String(barcode || '').trim();
  if (!code) return { kind: 'unknown', barcode: '' };
  const product = findProductByBarcode?.(products, code) || null;
  if (!product) return { kind: 'unknown', barcode: code, product: null };
  if (product.id === containerId) return { kind: 'self', barcode: code, product };
  return { kind: 'match', barcode: code, product };
}

export function kitItemCreatePayload({
  name,
  categoryId = null,
  barcode = null,
  sku = null,
  isContainer = false,
  notes = null,
}) {
  const cleanName = String(name || '').trim();
  return {
    name: cleanName,
    category_id: categoryId || null,
    barcode: (barcode == null ? '' : String(barcode)).trim() || null,
    sku: (sku == null ? '' : String(sku)).trim() || null,
    notes: (notes == null ? '' : String(notes)).trim() || null,
    is_container: !!isContainer,
    product_kind: 'kit',
    stock_unit: 'unit',
    units_per_case: 1,
    case_size: 'unit',
    archived: false,
  };
}

export function kitCategoryCreatePayload(name, sortOrder = 0) {
  return {
    name: String(name || '').trim(),
    kind: 'kit',
    colour_key: 'rtd',
    sort_order: Number(sortOrder) || 0,
  };
}

export function loadRecentContainerIds() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter(Boolean).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecentContainerId(id) {
  if (!id) return loadRecentContainerIds();
  const next = [String(id), ...loadRecentContainerIds().filter((x) => x !== String(id))]
    .slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

export function contentsToSaveLines(lines) {
  return (lines || []).map((l) => ({
    child_product_id: l.child_product_id,
    qty: parseContentsQty(l.qty),
  }));
}
