/** Parse Square Item Sales export. */

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

export function parseTillRows(raw) {
  if (!raw?.length) return [];
  const keys = Object.keys(raw[0]);
  const nameCol = findCol(keys, ['itemname', 'name', 'product', 'productname']);
  if (!nameCol) throw new Error('Could not find an "Item Name" column.');
  const varCol = findCol(keys, ['itemvariation', 'variation', 'variant']);
  const skuCol = findCol(keys, ['sku', 'skucode', 'code']);
  const catCol = findCol(keys, ['category', 'cat']);
  const qtyCol = findCol(keys, ['itemssold', 'sold', 'qtysold', 'quantitysold', 'qty', 'count']);
  const netCol = findCol(keys, ['netsales', 'net', 'netsalesgbp']);
  const grossCol = findCol(keys, ['grosssales', 'gross', 'total', 'grosssalesgbp']);

  return raw.map((r) => {
    const name = String(r[nameCol] ?? '').trim();
    if (!name) return null;
    return {
      name,
      variation: String(varCol ? r[varCol] ?? 'Regular' : 'Regular').trim() || 'Regular',
      sku: String(skuCol ? r[skuCol] ?? '' : '').trim().replace(/^"+|"+$/g, ''),
      category: String(catCol ? r[catCol] ?? '' : '').trim(),
      items_sold: Math.round(parseFloat(qtyCol ? r[qtyCol] : 0) || 0),
      net_sales: money2(netCol ? r[netCol] : 0),
      gross_sales: money2(grossCol ? r[grossCol] : 0),
    };
  }).filter(Boolean).filter((r) => r.items_sold > 0);
}

export async function readTillFile(file) {
  return parseTillRows(await readSpreadsheetFile(file));
}
