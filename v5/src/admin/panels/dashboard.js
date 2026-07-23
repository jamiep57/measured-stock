/**
 * Event dashboard — quick actions, stats, charts, run-out projection table.
 */

import { $, escapeHtml, formatMoney, toast, isBoneYard } from '../../lib/util.js';
import { getDB, loadEventFull, loadLibraryProducts, loadCaseSizes } from '../../db.js';
import {
  computeStockProjection,
  sortProjectionItems,
  projectionStatus,
  formatQtyCell,
} from '../../lib/stock-projection.js';
import {
  computeDashboardInsights,
  buildQuickActions,
  renderDashboardCharts,
  renderQuickActions,
} from '../../lib/dashboard-insights.js';
import { hrefForRoute } from '../router.js';
import { icon, initIcons } from '../../lib/icons.js';

function renderStatCard(label, value, sub = '', valueClass = '') {
  return `
    <div class="dash-stat">
      <span class="dash-stat-label">${escapeHtml(label)}</span>
      <span class="dash-stat-value${valueClass ? ` ${valueClass}` : ''}">${value}</span>
      ${sub ? `<span class="dash-stat-sub muted">${sub}</span>` : ''}
    </div>`;
}

function renderProjectionTable(ctx) {
  const p = ctx.projection;
  if (!p.rows.length) {
    return `
      <div class="dash-empty admin-surface">
        <p><strong>No item sales imported yet.</strong></p>
        <p class="muted">Import a Square Item Sales report on the Square &amp; modifiers page to see what will run out.</p>
        <a class="dash-link dash-link--primary" href="${escapeHtml(hrefForRoute({ view: 'event', eventId: ctx.eventId, panel: 'sales' }))}">Go to Square &amp; modifiers</a>
      </div>`;
  }

  if (!p.target) {
    return `
      <div class="dash-empty admin-surface">
        <p><strong>No target revenue set.</strong></p>
        <p class="muted">Set a target revenue in Event Setup to project which products run out before you reach it.</p>
        <a class="dash-link dash-link--primary" href="${escapeHtml(hrefForRoute({ view: 'event', eventId: ctx.eventId, panel: 'setup' }))}">Open Event Setup</a>
      </div>`;
  }

  if (!(p.mappedNet > 0) || !p.items.length) {
    return `
      <div class="dash-empty admin-surface">
        <p><strong>Nothing mapped yet.</strong></p>
        <p class="muted">Map till items to products on the Square &amp; modifiers page so consumption can be projected.</p>
        <a class="dash-link dash-link--primary" href="${escapeHtml(hrefForRoute({ view: 'event', eventId: ctx.eventId, panel: 'sales' }))}">Map item sales</a>
      </div>`;
  }

  const sorted = sortProjectionItems(p.items, ctx.sortKey, ctx.sortDir, p.target);
  const th = (key, label, cls = '') => {
    const active = ctx.sortKey === key;
    const arrow = active ? (ctx.sortDir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="dash-sort${cls ? ` ${cls}` : ''}" data-sort="${key}">${escapeHtml(label)}${arrow}</th>`;
  };

  const body = sorted.map((it) => {
    const st = projectionStatus(it, p.target);
    let statusHtml;
    if (!it.inEvent) {
      statusHtml = `<span class="dash-badge dash-badge--warn" title="${escapeHtml(it.stockHint || '')}">${escapeHtml(st.label)}</span>`;
      if (it.stockHint) {
        statusHtml += `<div class="dash-hint muted">${escapeHtml(it.stockHint)}</div>`;
      }
    } else {
      statusHtml = `<span class="dash-badge dash-badge--${st.tone}">${escapeHtml(st.label)}</span>`;
    }

    const pct = st.pct;
    const pctHtml = pct != null
      ? `<span class="dash-pct dash-pct--${st.tone}">${Math.round(pct)}%</span>`
      : '<span class="muted">—</span>';

    const runOutHtml = it.runOutRevenue != null
      ? formatMoney(it.runOutRevenue)
      : '<span class="muted">—</span>';

    const servingsHtml = it.servingsSold != null
      ? Math.round(it.servingsSold).toLocaleString('en-GB')
      : '<span class="muted">—</span>';

    return `
      <tr${it.pid ? ` data-pid="${escapeHtml(it.pid)}"` : ''}>
        <td class="dash-prod">${escapeHtml(it.name)}</td>
        <td class="num">${servingsHtml}</td>
        <td class="num">${formatQtyCell(it.projectedCases)}</td>
        <td class="num">${it.available != null ? formatQtyCell(it.available) : '<span class="muted">—</span>'}</td>
        <td class="num">${runOutHtml}</td>
        <td class="num">${pctHtml}</td>
        <td>${statusHtml}</td>
      </tr>`;
  }).join('');

  return `
    <div class="catalog-table-wrap dash-table-wrap">
      <table class="catalog-table dash-table" id="dashProjectionTable">
        <thead>
          <tr>
            ${th('name', 'Product')}
            ${th('servingsSold', 'Servings sold', 'num')}
            ${th('projectedCases', 'Projected use', 'num')}
            ${th('available', 'Stock', 'num')}
            ${th('runOutRevenue', 'Runs dry at', 'num')}
            ${th('pct', '% of target', 'num')}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderDashboard(ctx) {
  const p = ctx.projection;
  const insights = computeDashboardInsights(ctx);
  const actions = buildQuickActions(ctx);
  const unmapped = p.baselineNet - p.mappedNet;
  const unmappedPct = p.baselineNet > 0 ? (unmapped / p.baselineNet) * 100 : 0;
  const runOutCount = p.items.filter((it) =>
    it.inEvent && it.runOutRevenue != null && it.runOutRevenue < p.target).length;
  const mappedInEvent = p.items.filter((it) => it.inEvent).length;

  const projectionCards = p.rows.length && p.target && p.mappedNet > 0 ? `
    <div class="dash-stats">
      ${renderStatCard('Target revenue', formatMoney(p.target), 'Projection scaled to this')}
      ${renderStatCard('Imported sales', formatMoney(p.baselineNet), p.factor ? `× ${p.factor.toFixed(2)} to hit target` : '')}
      ${renderStatCard('Will run out', String(runOutCount), `of ${mappedInEvent} stocked items`, runOutCount ? 'dash-stat-value--danger' : 'dash-stat-value--ok')}
      ${renderStatCard('Unmapped sales', `${Math.round(unmappedPct)}%`, `${formatMoney(unmapped)} not attributed`, unmappedPct > 10 ? 'dash-stat-value--warn' : '')}
    </div>` : '';

  return `
    <div class="dash-panel" id="dashPanel">
      ${renderQuickActions(actions, icon)}
      ${renderDashboardCharts(ctx, insights)}
      ${projectionCards}
      <section class="dash-section admin-surface">
        <div class="dash-section-head">
          <h2 class="dash-section-title">Stock run-out projection</h2>
          <p class="dash-section-desc muted">Scales imported sales to target revenue and flags what runs out first.</p>
        </div>
        <div id="dashProjection">${renderProjectionTable(ctx)}</div>
      </section>
    </div>`;
}

export function renderDashboardShell() {
  return `
    <div class="dash-panel" id="dashPanel">
      <div class="mod-loading muted">Loading dashboard…</div>
    </div>`;
}

export function mountDashboardPanel(route) {
  const panel = $('dashPanel');
  if (!panel) return () => {};

  const ctx = {
    eventId: route.eventId,
    event: null,
    eps: [],
    bars: [],
    recipes: [],
    products: [],
    caseSizes: [],
    tillImport: null,
    tillRows: [],
    modImport: null,
    modRows: [],
    projection: { rows: [], baselineNet: 0, mappedNet: 0, target: 0, factor: null, items: [] },
    sortKey: null,
    sortDir: 1,
    abort: false,
  };

  function paintProjectionOnly() {
    const el = panel.querySelector('#dashProjection');
    if (el) el.innerHTML = renderProjectionTable(ctx);
    bindSort();
  }

  function paint() {
    panel.innerHTML = renderDashboard(ctx);
    initIcons(panel);
    bindSort();
  }

  function bindSort() {
    panel.querySelectorAll('.dash-sort[data-sort]').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (ctx.sortKey === key) ctx.sortDir *= -1;
        else {
          ctx.sortKey = key;
          ctx.sortDir = 1;
        }
        paintProjectionOnly();
      };
    });
  }

  async function reload() {
    const DB = getDB();
    const [event, tillImport, modImport, recipes, products, caseSizes] = await Promise.all([
      loadEventFull(ctx.eventId),
      DB.tillImports.forEvent(ctx.eventId).catch(() => null),
      DB.modifierImports.forEvent(ctx.eventId).catch(() => null),
      DB.recipes.listFull().catch(() => []),
      loadLibraryProducts(),
      loadCaseSizes(),
    ]);
    if (ctx.abort) return;

    ctx.event = event;
    ctx.eps = (event?.event_products || []).filter((ep) => ep.product?.name);
    ctx.bars = (event?.bars || []).filter((b) => !isBoneYard(b));
    ctx.tillImport = tillImport;
    ctx.tillRows = tillImport?.rows || [];
    ctx.modImport = modImport;
    ctx.modRows = modImport?.rows || [];
    ctx.recipes = recipes || [];
    ctx.products = products || [];
    ctx.caseSizes = caseSizes || [];
    ctx.projection = computeStockProjection({
      event,
      tillRows: ctx.tillRows,
      recipes: ctx.recipes,
      products: ctx.products,
      caseSizes: ctx.caseSizes,
    });
    paint();
  }

  reload().catch((err) => {
    panel.innerHTML = `<div class="dist-empty del-empty--err">${escapeHtml(err.message || 'Failed to load dashboard')}</div>`;
    toast(err.message || 'Failed to load dashboard', true);
  });

  return () => {
    ctx.abort = true;
  };
}
