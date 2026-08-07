/**
 * Stock projections — run-out list scaled to target revenue.
 * Note: router aliases `projections` → `dashboard`; kept for direct mounts/tests.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { getDB, loadEventLite, loadCaseSizes, loadRecipesFull, productsFromEvent } from '../../db.js';
import { computeStockProjection } from '../../lib/stock-projection.js';
import { renderProjectionStats, renderProjectionTable } from '../../lib/projection-view.js';
import { initIcons } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
  patchTableFilterState,
} from '../table-filter.js';

function sortDirNum(dir) {
  return dir === 'desc' ? -1 : 1;
}

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
    sortKey: 'name',
    sortDir: 1,
    filter: 'runout',
    abort: false,
  };

  const seeded = getTableFilterValues('projections');
  if (seeded) {
    ctx.sortKey = seeded.sortKey || 'name';
    ctx.sortDir = sortDirNum(seeded.sortDir);
    ctx.filter = seeded.runoutFilter || 'runout';
  }

  function bindTableInteractions() {
    root.querySelectorAll('.dash-sort[data-sort]').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        const nextDir = ctx.sortKey === key
          ? (ctx.sortDir === 1 ? 'desc' : 'asc')
          : 'asc';
        ctx.sortKey = key;
        ctx.sortDir = sortDirNum(nextDir);
        paintTable();
        patchTableFilterState('projections', { sort: key, sortDir: nextDir });
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
    root.innerHTML = `
      <p class="projections-lead muted">
        Scales your imported Square sales mix to the event target revenue and shows when each product runs out.
        Use the topbar filter menu for run-out scope and sort.
      </p>
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
    const [event, tillImport, recipes, caseSizes, deliveries, wastageBatches] = await Promise.all([
      loadEventLite(ctx.eventId),
      DB.tillImports.forEvent(ctx.eventId).catch(() => null),
      loadRecipesFull(),
      loadCaseSizes(),
      DB.deliveries.forEvent(ctx.eventId).catch(() => []),
      DB.wastage.forEvent(ctx.eventId).catch(() => []),
    ]);
    if (ctx.abort) return;

    ctx.projection = computeStockProjection({
      event,
      tillRows: tillImport?.rows || [],
      recipes: recipes || [],
      products: productsFromEvent(event),
      caseSizes: caseSizes || [],
      deliveries: deliveries || [],
      wastageBatches: wastageBatches || [],
    });
    paint();
  }

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'projections') return;
    const values = e.detail?.values;
    if (!values) return;
    ctx.sortKey = values.sortKey || 'name';
    ctx.sortDir = sortDirNum(values.sortDir);
    ctx.filter = values.runoutFilter || 'runout';
    paintTable();
  };

  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

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
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
