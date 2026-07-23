/** Parse Square Modifier Sales export (CSV / TSV / XLSX via SheetJS). */

import { readSpreadsheetFile } from './spreadsheet-import.js';

function normCol(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function money2(v) {
  const n = parseFloat(String(v ?? '').replace(/[£$,\s]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function findCol(keys, aliases) {
  for (const k of keys) {
    if (aliases.includes(normCol(k))) return k;
  }
  return null;
}

export function parseModifierRows(raw) {
  if (!raw?.length) return [];
  const keys = Object.keys(raw[0]);
  const modCol = findCol(keys, ['modifier', 'modifiername', 'name']);
  if (!modCol) throw new Error('Could not find a "Modifier" column.');
  const setCol = findCol(keys, ['modifierset', 'set']);
  const qtyCol = findCol(keys, ['netqtysold', 'qtysold', 'qty', 'quantitysold', 'quantity', 'sold', 'count']);
  const netCol = findCol(keys, ['netsales', 'net', 'netsalesgbp', 'sales']);

  return raw.map((r) => {
    const modifier = String(r[modCol] ?? '').trim();
    if (!modifier) return null;
    return {
      modifier_set: String(setCol ? r[setCol] ?? '' : '').trim(),
      modifier,
      qty_sold: Math.round(parseFloat(qtyCol ? r[qtyCol] : 0) || 0),
      net_sales: money2(netCol ? r[netCol] : 0),
    };
  }).filter(Boolean).filter((r) => r.qty_sold > 0);
}

export async function readModifierFile(file) {
  return parseModifierRows(await readSpreadsheetFile(file));
}
