/**
 * Event dashboard — quick actions, stats, charts, run-out projection table.
 */

import { $, escapeHtml, toast, isBoneYard } from '../../lib/util.js';
import { getDB, loadEventFull, loadLibraryProducts, loadCaseSizes } from '../../db.js';
import { computeStockProjection } from '../../lib/stock-projection.js';
import { renderProjectionStats, renderProjectionTable } from '../../lib/projection-view.js';
import {
  computeDashboardInsights,
  buildQuickActions,
  renderDashboardCharts,
  renderQuickActions,
} from '../../lib/dashboard-insights.js';
import { icon, initIcons } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';


function renderDashboard(ctx) {
  const insights = computeDashboardInsights(ctx);
  const actions = buildQuickActions(ctx);
  const projectionCards = renderProjectionStats(ctx.projection);

  return `
    <div class="dash-panel" id="dashPanel">
      ${renderQuickActions(actions, icon)}
      ${renderDashboardCharts(ctx, insights)}
      ${projectionCards}
      <section class="dash-section admin-surface">
        <div class="dash-section-head">
          <h2 class="dash-section-title">Stock run-out projection</h2>
          <p class="dash-section-desc muted">Sold is from Square; use at target scales that mix to your revenue target and flags what runs out first.</p>
        </div>
        <div id="dashProjection">${renderProjectionTable({
          projection: ctx.projection,
          eventId: ctx.eventId,
          sortKey: ctx.sortKey,
          sortDir: ctx.sortDir,
          tableId: 'dashProjectionTable',
        })}</div>
      </section>
    </div>`;
}

export function renderDashboardShell() {
  return `
    <div class="dash-panel" id="dashPanel">
      ${loadingWidget('Loading dashboard…')}
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
    if (el) {
      el.innerHTML = renderProjectionTable({
        projection: ctx.projection,
        eventId: ctx.eventId,
        sortKey: ctx.sortKey,
        sortDir: ctx.sortDir,
        tableId: 'dashProjectionTable',
      });
    }
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
    const [event, tillImport, modImport, recipes, products, caseSizes, deliveries, wastageBatches] = await Promise.all([
      loadEventFull(ctx.eventId),
      DB.tillImports.forEvent(ctx.eventId).catch(() => null),
      DB.modifierImports.forEvent(ctx.eventId).catch(() => null),
      DB.recipes.listFull().catch(() => []),
      loadLibraryProducts(),
      loadCaseSizes(),
      DB.deliveries.forEvent(ctx.eventId).catch(() => []),
      DB.wastage.forEvent(ctx.eventId).catch(() => []),
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
      deliveries: deliveries || [],
      wastageBatches: wastageBatches || [],
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
