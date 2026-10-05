/**
 * Public The Whisky Exchange catalogue lookup (https://www.thewhiskyexchange.com).
 * Uses the site's public suggest JSON (HTML search is Cloudflare-gated).
 */

import { getDB } from '../db.js';
import { inferPackLabel, rankLwcHits } from './lwc-catalog.js';

export const TWE_ORIGIN = 'https://www.thewhiskyexchange.com';
export const TWE_IMG_ORIGIN = 'https://img.thewhiskyexchange.com';

const SEARCH_LIMIT = 8;

export function slugifyTweName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function tweFamily(name) {
  const n = String(name || '').toLowerCase();
  if (/champagne|prosecco|\bwine\b|burgundy|bordeaux|sauvignon|chardonnay/.test(n)) return 'wine';
  if (/\bcider\b/.test(n)) return 'cider';
  if (/\bbeer\b|\blager\b/.test(n)) return 'beer';
  return 'spirits';
}

function tweCategoryLabel(family) {
  if (family === 'wine') return 'Wine';
  if (family === 'cider') return 'Cider';
  if (family === 'beer') return 'Beer';
  return 'Spirits';
}

function tweDefaultPack(name, family) {
  if (/miniature|\bmini\b|\b5cl\b|\b3cl\b/i.test(name)) return null;
  if (family === 'wine') return '750ml';
  return '70cl';
}

/**
 * @param {Array<{ id: string, name?: string }>} suppliers
 */
export function findTweSupplier(suppliers) {
  const list = (suppliers || []).filter((s) => s?.name);
  const exact = list.find((s) => /^(the\s+)?whisky\s+exchange$|^twe$/i.test(s.name.trim()));
  if (exact) return exact;
  return list.find((s) => /whisky\s*exchange|\btwe\b/i.test(s.name)) || null;
}

/**
 * @param {{ value?: string, data?: { otype?: string, oid?: string|number } }} row
 */
export function normaliseTweSuggestion(row) {
  const data = row?.data || {};
  if (String(data.otype || '').toLowerCase() !== 'product') return null;
  const name = String(row?.value || '').trim();
  const oid = String(data.oid || '').trim();
  if (!name || !oid) return null;

  const family = tweFamily(name);
  const parsedPack = inferPackLabel({ name, unitSize: '', container: '' });
  const unitSize = parsedPack || tweDefaultPack(name, family) || '';
  const slug = slugifyTweName(name);

  return {
    id: `twe-${oid}`,
    name,
    sku: oid,
    url: `${TWE_ORIGIN}/p/${encodeURIComponent(oid)}${slug ? `/${slug}` : ''}`,
    brand: name.split(/\s+\/\s+/)[0].split(/\s+/).slice(0, 2).join(' '),
    productCategory: tweCategoryLabel(family),
    productType: '',
    categoryPath: family === 'wine' ? '/wine' : '/spirits',
    unitSize,
    abv: '',
    container: 'Glass Bottle',
    image: `${TWE_IMG_ORIGIN}/80/${encodeURIComponent(oid)}.jpg`,
    source: 'twe',
    sourceLabel: 'TWE',
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
 */
export async function searchTweCatalog(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || SEARCH_LIMIT, 1), SEARCH_LIMIT);

  const { base, key } = edgeHeaders();
  if (!base || !key) throw new Error('Cloud not configured');

  const url = `${base}/functions/v1/twe-catalog-search?q=${encodeURIComponent(q)}&n=${limit}`;
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
    throw new Error(`TWE search failed (${res.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json();
  if (data?.error && !Array.isArray(data?.results)) {
    throw new Error(String(data.error));
  }
  const hits = (data?.results || [])
    .map((row) => (row?.name ? { ...row, source: 'twe', sourceLabel: 'TWE' } : normaliseTweSuggestion(row)))
    .filter((row) => row?.name);
  return rankLwcHits(hits, q).slice(0, SEARCH_LIMIT);
}
