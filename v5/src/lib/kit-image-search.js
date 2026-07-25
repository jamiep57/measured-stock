/**
 * Kit photo search — web image results via Supabase edge function
 * (DuckDuckGo/Bing-backed; Google Custom Search is closed to new API customers).
 * Falls back to Openverse if the edge function is unavailable.
 */

import { getDB } from '../db.js';

const OPENVERSE_URL = 'https://api.openverse.org/v1/images/';
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const IMAGE_MIME = /^(image\/(jpeg|png|webp|gif)|application\/octet-stream)/i;

/**
 * Build a search query from kit name + category.
 * Prefer the item name alone; only append category when name is short.
 * @param {string} name
 * @param {string} [category]
 */
export function buildKitImageQuery(name, category) {
  const n = String(name || '').trim().replace(/[/|_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const c = String(category || '').trim();
  if (!n) return c;
  if (!c) return n;
  if (n.toLowerCase().includes(c.toLowerCase())) return n;
  // Long / specific kit names search better without the category tacked on
  if (n.split(/\s+/).length >= 3) return n;
  return `${n} ${c}`;
}

/**
 * @param {string} query
 * @param {{ pageSize?: number }} [opts]
 * @returns {Promise<Array<{ id: string, title: string, thumb: string, url: string, attribution: string, source: string }>>}
 */
export async function searchKitImages(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 12, 1), 20);

  try {
    const hits = await searchViaEdge(q, pageSize);
    if (hits.length) return hits;
  } catch {
    // fall through to Openverse
  }

  return searchViaOpenverse(q, pageSize);
}

async function searchViaEdge(query, pageSize) {
  const DB = getDB();
  if (typeof DB.init === 'function') DB.init();
  const base = String(DB.config?.url || '').replace(/\/$/, '');
  const key = DB.config?.key || '';
  if (!base || !key) throw new Error('Cloud not configured');

  const url = `${base}/functions/v1/kit-image-search?q=${encodeURIComponent(query)}&n=${pageSize}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Image search failed (${res.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json();
  if (data?.error && !Array.isArray(data?.results)) {
    throw new Error(String(data.error));
  }
  return normaliseHits(data?.results || [], pageSize);
}

async function searchViaOpenverse(query, pageSize) {
  const variants = openverseVariants(query);
  for (const q of variants) {
    const url = new URL(OPENVERSE_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('page_size', String(pageSize));
    url.searchParams.set('page', '1');
    url.searchParams.set('mature', 'false');
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) continue;
    const data = await res.json();
    const hits = normaliseHits(
      (data?.results || []).map((r) => ({
        id: r.id,
        title: r.title,
        thumb: r.thumbnail || r.url,
        url: r.url || r.thumbnail,
        attribution: r.attribution,
        source: r.source || r.provider,
        filetype: r.filetype,
      })),
      pageSize,
    );
    if (hits.length) return hits;
  }
  return [];
}

function openverseVariants(query) {
  const base = String(query || '').replace(/[/|_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return [];
  const parts = base.split(' ').filter(Boolean);
  const out = [base];
  if (parts.length > 4) out.push(parts.slice(0, 4).join(' '));
  if (parts.length > 2) out.push(parts.slice(0, 2).join(' '));
  return [...new Set(out)].slice(0, 3);
}

function normaliseHits(rows, pageSize) {
  return (rows || [])
    .map((r) => {
      const full = String(r.url || '').trim();
      const thumb = String(r.thumb || r.thumbnail || full).trim();
      if (!full && !thumb) return null;
      const ft = String(r.filetype || '').toLowerCase();
      if (ft && !['jpg', 'jpeg', 'png', 'webp', 'gif', ''].includes(ft)) return null;
      if (full && /\.(pdf|svg|tif{1,2})(\?|$)/i.test(full)) return null;
      return {
        id: String(r.id || full),
        title: String(r.title || 'Image').trim() || 'Image',
        thumb: thumb || full,
        url: full || thumb,
        attribution: String(r.attribution || '').trim(),
        source: String(r.source || '').trim(),
      };
    })
    .filter(Boolean)
    .slice(0, pageSize);
}

/**
 * Download a remote image for upload to product storage.
 * Tries direct fetch, then the edge proxy when CORS blocks.
 * @param {string} imageUrl
 * @param {string} [basename]
 * @returns {Promise<File | null>}
 */
export async function downloadKitImageFile(imageUrl, basename = 'kit') {
  const src = String(imageUrl || '').trim();
  if (!src) return null;

  let blob = await tryFetchBlob(src);
  if (!blob) blob = await tryFetchBlobViaEdge(src);
  if (!blob || blob.size < 32) return null;

  const type = blob.type && IMAGE_MIME.test(blob.type)
    ? (blob.type === 'application/octet-stream' ? 'image/jpeg' : blob.type)
    : guessMimeFromUrl(src);
  if (!type.startsWith('image/')) return null;
  const ext = type.includes('png') ? 'png'
    : type.includes('webp') ? 'webp'
      : type.includes('gif') ? 'gif'
        : 'jpg';
  const safe = String(basename || 'kit').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'kit';
  return new File([blob], `${safe}.${ext}`, { type });
}

async function tryFetchBlob(src) {
  try {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob?.size >= 32 ? blob : null;
  } catch {
    return null;
  }
}

async function tryFetchBlobViaEdge(src) {
  try {
    const DB = getDB();
    if (typeof DB.init === 'function') DB.init();
    const base = String(DB.config?.url || '').replace(/\/$/, '');
    const key = DB.config?.key || '';
    if (!base || !key) return null;
    const url = `${base}/functions/v1/kit-image-search?fetch=${encodeURIComponent(src)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.startsWith('image/')) return null;
    const blob = await res.blob();
    return blob?.size >= 32 ? blob : null;
  } catch {
    return null;
  }
}

function guessMimeFromUrl(url) {
  const u = url.toLowerCase();
  if (u.includes('.png')) return 'image/png';
  if (u.includes('.webp')) return 'image/webp';
  if (u.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Search for one image and return a File (or remote URL fallback).
 * @param {{ name?: string, category?: { name?: string } | null }} product
 * @returns {Promise<{ file: File | null, remoteUrl: string | null, title: string } | null>}
 */
export async function findKitImageCandidate(product) {
  const q = buildKitImageQuery(product?.name || '', product?.category?.name || '');
  if (!q) return null;
  const hits = await searchKitImages(q, { pageSize: 6 });
  const hit = hits[0];
  if (!hit) return null;
  const file = await downloadKitImageFile(hit.url, product?.name || 'kit');
  return {
    file,
    remoteUrl: file ? null : (hit.url || null),
    title: hit.title || '',
  };
}
