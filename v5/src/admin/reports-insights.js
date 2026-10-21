/**
 * Reports → Headlines, Sales, Revenue & GP and Loose stock.
 *
 * Driven by the Reports panel, which owns event / till / recon data. This
 * module loads the extra planning and loose-stock data it needs, renders
 * the four views and handles their edits and exports.
 */

import { escapeHtml, toast } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { emptyState } from '../components/empty-state.js';
import { loadLibraryProducts } from '../db.js';
import { isOrgAdmin } from '../lib/organisations.js';
import { computeReconRows } from '../lib/recon.js';
import { formatGpPct, gpStatus } from '../lib/gp.js';
import { parsePlanningNumber, resolveMenuLine } from '../lib/planning-menu.js';
import { baseMenuItem, groupMenuItems } from '../lib/menu-serves.js';
import { resolveCocktailLine } from '../lib/menu-cocktails.js';
import { isCocktailSchemaMissing, listEventCocktails, listEventMenu, loadEventPricing } from '../lib/planning-data.js';
import {
  eventHeadlines, filterSales, groupSales, revenueComparison, rowsWithEvents, salesCsv, salesTotals,
} from '../lib/sales-report.js';
import { computeLooseStock } from '../lib/loose-stock.js';
import {
  isLooseSchemaMissing, listLooseAllowances, listSalesAllEvents, saveLooseAllowance,
} from '../lib/reports-data.js';
import { downloadBlob } from './planning-export.js';

export const INSIGHT_KINDS = ['headlines', 'sales', 'revenue', 'loose'];

const fmtMoney = (n) => (n == null || !Number.isFinite(Number(n))
  ? '—'
  : `${Number(n) < 0 ? '−' : ''}£${Math.abs(Number(n)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtNum = (n, dp = 0) => (n == null || !Number.isFinite(Number(n))
  ? '—'
  : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: dp }));
const fmtSigned = (n, fmt) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`);
const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

function gpBadge(gp, target, band = 5) {
  const status = gpStatus(gp, target, band);
  const cls = status === 'green' ? 'lta-ok' : status === 'amber' ? 'plan-gp--amber' : status === 'red' ? 'lta-over' : 'lta-neutral';
  return `<span class="lta-badge plan-gp ${cls}">${escapeHtml(formatGpPct(gp))}</span>`;
}

function kpi(label, value, sub = '') {
  return `<div class="plan-kpi"><span class="plan-kpi-label">${escapeHtml(label)}</span>
    <span class="plan-kpi-value">${value}</span>${sub ? `<span class="plan-kpi-sub muted">${sub}</span>` : ''}</div>`;
}

function varianceClass(n, goodWhenPositive = true) {
  if (n == null || Math.abs(n) < 0.005) return '';
  return (n > 0) === goodWhenPositive ? 'rpt-good' : 'rpt-bad';
}

function shareCell(share) {
  return `<span class="rpt-share"><span style="width:${Math.min(100, Math.max(0, share || 0))}%"></span></span>${fmtPct(share)}`;
}

const CHART_COLORS = ['#b45309', '#18181b', '#a16207', '#57534e', '#d97706', '#78716c', '#44403c', '#ca8a04'];

function chartSlices(list, max = 6) {
  const ranked = (list || []).filter((g) => g.net > 0);
  const head = ranked.slice(0, max);
  const rest = ranked.slice(max);
  const rows = rest.length
    ? [...head, {
      label: 'Other',
      net: Math.round(rest.reduce((sum, g) => sum + g.net, 0) * 100) / 100,
    }]
    : head;
  const total = rows.reduce((sum, g) => sum + g.net, 0);
  let cursor = 0;
  return rows.map((g, i) => {
    const pct = total > 0 ? (g.net / total) * 100 : 0;
    const start = cursor;
    cursor += pct;
    return { ...g, pct, start, color: CHART_COLORS[i % CHART_COLORS.length] };
  });
}

function donutStyle(slices) {
  if (slices.length <= 1) return `background:${slices[0]?.color || '#e4e4e7'}`;
  const gap = 0.45;
  const stops = [];
  slices.forEach((s) => {
    const end = s.start + s.pct;
    const cut = s.pct > gap * 3 ? gap : 0;
    stops.push(`${s.color} ${s.start.toFixed(2)}% ${(end - cut).toFixed(2)}%`);
    if (cut) stops.push(`var(--card) ${(end - cut).toFixed(2)}% ${end.toFixed(2)}%`);
  });
  return `background:conic-gradient(${stops.join(',')})`;
}

function fmtCompact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1000000) return `${sign}£${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}m`;
  if (abs >= 10000) return `${sign}£${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(1)}k`;
  return fmtMoney(v);
}

function fmtAxis(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function hbars(rows, { valueOf, format }) {
  const peak = Math.max(...rows.map((g) => valueOf(g)), 0);
  return rows.map((g, i) => {
    const value = valueOf(g);
    const width = peak > 0 ? Math.max(value > 0 ? 2 : 0, (value / peak) * 100) : 0;
    return `<div class="rpt-hbar">
      <span class="rpt-hbar-name" title="${escapeHtml(g.label)} · ${fmtMoney(g.net)}">${escapeHtml(g.label)}</span>
      <span class="rpt-hbar-track"><span class="rpt-hbar-fill${i === 0 ? ' is-lead' : ''}" style="width:${width.toFixed(1)}%"></span></span>
      <span class="rpt-hbar-val">${format(g)}</span>
    </div>`;
  }).join('');
}

function renderCategoryMix(categories) {
  const slices = chartSlices(categories, 6);
  if (!slices.length) return '';
  const lead = slices[0];
  const leadPct = fmtPct(lead.share ?? lead.pct);
  return `<section class="admin-surface rpt-viz-card">
    <div class="rpt-viz-head">
      <h3 class="rpt-card-title">Category mix</h3>
      <span class="rpt-viz-sub">Share of net</span>
    </div>
    <div class="rpt-mix">
      <div class="rpt-donut" style="${donutStyle(slices)}" role="img" aria-label="${escapeHtml(lead.label)}, ${leadPct} of net sales">
        <div class="rpt-donut-hole">
          <span class="rpt-donut-pct">${leadPct}</span>
          <span class="rpt-donut-name">${escapeHtml(lead.label)}</span>
        </div>
      </div>
      <div class="rpt-legend">
        ${slices.map((s) => `<div class="rpt-legend-row">
          <span class="rpt-swatch" style="background:${s.color}"></span>
          <span class="rpt-legend-name" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
          <span class="rpt-legend-money">${fmtMoney(s.net)}</span>
          <span class="rpt-legend-pct">${fmtPct(s.share ?? s.pct)}</span>
        </div>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderProductBars(top) {
  const rows = (top || []).filter((g) => g.net > 0).slice(0, 8);
  if (!rows.length) return '';
  return `<section class="admin-surface rpt-viz-card">
    <div class="rpt-viz-head">
      <h3 class="rpt-card-title">Top products</h3>
      <span class="rpt-viz-sub">Share of net</span>
    </div>
    <div class="rpt-hbars">${hbars(rows, { valueOf: (g) => Number(g.share) || 0, format: (g) => fmtPct(g.share) })}</div>
  </section>`;
}

function renderDayChart(h) {
  const days = (h.byDay || []).filter((g) => g.key && g.net > 0);
  if (days.length < 2) return '';
  const peak = Math.max(...days.map((g) => g.net));
  const best = days.reduce((a, b) => (b.net > a.net ? b : a));
  const showEvery = days.length <= 12;
  const step = showEvery ? 1 : Math.ceil(days.length / 8);
  const cols = days.map((g, i) => {
    const height = peak > 0 ? Math.max(4, (g.net / peak) * 100) : 0;
    const isBest = g.key === best.key;
    const showLabel = showEvery || i % step === 0 || i === days.length - 1 || isBest;
    const showVal = showEvery || isBest;
    return `<div class="rpt-col${isBest ? ' is-best' : ''}" title="${escapeHtml(fmtDate(g.key))} · ${fmtMoney(g.net)} net">
      <span class="rpt-col-val">${showVal ? fmtCompact(g.net) : ''}</span>
      <div class="rpt-col-plot"><span class="rpt-col-bar" style="height:${height.toFixed(1)}%"></span></div>
      <span class="rpt-col-label">${showLabel ? escapeHtml(fmtAxis(g.key)) : ''}</span>
    </div>`;
  }).join('');
  return `<section class="admin-surface rpt-viz-card rpt-viz-card--wide">
    <div class="rpt-viz-head">
      <h3 class="rpt-card-title">Sales by day</h3>
      <span class="rpt-viz-sub">Best ${escapeHtml(fmtDate(best.key))} · ${fmtMoney(best.net)} net</span>
    </div>
    <div class="rpt-cols-scroll"><div class="rpt-cols" style="--rpt-cols:${days.length}">${cols}</div></div>
  </section>`;
}

function renderLocationBars(h) {
  const rows = (h.byLocation || []).filter((g) => g.key && g.net > 0).slice(0, 8);
  if (rows.length < 2) return '';
  return `<section class="admin-surface rpt-viz-card">
    <div class="rpt-viz-head">
      <h3 class="rpt-card-title">By location</h3>
      <span class="rpt-viz-sub">Share of net</span>
    </div>
    <div class="rpt-hbars">${hbars(rows, { valueOf: (g) => g.net, format: (g) => fmtPct(g.share) })}</div>
  </section>`;
}

function renderForecastBars(h) {
  if (h.forecastNet == null) return '';
  const actual = Number(h.totals.net) || 0;
  const forecast = Number(h.forecastNet) || 0;
  const peak = Math.max(actual, forecast, 1);
  const bar = (label, value, lead) => {
    const width = Math.max(value > 0 ? 2 : 0, (value / peak) * 100);
    return `<div class="rpt-hbar">
      <span class="rpt-hbar-name">${label}</span>
      <span class="rpt-hbar-track"><span class="rpt-hbar-fill${lead ? ' is-lead' : ''}" style="width:${width.toFixed(1)}%"></span></span>
      <span class="rpt-hbar-val">${fmtMoney(value)}</span>
    </div>`;
  };
  const vs = h.revenueVsForecastPct;
  const vsHtml = vs == null ? '' : `<span class="${varianceClass(vs)}">${fmtSigned(vs, (n) => `${n.toFixed(1)}%`)}</span>`;
  return `<div class="rpt-forecast">
    <div class="rpt-viz-head"><h4 class="rpt-card-title">Forecast vs actual</h4>${vsHtml}</div>
    <div class="rpt-hbars">${bar('Forecast', forecast, false)}${bar('Actual', actual, true)}</div>
  </div>`;
}

function renderShape(h, band) {
  const gross = Number(h.totals.gross) || 0;
  const net = Number(h.totals.net) || 0;
  const vat = Math.round((gross - net) * 100) / 100;
  const showVat = gross > 0 && vat > 0.5;
  const gp = h.gpPct;
  const target = h.targetGpPct;
  const tone = gp != null ? gpStatus(gp, target, band ?? 5) : null;
  const toneClass = tone === 'green' ? 'is-ok' : tone === 'amber' ? 'is-warn' : tone === 'red' ? 'is-bad' : '';
  const topShare = (h.top || []).reduce((sum, g) => sum + (Number(g.share) || 0), 0);
  const forecast = renderForecastBars(h);
  if (gp == null && !showVat && !(h.top || []).length && !forecast) return '';
  const title = gp != null ? 'Gross profit' : (forecast ? 'Against forecast' : 'Sales split');
  const netPct = showVat ? (net / gross) * 100 : 0;
  return `<section class="admin-surface rpt-viz-card">
    <div class="rpt-viz-head">
      <h3 class="rpt-card-title">${title}</h3>
      <span class="rpt-viz-sub">${gp != null ? 'Of net sales' : 'Inc VAT'}</span>
    </div>
    <div class="rpt-glance">
      ${gp != null ? `<div class="rpt-glance-gp">
        <span class="rpt-glance-figure ${toneClass}">${escapeHtml(formatGpPct(gp))}</span>
        <div class="rpt-meter" aria-hidden="true">
          <span class="rpt-meter-fill ${toneClass}" style="width:${Math.max(0, Math.min(100, gp)).toFixed(1)}%"></span>
          ${target != null ? `<span class="rpt-meter-tick" style="left:${Math.max(0, Math.min(100, target)).toFixed(1)}%"></span>` : ''}
        </div>
        <span class="rpt-viz-sub">${target != null ? `Target ${fmtPct(target)}` : 'No GP target set'}</span>
      </div>` : ''}
      ${showVat ? `<div class="rpt-split">
        <div class="rpt-split-bar" role="img" aria-label="Net ${fmtPct(netPct)} of gross, VAT ${fmtPct(100 - netPct)}">
          <span class="rpt-split-net" style="width:${netPct.toFixed(2)}%"></span>
          <span class="rpt-split-vat" style="width:${(100 - netPct).toFixed(2)}%"></span>
        </div>
        <div class="rpt-split-key">
          <span><i class="rpt-swatch rpt-swatch--net"></i>Net ${fmtMoney(net)}</span>
          <span><i class="rpt-swatch rpt-swatch--vat"></i>VAT ${fmtMoney(vat)}</span>
        </div>
      </div>` : ''}
      ${(h.top || []).length ? `<p class="rpt-glance-note">Top ${h.top.length} products are <strong>${fmtPct(topShare)}</strong> of net sales.</p>` : ''}
      ${forecast}
    </div>
  </section>`;
}

function renderHeadlinesViz(h, band) {
  const mix = renderCategoryMix(h.categories);
  const products = renderProductBars(h.top);
  const days = renderDayChart(h);
  const locations = renderLocationBars(h);
  const shape = locations ? '' : renderShape(h, band);
  const top = [mix, products, locations, shape].filter(Boolean);
  if (!top.length && !days) return '';
  const cols = Math.min(top.length, 3);
  return `<div class="rpt-viz rpt-viz--${cols}${days ? ' rpt-viz--days' : ''}">${top.join('')}${days}</div>`;
}

/**
 * @param {{ getBase: () => object, onChange: () => void }} opts
 *   getBase returns the Reports panel ctx (eventId, event, tillRows, recon inputs…)
 */
export function createReportInsights({ getBase, onChange }) {
  const state = {
    menu: null,
    menuError: null,
    menuLoading: false,
    allowances: [],
    looseLoaded: false,
    looseError: null,
    looseLoading: false,
    allEvents: null,
    allEventsLoading: false,
    reconKey: null,
    reconRows: [],
  };

  function reconRows() {
    const b = getBase();
    const key = [b.event, b.closingRows, b.tillRows, b.modifierRows, b.recipes, b.deliveries, b.transfers, b.wastageBatches, b.supplierReturns, b.cocktails, b.menuItems];
    if (state.reconKey && key.every((v, i) => v === state.reconKey[i])) return state.reconRows;
    state.reconKey = key;
    state.reconRows = b.event ? computeReconRows({
      event: b.event,
      closingRows: b.closingRows,
      tillRows: b.tillRows,
      modifierRows: b.modifierRows,
      recipes: b.recipes,
      products: b.products,
      caseSizes: b.caseSizes,
      suppliers: b.suppliers,
      wastageBatches: b.wastageBatches,
      transfers: b.transfers,
      supplierReturns: b.supplierReturns,
      deliveries: b.deliveries,
      showHidden: false,
      drafts: {},
      cocktails: b.cocktails,
      menuItems: b.menuItems,
    }) : [];
    return state.reconRows;
  }

  async function loadMenu() {
    if (state.menu || state.menuLoading) return;
    state.menuLoading = true;
    const { eventId, caseSizes } = getBase();
    try {
      const [event, items, products, cocktails] = await Promise.all([
        loadEventPricing(eventId),
        listEventMenu(eventId),
        loadLibraryProducts(),
        listEventCocktails(eventId).catch((err) => (isCocktailSchemaMissing(err) ? [] : Promise.reject(err))),
      ]);
      const productById = new Map((products || []).map((p) => [p.id, p]));
      const grouped = groupMenuItems(items || []);
      const baseMap = new Map();
      grouped.forEach((list, pid) => {
        const base = baseMenuItem(list);
        if (base) baseMap.set(pid, { ...base, portion: 1 });
      });
      const lines = (items || []).map((item) => resolveMenuLine(item, {
        product: productById.get(item.product_id), event, caseSizes,
      }));
      (cocktails || []).forEach((cocktail) => {
        lines.push(resolveCocktailLine(cocktail, cocktail.ingredients, {
          productById, items: baseMap, caseSizes, event,
        }));
      });
      state.menu = {
        lines,
        items: grouped,
        products: productById,
        targetGpPct: event?.target_gp_pct ?? null,
        amberBand: event?.gp_amber_band ?? 5,
        yearLabel: null,
      };
    } catch (err) {
      state.menuError = err;
    } finally {
      state.menuLoading = false;
    }
  }

  async function loadLoose() {
    if (state.looseLoaded || state.looseLoading) return;
    state.looseLoading = true;
    const { eventId } = getBase();
    try {
      state.allowances = (await listLooseAllowances(eventId)) || [];
      state.looseLoaded = true;
    } catch (err) {
      state.looseError = err;
    } finally {
      state.looseLoading = false;
    }
  }

  async function loadAllEvents() {
    if (state.allEvents || state.allEventsLoading) return;
    state.allEventsLoading = true;
    try {
      state.allEvents = rowsWithEvents(await listSalesAllEvents());
    } catch (err) {
      toast(err.message || 'Could not load other events', true);
      state.allEvents = [];
    } finally {
      state.allEventsLoading = false;
    }
  }

  /** Load whatever `kind` needs, then repaint. */
  function ensure(kind, filters = {}) {
    const jobs = [];
    if ((kind === 'revenue' || kind === 'headlines') && !state.menu && !state.menuError && !state.menuLoading) jobs.push(loadMenu());
    if (kind === 'loose' && !state.looseLoaded && !state.looseError && !state.looseLoading && isOrgAdmin()) jobs.push(loadLoose());
    if (kind === 'sales' && filters.salesGroup === 'event' && !state.allEvents && !state.allEventsLoading) jobs.push(loadAllEvents());
    if (jobs.length) Promise.all(jobs).then(onChange);
  }

  function comparison() {
    const b = getBase();
    const m = state.menu;
    return revenueComparison({
      lines: m?.lines || [],
      items: m?.items || new Map(),
      products: m?.products || new Map(),
      caseSizes: b.caseSizes,
      reconRows: reconRows(),
      tillRows: b.tillRows,
      targetGpPct: m?.targetGpPct ?? null,
    });
  }

  function locations() {
    return salesTotals(getBase().tillRows).locations;
  }

  function filteredTill(filters) {
    return filterSales(getBase().tillRows, { from: filters.dateFrom, to: filters.dateTo, location: filters.location });
  }

  // ---------- headlines ---------------------------------------------

  function headlinesModel(filters) {
    const { rows, undated } = filteredTill(filters);
    const scoped = !!(filters.dateFrom || filters.dateTo || filters.location);
    const comp = state.menu && !scoped ? comparison() : null;
    return { h: eventHeadlines({ tillRows: rows, comparison: comp }), undated, scoped };
  }

  function groupTable(title, list, labelHead, opts = {}) {
    return `
      <section class="admin-surface rpt-card">
        <h3 class="rpt-card-title">${escapeHtml(title)}</h3>
        <table class="catalog-table dash-table reports-table rpt-table">
          <thead><tr>${opts.rank ? '<th class="rpt-rank">#</th>' : ''}<th>${escapeHtml(labelHead)}</th>
            <th class="num">Items</th><th class="num">Net</th><th class="num">Share</th></tr></thead>
          <tbody>${list.map((g, i) => `<tr>${opts.rank ? `<td class="rpt-rank">${i + 1}</td>` : ''}
            <td>${escapeHtml(opts.date ? fmtDate(g.key) : g.label)}${g.sub ? `<span class="muted rpt-sub">${escapeHtml(g.sub)}</span>` : ''}</td>
            <td class="num">${fmtNum(g.items)}</td><td class="num">${fmtMoney(g.net)}</td>
            <td class="num">${shareCell(g.share)}</td></tr>`).join('')}
          </tbody>
        </table>
      </section>`;
  }

  function renderHeadlines(filters) {
    const b = getBase();
    if (!b.tillRows.length) {
      return emptyState({
        iconHtml: icon('sparkles', { size: 22 }),
        title: 'No sales imported yet',
        copy: 'Import the Square sales export on the Square & modifiers page to see this event’s headlines.',
        variant: 'admin',
      });
    }
    const { h, undated, scoped } = headlinesModel(filters);
    const t = h.totals;
    const gpCell = h.gpPct != null ? gpBadge(h.gpPct, h.targetGpPct, state.menu?.amberBand) : '—';
    let gpSub = 'needs recon costs';
    if (h.gpPct != null && h.targetGpPct != null) gpSub = `target ${fmtPct(h.targetGpPct)}`;
    else if (h.gpPct != null) gpSub = 'of net sales';
    else if (scoped) gpSub = 'whole event only';
    let forecastSub = scoped ? 'whole event only' : 'no menu forecast';
    if (h.forecastNet != null) forecastSub = `forecast ${fmtMoney(h.forecastNet)} net`;
    const vsForecast = h.revenueVsForecastPct != null
      ? `<span class="${varianceClass(h.revenueVsForecastPct)}">${fmtSigned(h.revenueVsForecastPct, (n) => `${n.toFixed(1)}%`)}</span>`
      : '—';
    return `
      <div class="plan-kpis rpt-kpis rpt-kpis--head">
        ${kpi('Gross sales', fmtMoney(t.gross), 'inc VAT')}
        ${kpi('Net sales', fmtMoney(t.net), forecastSub)}
        ${kpi('vs forecast', vsForecast, 'net sales')}
        ${kpi('Items sold', fmtNum(t.items), t.avgGrossPerItem != null ? `${fmtMoney(t.avgGrossPerItem)} avg` : '')}
        ${kpi('GP', gpCell, gpSub)}
        ${kpi('Best day', h.bestDay ? escapeHtml(fmtDate(h.bestDay.key)) : '—', h.bestDay ? `${fmtMoney(h.bestDay.net)} net` : 'no dates imported')}
        ${kpi('Top category', h.topCategory ? escapeHtml(h.topCategory.label) : '—', h.topCategory ? `${fmtPct(h.topCategory.share)} of net` : '')}
      </div>
      ${undated ? `<p class="muted rpt-note">${undated} sales line${undated === 1 ? '' : 's'} without a date are left out of this date range.</p>` : ''}
      ${renderHeadlinesViz(h, state.menu?.amberBand)}
      <div class="rpt-grid">
        ${groupTable('Top products', h.top, 'Product', { rank: true })}
        <div class="rpt-stack">
          ${h.byLocation.length ? groupTable('By location', h.byLocation, 'Location') : ''}
          ${h.byDay.length ? groupTable('By day', h.byDay, 'Day', { date: true }) : ''}
          ${!h.byLocation.length && !h.byDay.length ? `<section class="admin-surface rpt-card"><h3 class="rpt-card-title">Location &amp; day</h3>
            <p class="muted rpt-note">This import holds event totals only. Import Square’s <strong>Item Details</strong> export (with Date and Location) to break sales down by bar and day.</p></section>` : ''}
        </div>
      </div>`;
  }

  // ---------- sales -------------------------------------------------

  function salesModel(filters) {
    const by = filters.salesGroup || 'item';
    const source = by === 'event' ? (state.allEvents || []) : getBase().tillRows;
    const f = filterSales(source, { from: filters.dateFrom, to: filters.dateTo, location: by === 'event' ? '' : filters.location });
    return { by, ...f, groups: groupSales(f.rows, by), totals: salesTotals(f.rows), source };
  }

  function renderSales(filters) {
    const b = getBase();
    const by = filters.salesGroup || 'item';
    if (by === 'event' && !state.allEvents) return '<p class="muted rpt-note">Loading sales for every event…</p>';
    if (by !== 'event' && !b.tillRows.length) {
      return emptyState({
        iconHtml: icon('bar-chart-3', { size: 22 }),
        title: 'No sales imported yet',
        copy: 'Import the Square sales export on the Square & modifiers page, or group by Event to compare events.',
        variant: 'admin',
      });
    }
    const m = salesModel(filters);
    const allTotals = salesTotals(m.source);
    const missingDim = (by === 'location' && !allTotals.locations.length) || (by === 'date' && !allTotals.days.length);
    const head = { item: 'Product', category: 'Category', location: 'Location', date: 'Date', event: 'Event' }[by];
    const cols = by === 'item' ? 6 : 5;
    return `
      <div class="wst-stats reports-stats">
        <div class="wst-stat"><span class="wst-stat-label">Net sales</span><span class="wst-stat-value">${fmtMoney(m.totals.net)}</span><span class="wst-stat-label muted">ex VAT</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Gross sales</span><span class="wst-stat-value">${fmtMoney(m.totals.gross)}</span><span class="wst-stat-label muted">inc VAT</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Items sold</span><span class="wst-stat-value">${fmtNum(m.totals.items)}</span><span class="wst-stat-label muted">${m.totals.avgGrossPerItem != null ? `${fmtMoney(m.totals.avgGrossPerItem)} avg` : '&nbsp;'}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">${by === 'event' ? 'Events' : 'Locations · days'}</span><span class="wst-stat-value">${by === 'event' ? m.groups.length : `${m.totals.locations.length} · ${m.totals.days.length}`}</span><span class="wst-stat-label muted">${by === 'event' ? 'with sales imported' : 'in this view'}</span></div>
      </div>
      ${missingDim ? `<p class="muted rpt-note">No ${by === 'date' ? 'dates' : 'locations'} in this import. Import Square’s Item Details export to break sales down by ${by === 'date' ? 'day' : 'bar'}.</p>` : ''}
      ${m.undated ? `<p class="muted rpt-note">${m.undated} sales line${m.undated === 1 ? '' : 's'} without a date are left out of this date range.</p>` : ''}
      <section class="admin-surface projections-table-section">
        <div class="dash-table-wrap">
          <table class="catalog-table dash-table reports-table rpt-table">
            <thead><tr><th>${head}</th>${by === 'item' ? '<th>Category</th>' : ''}
              <th class="num">Items sold</th><th class="num">Net sales</th><th class="num">Gross sales</th><th class="num">Share of net</th></tr></thead>
            <tbody>${m.groups.map((g) => `<tr>
              <td>${escapeHtml(by === 'date' && g.key ? fmtDate(g.key) : g.label)}</td>${by === 'item' ? `<td class="muted">${escapeHtml(g.sub || '—')}</td>` : ''}
              <td class="num">${fmtNum(g.items)}</td><td class="num">${fmtMoney(g.net)}</td><td class="num">${fmtMoney(g.gross)}</td>
              <td class="num">${shareCell(g.share)}</td></tr>`).join('')
              || `<tr><td colspan="${cols}" class="dist-empty">No sales match these filters.</td></tr>`}
            </tbody>
            <tfoot><tr class="reports-total-row"><td>Total</td>${by === 'item' ? '<td></td>' : ''}
              <td class="num">${fmtNum(m.totals.items)}</td><td class="num">${fmtMoney(m.totals.net)}</td><td class="num">${fmtMoney(m.totals.gross)}</td><td class="num"></td></tr></tfoot>
          </table>
        </div>
      </section>`;
  }

  // ---------- revenue & GP -----------------------------------------

  function renderRevenue() {
    if (state.menuLoading && !state.menu) return '<p class="muted rpt-note">Loading menu forecast…</p>';
    const c = comparison();
    const target = c.targetGpPct;
    const band = state.menu?.amberBand ?? 5;
    let menuNote = '';
    if (state.menuError) {
      menuNote = `<p class="muted rpt-note">${isOrgAdmin() ? 'The menu forecast couldn’t be loaded' : 'Forecasts and costs are visible to admins only'} — showing actual figures only.</p>`;
    } else if (!c.forecast.linesPriced) {
      menuNote = '<p class="muted rpt-note">No forecast yet: add projected serves and prices on Planning → Menu &amp; GP.</p>';
    }
    const row = (label, f, a, v, fmt, goodUp = true) => `<tr><td>${label}</td>
      <td class="num">${fmt(f)}</td><td class="num">${fmt(a)}</td>
      <td class="num ${varianceClass(v, goodUp)}">${v == null ? '—' : fmtSigned(v, fmt)}</td></tr>`;
    const diff = (a, f) => (a != null && f != null ? a - f : null);

    const productRows = [];
    let lastCat = null;
    c.products.forEach((p) => {
      if (p.category !== lastCat) {
        lastCat = p.category;
        productRows.push(`<tr class="dist-cat-row"><td colspan="9"><span class="dist-bar-name">${escapeHtml(p.category)}</span></td></tr>`);
      }
      productRows.push(`<tr>
        <td>${escapeHtml(p.name)}${p.onMenu ? '' : ' <span class="catalog-tag">not on menu</span>'}</td>
        <td class="num">${fmtNum(p.forecastServes)}</td>
        <td class="num">${fmtNum(p.forecastUnits, 2)}</td>
        <td class="num">${fmtNum(p.consumed, 2)}</td>
        <td class="num">${p.unitsVariance == null ? '—' : fmtSigned(p.unitsVariance, (n) => fmtNum(n, 2))}</td>
        <td class="num">${fmtMoney(p.forecastCost)}</td>
        <td class="num">${fmtMoney(p.actualCost)}</td>
        <td class="num ${varianceClass(p.costVariance, false)}">${p.costVariance == null ? '—' : fmtSigned(p.costVariance, fmtMoney)}</td>
        <td class="num">${p.forecastGpPct == null ? '—' : gpBadge(p.forecastGpPct, target, band)}</td></tr>`);
    });

    const notes = ['Actual cost = recon consumption × stock cost'];
    if (c.actual.unpricedProducts) notes.push(`${c.actual.unpricedProducts} consumed product${c.actual.unpricedProducts === 1 ? ' has' : 's have'} no cost and ${c.actual.unpricedProducts === 1 ? 'is' : 'are'} left out`);
    if (c.forecast.linesMissing) notes.push(`${c.forecast.linesMissing} forecast line${c.forecast.linesMissing === 1 ? '' : 's'} missing a price or cost`);

    return `
      ${menuNote}
      <div class="plan-kpis rpt-kpis">
        ${kpi('Actual GP', c.actual.gpPct != null ? gpBadge(c.actual.gpPct, target, band) : '—', target != null ? `target ${fmtPct(target)}` : 'no target set')}
        ${kpi('Forecast GP', c.forecast.gpPct != null ? gpBadge(c.forecast.gpPct, target, band) : '—', 'planned mix')}
        ${kpi('GP vs forecast', c.variance.gpPts != null ? `<span class="${varianceClass(c.variance.gpPts)}">${fmtSigned(c.variance.gpPts, (n) => `${n.toFixed(1)} pts`)}</span>` : '—')}
        ${kpi('Net sales vs forecast', c.variance.revenuePct != null ? `<span class="${varianceClass(c.variance.revenuePct)}">${fmtSigned(c.variance.revenuePct, (n) => `${n.toFixed(1)}%`)}</span>` : '—')}
      </div>
      <section class="admin-surface rpt-card">
        <h3 class="rpt-card-title">Forecast vs actual</h3>
        <table class="catalog-table dash-table reports-table rpt-table rpt-compare">
          <thead><tr><th></th><th class="num">Forecast</th><th class="num">Actual</th><th class="num">Variance</th></tr></thead>
          <tbody>
            ${row('Net sales (ex VAT)', c.forecast.revenueNet, c.actual.revenueNet, c.variance.revenueNet, fmtMoney)}
            ${row('Gross sales (inc VAT)', c.forecast.revenueGross, c.actual.revenueGross, diff(c.actual.revenueGross, c.forecast.revenueGross), fmtMoney)}
            ${row('Cost of sales', c.forecast.cost, c.actual.cost, diff(c.actual.cost, c.forecast.cost), fmtMoney, false)}
            ${row('Gross profit', c.forecast.gpAmount, c.actual.gpAmount, diff(c.actual.gpAmount, c.forecast.gpAmount), fmtMoney)}
          </tbody>
        </table>
        <p class="muted rpt-note">${escapeHtml(notes.join(' · '))}.</p>
      </section>
      <section class="admin-surface projections-table-section">
        <div class="dash-table-wrap">
          <table class="catalog-table dash-table reports-table rpt-table">
            <thead><tr><th>Product</th><th class="num">Forecast serves</th><th class="num">Forecast units</th><th class="num">Consumed</th>
              <th class="num">Δ units</th><th class="num">Forecast cost</th><th class="num">Actual cost</th><th class="num">Δ cost</th><th class="num">Forecast GP</th></tr></thead>
            <tbody>${productRows.join('') || '<tr><td colspan="9" class="dist-empty">No menu forecast or consumption yet.</td></tr>'}</tbody>
          </table>
        </div>
      </section>`;
  }

  // ---------- loose stock -------------------------------------------

  function looseModel() {
    return computeLooseStock({ reconRows: reconRows(), allowances: state.allowances });
  }

  function renderLoose() {
    if (!isOrgAdmin()) {
      return emptyState({
        iconHtml: icon('lock', { size: 22 }),
        title: 'Admins only',
        copy: 'Loose stock charges are visible to organisation admins.',
        variant: 'admin',
      });
    }
    if (state.looseError) {
      const missing = isLooseSchemaMissing(state.looseError);
      return emptyState({
        iconHtml: icon('circle-alert', { size: 22 }),
        title: missing ? 'Loose stock isn’t set up yet' : 'Couldn’t load loose stock',
        copy: missing ? 'Apply migration 072_sales_detail_loose_stock.sql, then reload.' : (state.looseError.message || 'Failed to load'),
        variant: 'admin',
      });
    }
    if (!state.looseLoaded) return '<p class="muted rpt-note">Loading loose stock…</p>';
    const { groups, totals } = looseModel();
    const catOptions = new Map();
    reconRows().forEach((r) => {
      const c = r.p?.category;
      if (c?.id && !state.allowances.some((a) => a.category_id === c.id)) catOptions.set(c.id, c.name);
    });
    const allowanceInput = (g) => {
      const attrs = g.scope === 'category'
        ? `data-loose-category="${escapeHtml(g.key.slice(2))}"`
        : `data-loose-product="${escapeHtml(g.lines[0].productId)}"`;
      return `<input class="admin-input plan-cell-input rpt-allow-input num-math" inputmode="decimal" ${attrs}
        value="${g.scope === 'none' ? '' : escapeHtml(String(g.allowance))}" placeholder="none" aria-label="Allowance for ${escapeHtml(g.label)}">`;
    };
    const rows = groups.map((g) => {
      const over = g.excessUnits > 0;
      let charge = fmtMoney(g.excessValue);
      if (g.excessValue == null && over) charge = '<span class="reports-miss">No price</span>';
      const main = `<tr class="${over ? 'rpt-over' : ''}">
        <td>${escapeHtml(g.label)}${g.scope === 'category' ? ' <span class="catalog-tag">category allowance</span>' : ''}</td>
        <td class="muted">${escapeHtml(g.categoryName)}</td>
        <td class="num">${fmtNum(g.looseUnits, 2)}</td>
        <td class="num">${allowanceInput(g)}</td>
        <td class="num">${over ? `<span class="lta-badge lta-over">${fmtNum(g.excessUnits, 2)}</span>` : '<span class="lta-badge lta-ok">0</span>'}</td>
        <td class="num">${fmtMoney(g.looseValue)}</td>
        <td class="num reports-cost">${charge}</td></tr>`;
      const subs = g.scope === 'category' ? g.lines.map((l) => `<tr class="rpt-subrow">
        <td>${escapeHtml(l.name)}</td><td></td><td class="num">${fmtNum(l.looseUnits, 2)}</td><td></td><td></td>
        <td class="num">${fmtMoney(l.looseValue)}</td><td></td></tr>`).join('') : '';
      return main + subs;
    }).join('');
    return `
      <div class="wst-stats reports-stats">
        <div class="wst-stat"><span class="wst-stat-label">Loose at close</span><span class="wst-stat-value">${fmtMoney(totals.looseValue)}</span><span class="wst-stat-label muted">${fmtNum(totals.looseUnits, 2)} singles</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Above allowance</span><span class="wst-stat-value${totals.overAllowance ? ' dash-stat-value--warn' : ''}">${fmtMoney(totals.chargeable)}</span><span class="wst-stat-label muted">${totals.overAllowance} line${totals.overAllowance === 1 ? '' : 's'} over${totals.unpriced ? ` · ${totals.unpriced} unpriced` : ''}</span></div>
      </div>
      <p class="muted rpt-note">Loose stock is the opened-case singles counted at close (Recon). Set agreed allowances per product, or pool them by category; anything above is chargeable at stock cost. Allowances never change stock.</p>
      <section class="admin-surface projections-table-section">
        <div class="dash-table-wrap">
          <table class="catalog-table dash-table reports-table rpt-table">
            <thead><tr><th>Product</th><th>Category</th><th class="num">Loose units</th><th class="num">Allowance</th>
              <th class="num">Above allowance</th><th class="num">Loose value</th><th class="num">Chargeable</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="dist-empty">No loose singles recorded at close.</td></tr>'}</tbody>
            <tfoot><tr class="reports-total-row"><td>Total</td><td></td><td class="num">${fmtNum(totals.looseUnits, 2)}</td><td></td>
              <td class="num">${fmtNum(totals.excessUnits, 2)}</td><td class="num">${fmtMoney(totals.looseValue)}</td><td class="num reports-cost">${fmtMoney(totals.chargeable)}</td></tr></tfoot>
          </table>
        </div>
        ${catOptions.size ? `<div class="rpt-inline-form">
          <select class="admin-select" id="rptLooseCat" aria-label="Category">
            ${[...catOptions.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('')}
          </select>
          <input class="admin-input num-math" id="rptLooseCatUnits" inputmode="decimal" placeholder="Units" aria-label="Allowance units">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="rptLooseCatAdd">${icon('plus', { size: 14 })} Category allowance</button>
        </div>` : ''}
      </section>`;
  }

  async function onAllowanceChange(input) {
    const parsed = parsePlanningNumber(input.value, { max: 1000000 });
    if (!parsed.ok) { toast('Enter a number of units', true); input.focus(); return; }
    const { eventId } = getBase();
    const productId = input.dataset.looseProduct || null;
    const categoryId = input.dataset.looseCategory || null;
    const existing = state.allowances.find((a) => (productId ? a.product_id === productId : a.category_id === categoryId)) || null;
    if (!existing && parsed.value == null) return;
    input.disabled = true;
    try {
      const saved = await saveLooseAllowance({ eventId, productId, categoryId, existing, units: parsed.value });
      state.allowances = state.allowances.filter((a) => a !== existing);
      if (saved) state.allowances.push(saved);
      onChange();
    } catch (err) {
      input.disabled = false;
      toast(err.message || 'Could not save allowance', true);
    }
  }

  function bind(root, kind) {
    if (kind !== 'loose') return;
    root.querySelectorAll('.rpt-allow-input').forEach((inp) => {
      inp.addEventListener('change', () => { void onAllowanceChange(inp); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    const catAdd = root.querySelector('#rptLooseCatAdd');
    if (catAdd) {
      catAdd.onclick = async () => {
        const parsed = parsePlanningNumber(root.querySelector('#rptLooseCatUnits').value, { max: 1000000 });
        if (!parsed.ok || parsed.value == null) { toast('Enter the allowance in units', true); return; }
        catAdd.disabled = true;
        try {
          const saved = await saveLooseAllowance({
            eventId: getBase().eventId, categoryId: root.querySelector('#rptLooseCat').value, units: parsed.value,
          });
          if (saved) state.allowances.push(saved);
          onChange();
        } catch (err) {
          catAdd.disabled = false;
          toast(err.message || 'Could not save allowance', true);
        }
      };
    }
  }

  // ---------- exports -----------------------------------------------

  function fileStem(label) {
    return `${(getBase().event?.name || 'event').replace(/[^\w\s.-]/g, '').trim()} ${label}`;
  }

  function exportCsv(kind, filters) {
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = (head, rows) => `\uFEFF${[head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
    const n2 = (v) => (v == null ? '' : Number(v).toFixed(2));
    if (kind === 'sales' || kind === 'headlines') {
      const m = salesModel(kind === 'headlines' ? { ...filters, salesGroup: 'item' } : filters);
      if (!m.groups.length) { toast('No sales to export', true); return; }
      downloadBlob(`${fileStem(`Sales by ${m.by}`)}.csv`, salesCsv(m.groups, m.by), 'text/csv;charset=utf-8');
      return;
    }
    if (kind === 'revenue') {
      const c = comparison();
      downloadBlob(`${fileStem('Revenue and GP')}.csv`, csv(
        ['Category', 'Product', 'On menu', 'Forecast serves', 'Forecast units', 'Consumed', 'Units variance', 'Forecast cost', 'Actual cost', 'Cost variance', 'Forecast GP %'],
        c.products.map((p) => [p.category, p.name, p.onMenu ? 'yes' : 'no', p.forecastServes ?? '', p.forecastUnits ?? '', p.consumed ?? '',
          p.unitsVariance ?? '', n2(p.forecastCost), n2(p.actualCost), n2(p.costVariance), p.forecastGpPct == null ? '' : p.forecastGpPct.toFixed(1)]),
      ), 'text/csv;charset=utf-8');
      return;
    }
    if (kind === 'loose') {
      if (!state.looseLoaded) { toast('Loose stock isn’t loaded', true); return; }
      const { groups } = looseModel();
      downloadBlob(`${fileStem('Loose stock')}.csv`, csv(
        ['Product / pool', 'Category', 'Allowance scope', 'Loose units', 'Allowance', 'Above allowance', 'Loose value', 'Chargeable'],
        groups.map((g) => [g.label, g.categoryName, g.scope, g.looseUnits, g.allowance, g.excessUnits, n2(g.looseValue), n2(g.excessValue)]),
      ), 'text/csv;charset=utf-8');
    }
  }

  async function exportPdf(kind, filters) {
    const b = getBase();
    if (kind !== 'headlines' && kind !== 'loose') {
      toast('PDF export is available for Headlines and Loose stock', true);
      return;
    }
    const { createBrandDoc, formatDocDate } = await import('../lib/brand-pdf.js');
    if (kind === 'headlines') {
      if (!b.tillRows.length) { toast('No sales imported yet', true); return; }
      const { h } = headlinesModel(filters);
      const ctx = await createBrandDoc({ title: 'Event headlines' });
      ctx.continuationNote = b.event?.name || '';
      const range = filters.dateFrom || filters.dateTo ? `${filters.dateFrom || '…'} – ${filters.dateTo || '…'}` : null;
      ctx.header({
        meta: [b.event?.name, range ? `Sales  ${range}` : null, filters.location ? `Location  ${filters.location}` : null, `Issued  ${formatDocDate(new Date())}`],
      });
      // Client-safe: sales figures only, never cost or GP.
      ctx.kpis([
        { label: 'Gross sales', value: fmtMoney(h.totals.gross) },
        { label: 'Net sales', value: fmtMoney(h.totals.net) },
        { label: 'Items sold', value: fmtNum(h.totals.items) },
        { label: 'Avg per item', value: fmtMoney(h.totals.avgGrossPerItem) },
      ]);
      const section = (title, list, labelHead, date = false) => {
        if (!list.length) return;
        ctx.sectionTitle(title);
        ctx.table(
          [{ label: labelHead, width: 46 }, { label: 'Items', width: 14, align: 'right' }, { label: 'Net', width: 18, align: 'right' }, { label: 'Gross', width: 18, align: 'right' }, { label: 'Share', width: 12, align: 'right' }],
          list.map((g, i) => ({ cells: [date ? fmtDate(g.key) : g.label, fmtNum(g.items), fmtMoney(g.net), fmtMoney(g.gross), fmtPct(g.share)], band: i % 2 === 1 })),
        );
      };
      section('Top products', h.top, 'Product');
      section('By location', h.byLocation, 'Location');
      section('By day', h.byDay, 'Day', true);
      ctx.paragraph('Gross sales include VAT; net sales exclude VAT. Source: Square sales export.', { size: 8 });
      ctx.finish(`${fileStem('Headlines')}.pdf`);
      return;
    }
    if (!state.looseLoaded) { toast('Loose stock isn’t loaded', true); return; }
    const { groups, totals } = looseModel();
    const ctx = await createBrandDoc({ title: 'Loose stock statement' });
    ctx.continuationNote = b.event?.name || '';
    ctx.header({ meta: [b.event?.name, `Issued  ${formatDocDate(new Date())}`] });
    ctx.kpis([
      { label: 'Loose at close', value: fmtMoney(totals.looseValue) },
      { label: 'Above allowance', value: fmtMoney(totals.chargeable) },
    ]);
    ctx.sectionTitle('Loose stock above allowance');
    const charged = groups.filter((g) => g.excessUnits > 0);
    ctx.table(
      [{ label: 'Product', width: 40 }, { label: 'Loose', width: 13, align: 'right' }, { label: 'Allowance', width: 15, align: 'right' }, { label: 'Above', width: 13, align: 'right' }, { label: 'Charge', width: 19, align: 'right' }],
      charged.length
        ? charged.map((g, i) => ({ cells: [g.label, fmtNum(g.looseUnits, 2), fmtNum(g.allowance, 2), fmtNum(g.excessUnits, 2), fmtMoney(g.excessValue)], band: i % 2 === 1 }))
        : [['Nothing above allowance', '', '', '', '']],
    );
    ctx.totals([['Chargeable', fmtMoney(totals.chargeable), true]]);
    ctx.finish(`${fileStem('Loose stock statement')}.pdf`);
  }

  function render(kind, filters) {
    if (kind === 'headlines') return renderHeadlines(filters);
    if (kind === 'sales') return renderSales(filters);
    if (kind === 'revenue') return renderRevenue();
    return renderLoose();
  }

  const LEADS = {
    headlines: 'Headline figures for this event from the Square sales import, with GP against target once Recon has costs.',
    sales: 'Sales from the Square import grouped by product, category, location or date — or compare every event.',
    revenue: 'Planned menu forecast (Planning → Menu & GP) against actual sales and recon consumption cost.',
    loose: 'Loose singles left at close against agreed allowances.',
  };

  return { ensure, render, bind, exportCsv, exportPdf, locations, lead: (k) => LEADS[k] || '' };
}
