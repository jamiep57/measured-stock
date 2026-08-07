/**
 * Product library merge helpers — fold duplicate SKUs into one keeper.
 * Server work is DB.products.merge() → merge_products() RPC.
 */

export const MERGE_FIELD_DEFS = [
  { key: 'name', label: 'Name', display: (p) => p.name || '—' },
  {
    key: 'category_id',
    label: 'Category',
    display: (p) => p.category?.name || '—',
    value: (p) => p.category_id || p.category?.id || null,
  },
  {
    key: 'case_size',
    label: 'Stock pack',
    display: (p) => p.case_size || '—',
    value: (p) => p.case_size || null,
  },
  {
    key: 'units_per_case',
    label: 'Units / case',
    display: (p) => (p.units_per_case != null ? String(p.units_per_case) : '—'),
    value: (p) => (p.units_per_case != null ? p.units_per_case : null),
  },
  {
    key: 'sku',
    label: 'SKU',
    display: (p) => p.sku || '—',
    value: (p) => p.sku || null,
  },
  {
    key: 'abv',
    label: 'ABV (%)',
    display: (p) => (p.abv != null ? String(p.abv) : '—'),
    value: (p) => (p.abv != null ? p.abv : null),
  },
];

/** Normalised key for duplicate-name detection. */
export function productNameKey(p) {
  return String(p?.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Non-empty normalised SKU for duplicate-SKU detection. */
export function productSkuKey(p) {
  const sku = String(p?.sku || '').trim().toLowerCase();
  return sku || '';
}

/**
 * Ids that share a name key or a non-empty SKU with at least one other product.
 * @param {Array<{ id: string, name?: string, sku?: string|null }>} products
 * @returns {string[]}
 */
export function findDuplicateProductIds(products) {
  const byName = {};
  const bySku = {};
  (products || []).forEach((p) => {
    if (!p?.id) return;
    const nk = productNameKey(p);
    if (nk) (byName[nk] = byName[nk] || []).push(p.id);
    const sk = productSkuKey(p);
    if (sk) (bySku[sk] = bySku[sk] || []).push(p.id);
  });
  const selected = new Set();
  Object.values(byName).forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => selected.add(id));
  });
  Object.values(bySku).forEach((ids) => {
    if (ids.length > 1) ids.forEach((id) => selected.add(id));
  });
  return [...selected];
}

export function mergeProductScore(p) {
  return ['supplier_id', 'category_id', 'case_size', 'units_per_case', 'stock_unit', 'case_price', 'unit_price', 'sku', 'abv']
    .reduce((s, k) => s + (p?.[k] != null && p[k] !== '' ? 1 : 0), 0);
}

export function mergeFieldValue(p, def) {
  if (def.value) return def.value(p);
  return p?.[def.key] != null && p[def.key] !== '' ? p[def.key] : null;
}

export function defaultMergeFieldSource(chosen, def) {
  const ranked = chosen
    .map((p) => ({ id: p.id, v: mergeFieldValue(p, def) }))
    .filter((x) => x.v != null && x.v !== '');
  if (!ranked.length) return chosen[0]?.id || null;
  ranked.sort((a, b) => {
    const sa = mergeProductScore(chosen.find((p) => p.id === a.id));
    const sb = mergeProductScore(chosen.find((p) => p.id === b.id));
    return sb - sa || String(a.v).localeCompare(String(b.v));
  });
  return ranked[0].id;
}

export function defaultMergeFieldSources(chosen, defs = MERGE_FIELD_DEFS) {
  const out = {};
  (defs || []).forEach((def) => {
    out[def.key] = defaultMergeFieldSource(chosen, def);
  });
  return out;
}

export function pickDefaultKeeper(chosen) {
  const sorted = (chosen || []).slice().sort((a, b) =>
    mergeProductScore(b) - mergeProductScore(a) ||
    String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return sorted;
}

export function buildMergeFieldsPayload(chosen, fieldSource, defs = MERGE_FIELD_DEFS) {
  const out = {};
  (defs || []).forEach((def) => {
    const pid = fieldSource?.[def.key];
    const p = (chosen || []).find((x) => x.id === pid);
    if (!p) return;
    out[def.key] = mergeFieldValue(p, def);
  });
  return out;
}

/**
 * @param {{ product_suppliers?: Array, supplier_id?: string, supplier?: { name?: string }, case_size?: string, sku?: string, case_price?: number|null }} p
 * @param {(id: string) => string} [supplierNameById]
 */
export function collectProductOffers(p, supplierNameById) {
  const rows = p?.product_suppliers || [];
  if (rows.length) {
    return rows.map((r) => ({
      supplier_id: r.supplier_id,
      supplier_name: r.supplier?.name || supplierNameById?.(r.supplier_id) || '—',
      pack_size: (r.pack_size != null && r.pack_size !== '') ? r.pack_size : (p.case_size || ''),
      sku: r.sku || '',
      case_price: r.case_price,
      is_preferred: !!r.is_preferred,
    }));
  }
  if (p?.supplier_id) {
    return [{
      supplier_id: p.supplier_id,
      supplier_name: p.supplier?.name || supplierNameById?.(p.supplier_id) || '—',
      pack_size: p.case_size || '',
      sku: p.sku || '',
      case_price: p.case_price,
      is_preferred: true,
    }];
  }
  return [];
}

export function mergeOffersPreview(chosen, supplierNameById) {
  const map = new Map();
  (chosen || []).forEach((p) => {
    collectProductOffers(p, supplierNameById).forEach((o) => {
      const k = [o.supplier_id, o.pack_size || '', o.sku || ''].join('\0');
      if (!map.has(k)) map.set(k, { ...o });
      else {
        const ex = map.get(k);
        if (ex.case_price == null && o.case_price != null) ex.case_price = o.case_price;
        ex.is_preferred = ex.is_preferred || o.is_preferred;
      }
    });
  });
  return [...map.values()].sort((a, b) =>
    (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0) ||
    (a.supplier_name || '').localeCompare(b.supplier_name || '') ||
    (a.pack_size || '').localeCompare(b.pack_size || ''));
}
