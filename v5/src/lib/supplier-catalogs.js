/**
 * Combined LWC + The Whisky Exchange catalogue search for new-product typeahead.
 */

import {
  searchLwcCatalog,
  mapLwcHitToFields,
  findLwcSupplier,
  rankLwcHits,
} from './lwc-catalog.js';
import { searchTweCatalog, findTweSupplier } from './twe-catalog.js';

function tagSource(hits, source, sourceLabel) {
  return (hits || []).map((hit) => ({
    ...hit,
    source: hit.source || source,
    sourceLabel: hit.sourceLabel || sourceLabel,
  }));
}

async function settledSearch(fn, signal) {
  try {
    return await fn();
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    return [];
  }
}

/**
 * @param {string} query
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function searchSupplierCatalogs(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const signal = opts.signal;

  const [lwc, twe] = await Promise.all([
    settledSearch(() => searchLwcCatalog(q, opts), signal),
    settledSearch(() => searchTweCatalog(q, opts), signal),
  ]);

  const tagged = [
    ...tagSource(lwc, 'lwc', 'LWC'),
    ...tagSource(twe, 'twe', 'TWE'),
  ];
  return rankLwcHits(tagged, q).slice(0, 10);
}

/**
 * @param {object} hit
 * @param {{ categories?: object[], caseSizes?: object[], suppliers?: object[] }} [opts]
 */
export function mapCatalogHitToFields(hit, opts = {}) {
  const mapped = mapLwcHitToFields(hit, { ...opts, suppliers: [] });
  const source = hit?.source || 'lwc';
  const sourceLabel = hit?.sourceLabel || (source === 'twe' ? 'TWE' : 'LWC');
  const supplier = source === 'twe'
    ? findTweSupplier(opts.suppliers || [])
    : findLwcSupplier(opts.suppliers || []);
  return {
    ...mapped,
    source,
    sourceLabel,
    supplierId: supplier?.id || null,
    supplier,
  };
}
