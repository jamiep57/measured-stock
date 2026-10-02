/**
 * Parse Square sales exports. Accepts the Item Sales summary (one row per
 * item, event-wide) and the Item Details export (one row per sale, with
 * Date and Location / Device Name), which is aggregated per item, location
 * and day so reports can break sales down without storing every receipt.
 */

import { readSpreadsheetFile } from './spreadsheet-import.js';

function normCol(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function money2(v) {
  const n = parseFloat(String(v ?? '').replace(/[£$,\s]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function findCol(keys, aliases) {
  for (const alias of aliases) {
    const k = keys.find((key) => normCol(key) === alias);
    if (k) return k;
  }
  return null;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * ISO date (YYYY-MM-DD) from Square/Excel date cells. Slash dates are read
 * day-first (UK exports) unless that's impossible.
 */
export function parseSaleDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (b > 12 && a <= 12) [a, b] = [b, a];
    if (a < 1 || a > 31 || b < 1 || b > 12) return null;
    return `${year}-${pad(b)}-${pad(a)}`;
  }
  return null;
}

export function parseTillRows(raw) {
  if (!raw?.length) return [];
  const keys = Object.keys(raw[0]);
  const nameCol = findCol(keys, ['itemname', 'item', 'name', 'product', 'productname']);
  if (!nameCol) throw new Error('Could not find an "Item Name" column.');
  const varCol = findCol(keys, ['itemvariation', 'variation', 'variant', 'pricepointname']);
  const skuCol = findCol(keys, ['sku', 'skucode', 'code']);
  const catCol = findCol(keys, ['category', 'cat']);
  const qtyCol = findCol(keys, ['itemssold', 'sold', 'qtysold', 'quantitysold', 'qty', 'quantity', 'count']);
  const netCol = findCol(keys, ['netsales', 'net', 'netsalesgbp']);
  const grossCol = findCol(keys, ['grosssales', 'gross', 'total', 'grosssalesgbp']);
  const locCol = findCol(keys, ['location', 'locationname', 'bar']) || findCol(keys, ['devicename', 'device']);
  const dateCol = findCol(keys, ['date', 'saledate', 'transactiondate']);

  const byKey = new Map();
  raw.forEach((r) => {
    const name = String(r[nameCol] ?? '').trim();
    if (!name) return;
    const row = {
      name,
      variation: String(varCol ? r[varCol] ?? 'Regular' : 'Regular').trim() || 'Regular',
      sku: String(skuCol ? r[skuCol] ?? '' : '').trim().replace(/^"+|"+$/g, ''),
      category: String(catCol ? r[catCol] ?? '' : '').trim(),
      location: locCol ? String(r[locCol] ?? '').trim() || null : null,
      sale_date: dateCol ? parseSaleDate(r[dateCol]) : null,
      qty: parseFloat(qtyCol ? r[qtyCol] : 0) || 0,
      net_sales: money2(netCol ? r[netCol] : 0),
      gross_sales: money2(grossCol ? r[grossCol] : 0),
    };
    const key = [row.name, row.variation, row.sku, row.category, row.location || '', row.sale_date || ''].join('\u0001');
    const agg = byKey.get(key);
    if (agg) {
      agg.qty += row.qty;
      agg.net_sales += row.net_sales;
      agg.gross_sales += row.gross_sales;
    } else {
      byKey.set(key, row);
    }
  });

  return [...byKey.values()]
    .map(({ qty, ...r }) => ({
      ...r,
      items_sold: Math.round(qty),
      net_sales: Math.round(r.net_sales * 100) / 100,
      gross_sales: Math.round(r.gross_sales * 100) / 100,
    }))
    .filter((r) => r.items_sold > 0);
}

/** One row per till item (summing locations/days) for the recipe-mapping grid. */
export function mergeTillRowsByItem(rows) {
  const byKey = new Map();
  (rows || []).forEach((r) => {
    const key = `${r.name}\u0001${r.variation || 'Regular'}`;
    const agg = byKey.get(key);
    if (agg) {
      agg.items_sold = (Number(agg.items_sold) || 0) + (Number(r.items_sold) || 0);
      agg.net_sales = (Number(agg.net_sales) || 0) + (Number(r.net_sales) || 0);
      agg.gross_sales = (Number(agg.gross_sales) || 0) + (Number(r.gross_sales) || 0);
    } else {
      byKey.set(key, { ...r });
    }
  });
  return [...byKey.values()];
}

export async function readTillFile(file) {
  return parseTillRows(await readSpreadsheetFile(file));
}
