/**
 * Sales, revenue & GP and headline figures from till imports, recon and
 * the planned menu. Pure functions — the Reports panel loads the data.
 *
 * Till money is VAT-inclusive (gross) and ex-VAT (net) as exported by
 * Square. Actual cost of sales is recon consumption × stock cost, so
 * actual GP = net sales − consumption cost.
 */

import { menuTotals } from './planning-menu.js';
import { plannedCases, plannedProductCases } from './order-compare.js';
import { portionOf } from './menu-serves.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Location, date and range filters. Rows without a date are dropped when a date range is set. */
export function filterSales(rows, { from = '', to = '', location = '' } = {}) {
  let undated = 0;
  const out = (rows || []).filter((r) => {
    if (location && (r.location || '') !== location) return false;
    if (from || to) {
      if (!r.sale_date) { undated += 1; return false; }
      if (from && r.sale_date < from) return false;
      if (to && r.sale_date > to) return false;
    }
    return true;
  });
  return { rows: out, undated };
}

export function salesTotals(rows) {
  const t = { items: 0, net: 0, gross: 0, lines: 0 };
  const locations = new Set();
  const days = new Set();
  (rows || []).forEach((r) => {
    t.items += Number(r.items_sold) || 0;
    t.net += Number(r.net_sales) || 0;
    t.gross += Number(r.gross_sales) || 0;
    t.lines += 1;
    if (r.location) locations.add(r.location);
    if (r.sale_date) days.add(r.sale_date);
  });
  return {
    items: t.items,
    net: money(t.net),
    gross: money(t.gross),
    lines: t.lines,
    avgGrossPerItem: t.items > 0 ? money(t.gross / t.items) : null,
    locations: [...locations].sort((a, b) => a.localeCompare(b)),
    days: [...days].sort(),
  };
}

function groupKey(r, by) {
  switch (by) {
    case 'category': return { key: r.category || '', label: r.category || 'Uncategorised' };
    case 'location': return { key: r.location || '', label: r.location || 'No location' };
    case 'date': return { key: r.sale_date || '', label: r.sale_date || 'No date' };
    case 'event': return { key: r.event_id || '', label: r.event_name || 'Event' };
    default: {
      const v = r.variation && r.variation.toLowerCase() !== 'regular' ? r.variation : '';
      return { key: `${r.name}\u0001${r.variation || ''}`, label: v ? `${r.name} · ${v}` : r.name, sub: r.category || '' };
    }
  }
}

/**
 * Group sales rows. Dates and events sort chronologically, everything else
 * by net sales (highest first). `share` is % of total net.
 */
export function groupSales(rows, by = 'item') {
  const groups = new Map();
  let totalNet = 0;
  (rows || []).forEach((r) => {
    const { key, label, sub } = groupKey(r, by);
    let g = groups.get(key);
    if (!g) {
      g = { key, label, sub: sub || '', items: 0, net: 0, gross: 0, sortKey: by === 'event' ? (r.event_start || '') : key };
      groups.set(key, g);
    }
    g.items += Number(r.items_sold) || 0;
    g.net += Number(r.net_sales) || 0;
    g.gross += Number(r.gross_sales) || 0;
    totalNet += Number(r.net_sales) || 0;
  });
  const list = [...groups.values()].map((g) => ({
    ...g,
    net: money(g.net),
    gross: money(g.gross),
    share: totalNet > 0 ? Math.round((g.net / totalNet) * 1000) / 10 : null,
  }));
  if (by === 'date' || by === 'event') {
    list.sort((a, b) => String(a.sortKey || '\uffff').localeCompare(String(b.sortKey || '\uffff')));
  } else {
    list.sort((a, b) => b.net - a.net || a.label.localeCompare(b.label));
  }
  return list;
}

/** Recon totals that matter for revenue: consumption cost and PLU. */
export function reconCostTotals(reconRows) {
  let cost = 0;
  let priced = 0;
  let unpriced = 0;
  (reconRows || []).forEach((r) => {
    const consumption = Number(r.consumption) || 0;
    if (!(consumption > 0)) return;
    if (Number(r.rowPrice) > 0) {
      cost += Number(r.consumptionCharge) || 0;
      priced += 1;
    } else {
      unpriced += 1;
    }
  });
  return { cost: money(cost), priced, unpriced };
}

function forecastCasesFromLines(group, product, caseSizes) {
  const serves = (group || []).reduce((sum, line) => {
    const projected = num(line.projectedServes);
    if (!(projected > 0)) return sum;
    return sum + projected * portionOf(line);
  }, 0);
  const per = (group || []).find((line) => num(line.servesPerUnit) > 0);
  if (!(serves > 0) || !per) return { cases: null, source: null };
  return plannedCases(
    { included: true, projected_serves: serves },
    { projectedServes: serves, servesPerUnit: per.servesPerUnit },
    product,
    caseSizes,
    0,
  );
}

/**
 * Forecast (planned menu) vs actual (till + recon) for an event.
 * @param {{ lines: object[], items: Map<string, object>, products: Map<string, object>,
 *           caseSizes?: object[], reconRows: object[], tillRows: object[], targetGpPct?: number|null }} input
 */
export function revenueComparison({ lines = [], items = new Map(), products = new Map(), caseSizes = [], reconRows = [], tillRows = [], targetGpPct = null }) {
  const forecast = menuTotals(lines);
  const sales = salesTotals(tillRows);
  const costs = reconCostTotals(reconRows);
  const hasSales = sales.lines > 0;
  const hasCost = costs.priced > 0;
  const actualGp = hasSales && hasCost ? money(sales.net - costs.cost) : null;
  const actualGpPct = actualGp != null && sales.net > 0 ? (actualGp / sales.net) * 100 : null;

  const reconByPid = new Map((reconRows || []).map((r) => [r.pid, r]));
  const linesByPid = new Map();
  lines.filter((l) => l.included && l.productId).forEach((l) => {
    const list = linesByPid.get(l.productId) || [];
    list.push(l);
    linesByPid.set(l.productId, list);
  });
  const pids = new Set([...linesByPid.keys(), ...[...reconByPid.values()].filter((r) => (Number(r.consumption) || 0) > 0).map((r) => r.pid)]);

  const products_ = [...pids].map((pid) => {
    const group = linesByPid.get(pid) || [];
    const line = group[0] || null;
    const rec = reconByPid.get(pid) || null;
    const product = products.get(pid) || rec?.p || null;
    const stored = items.get(pid);
    const storedList = Array.isArray(stored) ? stored : (stored ? [stored] : []);
    const planned = storedList.length
      ? plannedProductCases(storedList, 0, product, caseSizes, 0)
      : forecastCasesFromLines(group, product, caseSizes);
    const pricedRows = group.filter((row) => row.costPerServe != null && row.projectedServes != null);
    const forecastCost = pricedRows.length
      ? money(pricedRows.reduce((sum, row) => sum + row.costPerServe * row.projectedServes, 0))
      : null;
    const forecastServes = group.length
      ? group.reduce((sum, row) => sum + (Number(row.projectedServes) || 0) * portionOf(row), 0)
      : null;
    const revenueRows = group.filter((row) => row.revenueNet != null);
    const forecastRevenueNet = revenueRows.length
      ? money(revenueRows.reduce((sum, row) => sum + Number(row.revenueNet), 0))
      : null;
    const mix = group.length > 1 ? menuTotals(group) : null;
    const actualCost = rec && Number(rec.rowPrice) > 0 ? money(rec.consumptionCharge) : null;
    const forecastUnits = planned.cases;
    const consumed = rec ? Number(rec.consumption) || 0 : null;
    return {
      productId: pid,
      name: line?.name || product?.name || 'Unknown',
      category: line?.category || product?.category?.name || 'Uncategorised',
      onMenu: !!line,
      forecastServes,
      forecastUnits,
      consumed,
      sold: rec ? Number(rec.plu) || 0 : null,
      unitsVariance: forecastUnits != null && consumed != null ? Math.round((consumed - forecastUnits) * 100) / 100 : null,
      forecastRevenueNet,
      forecastCost,
      actualCost,
      costVariance: forecastCost != null && actualCost != null ? money(actualCost - forecastCost) : null,
      forecastGpPct: mix?.gpPct ?? line?.gpPct ?? null,
    };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  return {
    forecast: {
      revenueNet: forecast.included ? forecast.revenueNet : null,
      revenueGross: forecast.included ? forecast.revenueGross : null,
      cost: forecast.included ? forecast.cost : null,
      gpAmount: forecast.included ? forecast.gpAmount : null,
      gpPct: forecast.gpPct,
      linesPriced: forecast.included,
      linesMissing: forecast.excluded,
    },
    actual: {
      revenueNet: hasSales ? sales.net : null,
      revenueGross: hasSales ? sales.gross : null,
      cost: hasCost ? costs.cost : null,
      gpAmount: actualGp,
      gpPct: actualGpPct,
      unpricedProducts: costs.unpriced,
    },
    variance: {
      revenueNet: hasSales && forecast.included ? money(sales.net - forecast.revenueNet) : null,
      revenuePct: hasSales && forecast.revenueNet > 0 ? ((sales.net - forecast.revenueNet) / forecast.revenueNet) * 100 : null,
      gpPts: actualGpPct != null && forecast.gpPct != null ? actualGpPct - forecast.gpPct : null,
    },
    targetGpPct: num(targetGpPct),
    products: products_,
  };
}

/** Headline KPIs for an event (Peep Headlines). */
export function eventHeadlines({ tillRows = [], comparison = null, topN = 10 }) {
  const totals = salesTotals(tillRows);
  const top = groupSales(tillRows, 'item').slice(0, topN);
  const byLocation = totals.locations.length ? groupSales(tillRows, 'location') : [];
  const byDay = totals.days.length ? groupSales(tillRows, 'date') : [];
  const bestDay = byDay.length ? byDay.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  return {
    totals,
    top,
    byLocation,
    byDay,
    bestDay,
    topCategory: groupSales(tillRows, 'category')[0] || null,
    gpPct: comparison?.actual.gpPct ?? null,
    forecastGpPct: comparison?.forecast.gpPct ?? null,
    targetGpPct: comparison?.targetGpPct ?? null,
    forecastNet: comparison?.forecast.revenueNet ?? null,
    revenueVsForecastPct: comparison?.variance.revenuePct ?? null,
  };
}

/** Flatten multi-event till imports (for "by event") into rows with event fields. */
export function rowsWithEvents(imports) {
  const out = [];
  (imports || []).forEach((imp) => {
    const ev = imp.event || imp.events || {};
    (imp.rows || imp.till_sale_rows || []).forEach((r) => {
      out.push({ ...r, event_id: imp.event_id, event_name: ev.name || 'Event', event_start: ev.start_date || '' });
    });
  });
  return out;
}

export function salesCsv(groups, by) {
  const label = { item: 'Product', category: 'Category', location: 'Location', date: 'Date', event: 'Event' }[by] || 'Group';
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [label, ...(by === 'item' ? ['Category'] : []), 'Items sold', 'Net sales', 'Gross sales', 'Share of net %'];
  const lines = [head.map(esc).join(',')];
  groups.forEach((g) => {
    lines.push([g.label, ...(by === 'item' ? [g.sub] : []), g.items, g.net.toFixed(2), g.gross.toFixed(2), g.share ?? ''].map(esc).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
