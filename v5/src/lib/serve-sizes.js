/**
 * Serve sizes are one list for the whole organisation.
 * 330ml, pint and half are the pour, not the pack.
 */

import { getDB } from '../db.js';
import { serveKey } from './menu-serves.js';

/** How much of one serve this name uses. A half is 0.5, a double is 2. */
export function portionForSize(label) {
  const key = serveKey(label);
  if (key === 'half') return 0.5;
  if (key === 'double') return 2;
  return 1;
}

/**
 * Catalogue rows, plus the current label when it is not in the list yet.
 * @param {object[]} sizes
 * @param {string} [current]
 */
export function serveSizeChoices(sizes, current = '') {
  const rows = (sizes || [])
    .map((row) => ({
      label: String(row?.label || '').trim(),
      sort: Number(row?.sort_order) || 0,
    }))
    .filter((row) => row.label);
  rows.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  const options = [];
  const seen = new Set();
  rows.forEach((row) => {
    const key = serveKey(row.label);
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ label: row.label, current: false });
  });
  const cur = String(current || '').trim();
  if (!cur) return options;
  const hit = options.find((option) => serveKey(option.label) === serveKey(cur));
  if (hit) hit.current = true;
  else options.unshift({ label: cur, current: true });
  return options;
}

export function mergeServeSize(sizes, row) {
  if (!row?.label) return sizes || [];
  const list = [...(sizes || [])];
  const index = list.findIndex((item) => serveKey(item.label) === serveKey(row.label));
  if (index >= 0) list[index] = { ...list[index], ...row };
  else list.push(row);
  return list;
}

/** Add a size to the shared list. An existing name is reused. */
export async function createServeSize(label, existing = []) {
  const name = String(label || '').trim();
  if (!name || name.length > 40) throw new Error('Size must be 1–40 characters');
  const found = (existing || []).find((row) => serveKey(row.label) === serveKey(name));
  if (found) return found;
  const sort = (existing || []).reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 10;
  const DB = getDB();
  try {
    const row = await DB.serveSizes.create({ label: name, sort_order: sort });
    if (!row?.id) throw new Error('Could not add that size');
    return row;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/duplicate|unique|serve_sizes_org_label/i.test(msg)) {
      const rows = await DB.serveSizes.list();
      const again = (rows || []).find((row) => serveKey(row.label) === serveKey(name));
      if (again) return again;
    }
    throw err;
  }
}
