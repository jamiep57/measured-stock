/**
 * Stock projections — run-out list scaled to target revenue.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { getDB, loadEventFull, loadLibraryProducts, loadCaseSizes } from '../../db.js';
import { computeStockProjection } from '../../lib/stock-projection.js';
import { renderProjectionStats, renderProjectionTable } from '../../lib/projection-view.js';
import { initIcons } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
export function renderProjectionsShell() {
  return `
    <div class="admin-page projections-page" id="projectionsPanel">
      ${loadingWidget('Loading stock projections…')}
    </div>`;
}

export function mountProjectionsPanel(route) {
  const root = $('projectionsPanel');
  if (!root) return () => {};

  const ctx = {
    eventId: route.eventId,
    projection: { rows: [], baselineNet: 0, mappedNet: 0, target: 0, factor: null, items: [] },
    sortKey: null,
    sortDir: 1,
    filter: 'runout',
    abort: false,
  };

  function bindTableInteractions() {
    root.querySelectorAll('.dash-sort[data-sort]').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (ctx.sortKey === key) ctx.sortDir *= -1;
        else {
          ctx.sortKey = key;
          ctx.sortDir = 1;
        }
        paintTable();
      };
    });

    root.querySelectorAll('.projections-filter-btn[data-filter]').forEach((btn) => {
      btn.onclick = () => {
        ctx.filter = btn.dataset.filter || 'all';
        paint();
      };
    });
  }

  function paintTable() {
    const el = root.querySelector('#projectionsTable');
    if (!el) return;
    el.innerHTML = renderProjectionTable({
      projection: ctx.projection,
      eventId: ctx.eventId,
      sortKey: ctx.sortKey,
      sortDir: ctx.sortDir,
      tableId: 'projectionsTable',
      filter: ctx.filter,
    });
    bindTableInteractions();
  }

  function paint() {
    const runout = ctx.filter === 'runout';
    root.innerHTML = `
      <p class="projections-lead muted">
        Scales your imported Square sales mix to the event target revenue and shows when each product runs out.
      </p>
      <div class="projections-toolbar">
        <div class="projections-filter" role="tablist" aria-label="Projection filter">
          <button type="button" class="projections-filter-btn${runout ? '' : ' is-active'}" data-filter="all" role="tab" aria-selected="${!runout}">All mapped products</button>
          <button type="button" class="projections-filter-btn${runout ? ' is-active' : ''}" data-filter="runout" role="tab" aria-selected="${runout}">Runs out before target</button>
        </div>
      </div>
      ${renderProjectionStats(ctx.projection)}
      <section class="admin-surface projections-table-section">
        <div id="projectionsTable">${renderProjectionTable({
          projection: ctx.projection,
          eventId: ctx.eventId,
          sortKey: ctx.sortKey,
          sortDir: ctx.sortDir,
          tableId: 'projectionsTable',
          filter: ctx.filter,
        })}</div>
      </section>`;
    initIcons(root);
    bindTableInteractions();
  }

  async function reload() {
    const DB = getDB();
    const [event, tillImport, recipes, products, caseSizes, deliveries, wastageBatches] = await Promise.all([
      loadEventFull(ctx.eventId),
      DB.tillImports.forEvent(ctx.eventId).catch(() => null),
      DB.recipes.listFull().catch(() => []),
      loadLibraryProducts(),
      loadCaseSizes(),
      DB.deliveries.forEvent(ctx.eventId).catch(() => []),
      DB.wastage.forEvent(ctx.eventId).catch(() => []),
    ]);
    if (ctx.abort) return;

    ctx.projection = computeStockProjection({
      event,
      tillRows: tillImport?.rows || [],
      recipes: recipes || [],
      products: products || [],
      caseSizes: caseSizes || [],
      deliveries: deliveries || [],
      wastageBatches: wastageBatches || [],
    });
    paint();
  }

  reload().catch((err) => {
    reportError(err, { source: 'admin.projections.load', silent: true });
    root.innerHTML = errorState({
      title: 'Couldn’t load projections',
      copy: err.message || 'Failed to load projections',
      variant: 'admin',
    });
    bindEmptyRetry(root, () => reload());
    toast(err.message || 'Failed to load projections', true);
  });

  return () => {
    ctx.abort = true;
  };
}
