/**
 * Choose which sales feed projections and recon read.
 * The CSV tables are never rewritten from here.
 */

import { saleDateLondon } from '../../../lib/square/map-order.js';

export function squareLinesToFeeds(lines) {
  const tillRows = [];
  const modifierRows = [];
  for (const line of lines || []) {
    if (line?.kind === 'modifier') {
      modifierRows.push({
        modifier_set: line.modifier_set || null,
        modifier: line.modifier || line.name,
        qty_sold: Number(line.qty_sold) || 0,
        net_sales: Number(line.net_sales) || 0,
        location: line.location || null,
        sale_date: line.sale_date || null,
      });
    } else if (line?.kind === 'item' || line?.name) {
      tillRows.push({
        name: line.name,
        variation: line.variation || 'Regular',
        sku: line.sku || null,
        category: line.category || null,
        items_sold: Number(line.items_sold) || 0,
        net_sales: Number(line.net_sales) || 0,
        gross_sales: Number(line.gross_sales) || 0,
        location: line.location || null,
        sale_date: line.sale_date || null,
      });
    }
  }
  return { tillRows, modifierRows };
}

export function pickSalesFeed(salesSource, csv, square) {
  if (salesSource === 'square') {
    return {
      source: 'square',
      tillRows: square?.tillRows || [],
      modifierRows: square?.modifierRows || [],
    };
  }
  return {
    source: 'csv',
    tillRows: csv?.tillRows || [],
    modifierRows: csv?.modifierRows || [],
  };
}

/** Sum modifier rows that share a name and set, for the mapping grid. */
export function mergeModifierRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const modifier = String(row.modifier || row.name || '').trim();
    if (!modifier) continue;
    const set = row.modifier_set || '';
    const key = `${modifier.toLowerCase()}\u0001${String(set).toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        modifier,
        modifier_set: set || null,
        qty_sold: Number(row.qty_sold) || 0,
        net_sales: Number(row.net_sales) || 0,
      });
    } else {
      prev.qty_sold += Number(row.qty_sold) || 0;
      prev.net_sales += Number(row.net_sales) || 0;
    }
  }
  return [...map.values()];
}

const LINE_SELECT = [
  'kind', 'name', 'variation', 'sku', 'category',
  'items_sold', 'net_sales', 'gross_sales', 'location', 'sale_date',
  'modifier_set', 'modifier', 'qty_sold',
].join(',');

/**
 * Load both feeds. Callers that drive stock use `active`, which follows
 * events.sales_source and defaults to the CSV.
 */
export async function loadSalesBundle(DB, event) {
  const eventId = event?.id;
  const salesSource = event?.sales_source === 'square' ? 'square' : 'csv';
  const empty = { tillRows: [], modifierRows: [] };
  if (!eventId || !DB) {
    return {
      salesSource: 'csv',
      csv: empty,
      square: empty,
      active: empty,
      tillImport: null,
      modImport: null,
    };
  }
  const [tillImport, modImport, lines] = await Promise.all([
    DB.tillImports.forEvent(eventId).catch(() => null),
    DB.modifierImports.forEvent(eventId).catch(() => null),
    DB.select(
      'square_order_lines',
      `?event_id=eq.${encodeURIComponent(eventId)}&select=${LINE_SELECT}`,
    ).catch(() => []),
  ]);
  const csv = {
    tillRows: tillImport?.rows || [],
    modifierRows: modImport?.rows || [],
  };
  const square = squareLinesToFeeds(lines);
  return {
    salesSource,
    csv,
    square,
    active: pickSalesFeed(salesSource, csv, square),
    tillImport,
    modImport,
  };
}

/** Overlap orders for this event's locations and dates. They are not counted. */
export function unmatchedForEvent(orders, event, locationIds) {
  const start = event?.start_date;
  const end = event?.end_date || event?.start_date;
  if (!start || !end) return [];
  const ids = new Set(locationIds || []);
  return (orders || []).filter((order) => {
    if (order?.unmatched_reason !== 'overlap') return false;
    if (!ids.has(order.square_location_id)) return false;
    const day = saleDateLondon(order.closed_at);
    return Boolean(day && day >= start && day <= end);
  });
}
