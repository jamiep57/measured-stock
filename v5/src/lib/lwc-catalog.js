/**
 * Public LWC Drinks catalogue lookup (https://catalog.lwc.co.uk).
 * No supplier API — storefront GraphQL via our edge proxy.
 */

import { getDB } from '../db.js';

export const LWC_CATALOG_ORIGIN = 'https://catalog.lwc.co.uk';

const SEARCH_LIMIT = 8;
const FETCH_LIMIT = 12;

function normPack(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/litres?|ltrs?/g, 'l')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
}

function formatVolume(num, unit) {
  const n = String(num);
  const u = String(unit || '').toLowerCase();
  if (u === 'cl' && Number(n) === 75) return '750ml';
  if (u === 'cl' && Number(n) === 70) return '70cl';
  if (u === 'ml' && Number(n) === 750) return '750ml';
  if (u === 'ml' && Number(n) === 700) return '70cl';
  if (u === 'l' || u === 'ltr') {
    if (Number(n) === 1) return '1L';
    return `${n}L`;
  }
  if (u === 'cl') return `${n}cl`;
  return `${n}ml`;
}

function parseLitres(raw) {
  const s = String(raw || '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:l|ltr|litre)s?\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * @param {string} raw
 * @returns {number | null}
 */
export function parseAbv(raw) {
  const m = String(raw || '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort pack label from an LWC product name + custom fields.
 * @param {{ name?: string, unitSize?: string, container?: string }} hit
 * @returns {string | null}
 */
export function inferPackLabel(hit) {
  const name = String(hit?.name || '');
  const unit = String(hit?.unitSize || '');
  const container = String(hit?.container || '');
  const hay = `${name} ${unit} ${container}`;

  const pack = name.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|cl|l|ltr)\b/i);
  if (pack) {
    return `${pack[1]}×${formatVolume(pack[2], pack[3])}`;
  }

  if (/9\s*(g|gal|gallon)s?\b/i.test(hay) || /9gal/i.test(normPack(unit))) {
    return '9 Gal';
  }

  const isKeg = /keg/i.test(name) || /keg/i.test(container) || /keykeg/i.test(hay);
  if (isKeg) {
    const litres = parseLitres(unit) || parseLitres(name);
    if (litres === 50) return '50L Keg';
    if (litres === 30) return '30L Keg';
    if (litres === 20) return /keykeg/i.test(hay) ? '20L KeyKeg' : '20L';
    if (litres) return `${litres}L Keg`;
  }

  const bottle = unit.match(/(\d+(?:\.\d+)?)\s*(ml|cl|l|ltr)\b/i)
    || name.match(/(\d+(?:\.\d+)?)\s*(cl|ml)\b/i);
  if (bottle) return formatVolume(bottle[1], bottle[2]);

  const litres = parseLitres(unit) || parseLitres(name);
  if (litres) return litres === 1 ? '1L' : `${litres}L`;

  return unit.trim() || null;
}

/**
 * @param {string | null} label
 * @param {Array<{ id: string, label?: string }>} caseSizes
 */
export function matchCaseSize(label, caseSizes) {
  const want = normPack(label);
  if (!want || !caseSizes?.length) return null;

  const scored = caseSizes.map((cs) => {
    const got = normPack(cs.label);
    let score = 0;
    if (!got) return { cs, score: 0 };
    if (got === want) score = 100;
    else if (want.endsWith('keg') && got === `${want}`) score = 90;
    else if (got === `${want}keg` || want === `${got}keg`) score = 80;
    else if (got.startsWith(want) && want.length >= 5) score = 60;
    else if (want.startsWith(got) && got.length >= 5) score = 50;
    else if (want === '75cl' && got === '750ml') score = 95;
    else if (want === '750ml' && got === '75cl') score = 90;
    else if (want === '70cl' && got === '700ml') score = 95;
    else if (want === '700ml' && got === '70cl') score = 90;
    else if (want === '30l' && got === '30lkeg') score = 85;
    else if (want === '50l' && got === '50lkeg') score = 85;
    else if (want === '9gal' && got === '9gal') score = 100;
    return { cs, score };
  }).filter((row) => row.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.cs || null;
}

function lwcFamily(hit) {
  const path = String(hit?.categoryPath || '').toLowerCase();
  const cat = String(hit?.productCategory || '').toLowerCase();
  const type = String(hit?.productType || '').toLowerCase();
  const name = String(hit?.name || '').toLowerCase();
  const hay = `${path} ${cat} ${type} ${name}`;
  if (/\/wine|white wine|red wine|rose|rosé|sparkling|prosecco|champagne/.test(hay)) return 'wine';
  if (/\/cider|\bcider\b/.test(hay)) return 'cider';
  if (/\/beer|lager|stout|porter|\bale\b|\bipa\b|\bbitter\b/.test(hay)) return 'beer';
  if (/\/spirit|gin|vodka|rum|whisky|whiskey|tequila|liqueur|brandy/.test(hay)) return 'spirits';
  if (/\/soft|soft drink|juice|\bwater\b|\bcola\b/.test(hay)) return 'softs';
  if (/\/rtd|\brtd\b|premix|canned cocktail/.test(hay)) return 'rtd';
  return '';
}

/**
 * @param {object} hit
 * @param {Array<{ id: string, name?: string, colour_key?: string }>} categories
 */
export function matchCategory(hit, categories) {
  if (!categories?.length) return null;
  const family = lwcFamily(hit);
  const lwcCat = String(hit?.productCategory || '').toLowerCase();
  const path = String(hit?.categoryPath || '').toLowerCase();

  const scored = categories.map((c) => {
    const name = String(c.name || '').toLowerCase();
    const key = String(c.colour_key || '').toLowerCase();
    if (!name) return { c, score: 0 };
    let score = 0;
    if (lwcCat && (lwcCat === name || lwcCat.includes(name))) score += 25;
    if (name.length >= 4 && lwcCat.includes(name)) score += 10;
    if (family && (name.includes(family) || key === family || key.includes(family))) score += 12;
    if (family === 'spirits' && (name.includes('spirit') || key.includes('spirit'))) score += 12;
    if (family === 'softs' && (name.includes('soft') || key.includes('soft'))) score += 12;
    if (path.includes(`/${name.replace(/\s+/g, '-')}`)) score += 15;
    return { c, score };
  }).filter((row) => row.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 12 ? scored[0].c : null;
}

/**
 * @param {Array<{ id: string, name?: string }>} suppliers
 */
export function findLwcSupplier(suppliers) {
  const list = (suppliers || []).filter((s) => s?.name);
  const exact = list.find((s) => /^lwc(\/mc)?$/i.test(s.name.trim()));
  if (exact) return exact;
  return list.find((s) => /\blwc\b/i.test(s.name)) || null;
}

function tokensOf(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Re-rank BigCommerce fuzzy matches so "Mount Holdsworth" beats "Mount Gay".
 * @param {object[]} hits
 * @param {string} query
 */
export function rankLwcHits(hits, query) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = tokensOf(q);
  return [...(hits || [])]
    .map((hit, index) => {
      const name = String(hit.name || '').toLowerCase();
      const brand = String(hit.brand || '').toLowerCase();
      let score = 0;
      if (name === q) score += 120;
      if (brand === q) score += 80;
      if (q && name.startsWith(q)) score += 60;
      if (q && brand.startsWith(q)) score += 40;
      if (tokens.length && tokens.every((t) => name.includes(t))) score += 30;
      for (const t of tokens) {
        if (name.includes(t)) score += 6;
        if (brand.includes(t)) score += 4;
      }
      return { hit, score: score - index * 0.01 };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.hit);
}

/**
 * @param {object} hit
 * @param {{ categories?: object[], caseSizes?: object[], suppliers?: object[] }} [opts]
 */
export function mapLwcHitToFields(hit, opts = {}) {
  const packLabel = inferPackLabel(hit);
  const caseSize = matchCaseSize(packLabel, opts.caseSizes || []);
  const category = matchCategory(hit, opts.categories || []);
  const supplier = findLwcSupplier(opts.suppliers || []);
  return {
    name: hit?.name || '',
    sku: hit?.sku || null,
    abv: parseAbv(hit?.abv),
    url: hit?.url || '',
    image: hit?.image || '',
    packLabel,
    categoryId: category?.id || null,
    category,
    caseSizeId: caseSize?.id || null,
    caseSize,
    supplierId: supplier?.id || null,
    supplier,
  };
}

function customFields(edges) {
  const out = {};
  for (const edge of edges || []) {
    const name = edge?.node?.name;
    if (name) out[name] = String(edge.node.value || '');
  }
  return out;
}

/**
 * Normalise a GraphQL (or proxy) product node into a catalogue hit.
 * @param {object} node
 */
export function normaliseLwcNode(node) {
  if (!node) return null;
  const fields = customFields(node.customFields?.edges);
  const catEdge = node.categories?.edges?.[0]?.node;
  const path = String(node.path || '').trim();
  const url = node.url
    || (path ? `${LWC_CATALOG_ORIGIN}${path.startsWith('/') ? path : `/${path}`}` : '');
  const name = String(node.name || '').trim();
  if (!name) return null;
  const brand = typeof node.brand === 'string'
    ? node.brand
    : (node.brand?.name || fields.Producer || '');
  return {
    id: String(node.entityId || node.id || url || name),
    name,
    sku: String(node.sku || '').trim() || null,
    url,
    brand: String(brand).trim(),
    productCategory: node.productCategory || fields['Product Category'] || catEdge?.name || '',
    productType: node.productType || fields['Product Type'] || '',
    categoryPath: node.categoryPath || catEdge?.path || '',
    unitSize: node.unitSize || fields['Unit Size'] || '',
    abv: node.abv || fields['Alcohol By Volume'] || '',
    container: node.container || fields.Container || '',
    image: String(node.defaultImage?.url || node.image || '').trim(),
  };
}

function edgeHeaders() {
  const DB = getDB();
  if (typeof DB.init === 'function') DB.init();
  const base = String(DB.config?.url || '').replace(/\/$/, '');
  const key = DB.config?.key || '';
  return { base, key };
}

/**
 * @param {string} query
 * @param {{ signal?: AbortSignal, limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function searchLwcCatalog(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || SEARCH_LIMIT, 1), FETCH_LIMIT);

  const { base, key } = edgeHeaders();
  if (!base || !key) throw new Error('Cloud not configured');

  const url = `${base}/functions/v1/lwc-catalog-search?q=${encodeURIComponent(q)}&n=${limit}`;
  const res = await fetch(url, {
    signal: opts.signal,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LWC search failed (${res.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json();
  if (data?.error && !Array.isArray(data?.results)) {
    throw new Error(String(data.error));
  }
  const hits = (data?.results || [])
    .map((row) => normaliseLwcNode(row) || row)
    .filter((row) => row?.name);
  return rankLwcHits(hits, q).slice(0, SEARCH_LIMIT).map((hit) => ({
    ...hit,
    source: hit.source || 'lwc',
    sourceLabel: hit.sourceLabel || 'LWC',
  }));
}
