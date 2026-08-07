import { $, escapeHtml, toast, isBoneYard } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { getDB, loadEventFull, loadCaseSizes } from '../../db.js';
import {
  barServesProduct,
  hasBarMenu,
} from '../../bar-products.js';
import {
  distRowFor,
  distAllocatedToBars,
  epOpeningStock,
  leftToAllocate,
  openingByProduct,
  countedInFromDeliveries,
  damagedFromDeliveries,
  round1,
} from '../../lib/opening-stock.js';
import { parseQty } from '../../stock-entry.js';
import { productSupplierSearchText } from '../../components/product-search.js';
import { createGridCollabSession } from '../../lib/collab-presence.js';
import {
  distributionCellKeyFromInput,
  distributionFindCellEl,
} from '../../lib/grid-collab-keys.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TABLE_FILTER, getDistControls } from '../table-filter.js';
import { confirmDialog } from '../../components/modal.js';
import {
  colVisible,
  stickyColCount,
  scrollColCount,
  totalColCount,
  applyStickyColumnOffsets,
} from '../dist-columns.js';

function servingBars(bars) {
  return (bars || [])
    .filter((b) => !isBoneYard(b))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function eventProducts(event) {
  return (event?.event_products || []).filter((ep) => ep.product?.name);
}

function groupByCategory(eps) {
  const grouped = {};
  eps.forEach((ep) => {
    const cat = ep.product?.category?.name || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(ep);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''));
  });
  return grouped;
}

function ltaClass(lta) {
  if (lta < 0) return 'lta-over';
  if (lta === 0) return 'lta-neutral';
  return 'lta-ok';
}

function goodsInStock(opening, allocated) {
  return leftToAllocate(opening, allocated);
}

function renderBarCell(bar, ep, ctx) {
  const pid = ep.product_id;
  const barId = bar.id;
  const barName = escapeHtml(bar.name);
  const serves = barServesProduct(ctx.barProducts, barId, pid);
  const d = distRowFor(ctx.distRows, barId, pid);
  const qty = d ? Number(d.qty_allocated) || 0 : 0;
  const filled = qty > 0;

  if (!serves) {
    return `
      <td class="dist-cell dist-cell--off dist-group-start" data-col="bar:${escapeHtml(barId)}" data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
        <button type="button" class="dist-cell-add" title="Add to ${barName} menu" aria-label="Add to ${barName} menu">
          ${icon('plus', { size: 14, strokeWidth: 2.5 })}
        </button>
      </td>`;
  }

  return `
    <td class="dist-cell dist-cell--on dist-group-start${filled ? ' dist-cell--filled' : ''}"
      data-col="bar:${escapeHtml(barId)}" data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
      <div class="dist-cell-body">
        <div class="dist-pill lta-badge lta-ok">
          <input type="text" inputmode="decimal" autocomplete="off"
            class="dist-pill-input num-math"
            value="${qty ? qty : ''}" placeholder="—"
            aria-label="Cases allocated to ${barName}">
        </div>
        <button type="button" class="dist-cell-remove" title="Remove from ${barName} menu" aria-label="Remove from ${barName} menu">
          ${icon('x', { size: 14 })}
        </button>
      </div>
    </td>`;
}

function productLta(ep, ctx) {
  const opening = ctx.opening[ep.product_id] ?? epOpeningStock(ep);
  const allocated = distAllocatedToBars(ctx.distRows, ep.product_id, ctx.bars, isBoneYard);
  return leftToAllocate(opening, allocated);
}

function applyControlFilters(eps, ctx) {
  const { categories } = ctx.controls || {};
  return eps.filter((ep) => {
    if (categories?.length) {
      const cat = ep.product?.category?.name || 'Uncategorised';
      if (!categories.includes(cat)) return false;
    }
    return true;
  });
}

function sortProducts(eps, ctx) {
  const sort = ctx.controls?.sort || 'category';
  const items = eps.slice();
  if (sort === 'name') {
    items.sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''));
  } else if (sort === 'name-desc') {
    items.sort((a, b) => (b.product.name || '').localeCompare(a.product.name || ''));
  } else if (sort === 'lta-desc' || sort === 'lta-asc') {
    items.sort((a, b) => {
      const diff = productLta(b, ctx) - productLta(a, ctx);
      return sort === 'lta-desc' ? diff : -diff;
    });
  }
  return items;
}

function distTh(label, extraClass = '', title = '', col = '') {
  const tip = title || label;
  const colAttr = col ? ` data-col="${escapeHtml(col)}"` : '';
  return `<th class="dist-th ${extraClass}"${colAttr} title="${escapeHtml(tip)}">
    <div class="dist-bar-head"><span class="dist-bar-name">${escapeHtml(label)}</span></div>
  </th>`;
}

function renderProductRow(ep, ctx) {
  const pid = ep.product_id;
  const opening = ctx.opening[pid] ?? epOpeningStock(ep);
  const allocated = distAllocatedToBars(ctx.distRows, pid, ctx.bars, isBoneYard);
  const lta = leftToAllocate(opening, allocated);
  const bone = goodsInStock(opening, allocated);
  const boneNeg = bone < 0 ? ' dist-bone--neg' : '';
  const packLabel = ep.product.case_size || '';
  const showPack = colVisible(ctx, 'pack');

  let html = `<tr class="dist-prod-row" data-pid="${escapeHtml(pid)}">
    <th class="dist-sticky dist-col-item" data-col="product" scope="row">
      <div class="dist-item">
        <div class="dist-item-top">
          <span class="dist-item-name" title="${escapeHtml(ep.product.name)}">${escapeHtml(ep.product.name)}</span>
        </div>
        ${showPack && packLabel ? `<span class="dist-item-meta">${escapeHtml(packLabel)}</span>` : ''}
      </div>
    </th>`;

  if (colVisible(ctx, 'opening')) {
    html += `<td class="dist-sticky dist-num dist-prod-opening" data-col="opening">${opening}</td>`;
  }
  if (colVisible(ctx, 'lta')) {
    html += `<td class="dist-sticky dist-num dist-prod-lta" data-col="lta">
      <span class="dist-lta ${ltaClass(lta)}" data-lta="${escapeHtml(pid)}">${lta}</span>
    </td>`;
  }
  if (colVisible(ctx, 'bone-yard')) {
    html += `<td class="dist-num dist-cell--bone-yard dist-group-start${boneNeg}" data-col="bone-yard" title="Goods in — undistributed stock">
      <span class="dist-bone-yard-value" data-bone="${escapeHtml(pid)}">${bone}</span>
    </td>`;
  }
  ctx.bars.forEach((b) => {
    if (colVisible(ctx, `bar:${b.id}`)) html += renderBarCell(b, ep, ctx);
  });

  return `${html}</tr>`;
}

function renderGridHead(ctx) {
  let html = `<tr class="dist-head-row">
    ${distTh('Product', 'dist-sticky dist-col-item dist-th--item', 'Product', 'product')}`;

  if (colVisible(ctx, 'opening')) {
    html += distTh('Opening', 'dist-sticky dist-num', 'Opening stock', 'opening');
  }
  if (colVisible(ctx, 'lta')) {
    html += distTh('Left', 'dist-sticky dist-num dist-th--emphasis', 'Left to allocate', 'lta');
  }
  if (colVisible(ctx, 'bone-yard')) {
    html += distTh('Bone Yard', 'dist-num dist-group-start', 'Goods in — undistributed stock', 'bone-yard');
  }
  ctx.bars.forEach((b) => {
    if (!colVisible(ctx, `bar:${b.id}`)) return;
    html += distTh(b.name, 'dist-bar-header dist-group-start', b.name, `bar:${b.id}`);
  });

  return `${html}</tr>`;
}

function renderGridBody(ctx) {
  const colSpan = totalColCount(ctx);
  const filtered = applyControlFilters(filterProducts(ctx), ctx);
  const sort = ctx.controls?.sort || 'category';
  let html = '';

  if (sort === 'category') {
    const grouped = groupByCategory(filtered);
    Object.keys(grouped).sort().forEach((cat) => {
      const stickySpan = stickyColCount(ctx);
      const scrollSpan = scrollColCount(ctx);
      html += `<tr class="dist-cat-row">
        <td colspan="${stickySpan}" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>`;
      if (scrollSpan > 0) {
        html += `<td colspan="${scrollSpan}" class="dist-cat-scroll"></td>`;
      }
      html += '</tr>';
      grouped[cat].forEach((ep) => {
        html += renderProductRow(ep, ctx);
      });
    });
  } else {
    sortProducts(filtered, ctx).forEach((ep) => {
      html += renderProductRow(ep, ctx);
    });
  }

  return html || `<tr><td colspan="${colSpan || 1}" class="dist-empty">No products match your filter.</td></tr>`;
}

function filterProducts(ctx) {
  const q = ctx.searchQuery.trim().toLowerCase();
  if (!q) return ctx.eps;
  return ctx.eps.filter((ep) => {
    const cat = ep.product?.category?.name || '';
    const hay = [ep.product.name, ep.product.sku, cat, productSupplierSearchText(ep.product)]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function renderDistributionShell() {
  return `
    <div class="dist-panel" id="distPanel">
      ${loadingWidget('Loading distribution…')}
    </div>`;
}

export function mountDistributionPanel(route, state) {
  const panel = $('distPanel');
  if (!panel) return null;

  const ctx = {
    eventId: route.eventId,
    event: null,
    distRows: [],
    barProducts: [],
    bars: [],
    eps: [],
    opening: {},
    searchQuery: '',
    controls: getDistControls(),
    saveTimers: {},
    theadObserver: null,
    gridWrap: null,
    abort: false,
    collab: null,
  };

  function stopCollab() {
    const session = ctx.collab;
    ctx.collab = null;
    session?.destroy();
  }

  function startCollab() {
    stopCollab();
    ctx.collab = createGridCollabSession({
      channelName: `collab:distribution:${ctx.eventId}`,
      root: panel,
      inputSelector: '.dist-pill-input',
      cellKeyFromInput: distributionCellKeyFromInput,
      findCellEl: distributionFindCellEl,
    });
  }

  function refreshLtaForProduct(productId) {
    const opening = ctx.opening[productId] ?? 0;
    const allocated = distAllocatedToBars(ctx.distRows, productId, ctx.bars, isBoneYard);
    const lta = leftToAllocate(opening, allocated);
    const bone = goodsInStock(opening, allocated);

    document.querySelectorAll(`[data-lta="${productId}"]`).forEach((el) => {
      el.textContent = lta;
      el.className = 'dist-lta ' + ltaClass(lta);
    });
    document.querySelectorAll(`[data-bone="${productId}"]`).forEach((el) => {
      el.textContent = bone;
      el.closest('.dist-cell--bone-yard')?.classList.toggle('dist-bone--neg', bone < 0);
    });
  }

  function syncGridLayout() {
    const wrap = panel.querySelector('.dist-grid-wrap');
    if (!wrap) return;
    requestAnimationFrame(() => {
      const grid = panel.querySelector('.dist-grid');
      const theadRow = panel.querySelector('.dist-grid thead tr');
      if (theadRow) {
        wrap.style.setProperty('--dist-thead-h', `${theadRow.getBoundingClientRect().height}px`);
      }
      applyStickyColumnOffsets(grid, panel, ctx);
      wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 8);
    });
  }

  function paintHeadAndBody() {
    const thead = panel.querySelector('#distGridHead');
    const tbody = panel.querySelector('#distGridBody');
    if (thead) thead.innerHTML = renderGridHead(ctx);
    if (tbody) tbody.innerHTML = renderGridBody(ctx);
    syncGridLayout();
    ctx.collab?.repaint();
  }

  function paintBodyOnly() {
    const tbody = panel.querySelector('#distGridBody');
    if (tbody) tbody.innerHTML = renderGridBody(ctx);
    syncGridLayout();
    ctx.collab?.repaint();
  }

  function bindGridLayoutSync() {
    const wrap = panel.querySelector('.dist-grid-wrap');
    const thead = panel.querySelector('.dist-grid thead');
    if (!wrap) return;
    ctx.gridWrap = wrap;
    syncGridLayout();
    wrap.addEventListener('scroll', syncGridLayout, { passive: true });
    window.addEventListener('resize', syncGridLayout);
    if (thead && typeof ResizeObserver !== 'undefined') {
      ctx.theadObserver?.disconnect();
      ctx.theadObserver = new ResizeObserver(syncGridLayout);
      ctx.theadObserver.observe(thead);
    }
  }

  function paint() {
    ctx.searchQuery = getLastProductFilter().query || ctx.searchQuery;
    ctx.controls = getDistControls();
    if (!ctx.eps.length || !ctx.bars.length) {
      panel.innerHTML = emptyState({
        iconHtml: icon('list', { size: 22 }),
        title: 'Add products and bars first',
        copy: 'Set up products and bars in Event setup before distributing stock.',
        variant: 'admin',
      });
      return;
    }

    panel.innerHTML = `
      <div class="dist-grid-wrap dist-table-wrap">
        <table class="dist-grid" id="distGrid">
          <thead id="distGridHead">${renderGridHead(ctx)}</thead>
          <tbody id="distGridBody">${renderGridBody(ctx)}</tbody>
        </table>
      </div>`;

    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', onPanelInput);
    bindGridLayoutSync();
    startCollab();
  }

  function onDistControls(e) {
    if (e.detail?.panel !== 'distribution') return;
    const prevCols = JSON.stringify(ctx.controls.hiddenColumns || []);
    ctx.controls = getDistControls();
    if (prevCols !== JSON.stringify(ctx.controls.hiddenColumns || [])) paintHeadAndBody();
    else paintBodyOnly();
    if (e.detail) e.detail.handled = true;
  }

  function onProductFilter(e) {
    ctx.searchQuery = e.detail?.query || '';
    paintBodyOnly();
    if (e.detail?.scroll && e.detail?.productId) {
      const row = panel.querySelector(`[data-pid="${e.detail.productId}"]`);
      row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    e.detail.handled = true;
  }

  function focusCellInput(barId, productId) {
    requestAnimationFrame(() => {
      const cell = panel.querySelector(
        `.dist-cell[data-bar="${barId}"][data-pid="${productId}"]`,
      );
      const field = cell?.querySelector('.dist-pill-input');
      if (field) {
        field.focus();
        field.select?.();
      }
    });
  }

  function onPanelClick(e) {
    const addBtn = e.target.closest('.dist-cell-add');
    if (addBtn) {
      const cell = addBtn.closest('.dist-cell');
      if (cell) enableProductOnBar(cell.dataset.bar, cell.dataset.pid);
      return;
    }

    const removeBtn = e.target.closest('.dist-cell-remove');
    if (removeBtn) {
      const cell = removeBtn.closest('.dist-cell');
      if (cell) disableProductOnBar(cell.dataset.bar, cell.dataset.pid);
    }
  }

  function onPanelInput(e) {
    if (!e.target.matches('.dist-pill-input')) return;
    const cell = e.target.closest('.dist-cell[data-bar][data-pid]');
    if (!cell) return;
    updateAllocation(cell.dataset.pid, cell.dataset.bar, e.target.value, e.target);
  }

  async function reload() {
    const DB = getDB();
    const [event, distRows, deliveries, caseSizes] = await Promise.all([
      loadEventFull(ctx.eventId),
      DB.distribution.forEvent(ctx.eventId),
      DB.deliveries.forEvent(ctx.eventId).catch(() => []),
      loadCaseSizes(),
    ]);
    if (ctx.abort || !event) return;
    ctx.event = event;
    ctx.distRows = distRows || [];
    ctx.barProducts = event.bar_products || [];
    ctx.bars = servingBars(event.bars);
    ctx.eps = eventProducts(event);
    const hasLines = (deliveries || []).some((d) => (d.lines || []).length);
    const countedIn = hasLines
      ? countedInFromDeliveries(deliveries, event.event_products, caseSizes)
      : null;
    const damagedMap = hasLines ? damagedFromDeliveries(deliveries) : null;
    // Prefer live delivery sums so distribution matches products / recon.
    ctx.opening = openingByProduct(ctx.eps, countedIn, damagedMap);
    paint();
  }

  async function enableProductOnBar(barId, productId) {
    const DB = getDB();
    const eps = ctx.eps;
    if (barServesProduct(ctx.barProducts, barId, productId)) {
      focusCellInput(barId, productId);
      return;
    }

    try {
      const needsBackfill = !hasBarMenu(ctx.barProducts, barId);
      const rows = needsBackfill
        ? eps.map((ep) => ({ event_id: ctx.eventId, bar_id: barId, product_id: ep.product_id }))
        : [{ event_id: ctx.eventId, bar_id: barId, product_id: productId }];
      const saved = await DB.barProducts.createMany(rows);
      ctx.barProducts.push(...(Array.isArray(saved) && saved.length ? saved : rows));
      refreshLtaForProduct(productId);
      paintBodyOnly();
      focusCellInput(barId, productId);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Failed to add product to bar', true);
    }
  }

  async function disableProductOnBar(barId, productId) {
    const DB = getDB();
    const eps = ctx.eps;
    if (!barServesProduct(ctx.barProducts, barId, productId)) return;

    try {
      const distRow = distRowFor(ctx.distRows, barId, productId);
      const allocatedQty = distRow ? Number(distRow.qty_allocated) || 0 : 0;
      if (allocatedQty > 0) {
        const ok = await confirmDialog({ title: 'Confirm', message: `This product still has ${allocatedQty} allocated to this bar. Removing it will set that allocation to zero. Continue?`, confirmLabel: 'Confirm', danger: true });
        if (!ok) return;
        await DB.distribution.setAllocation(ctx.eventId, barId, productId, 0);
        if (distRow) distRow.qty_allocated = 0;
      }

      const hadCustom = hasBarMenu(ctx.barProducts, barId);
      if (!hadCustom) {
        const rows = eps
          .filter((ep) => ep.product_id !== productId)
          .map((ep) => ({ event_id: ctx.eventId, bar_id: barId, product_id: ep.product_id }));
        const saved = await DB.barProducts.createMany(rows);
        ctx.barProducts.push(...(Array.isArray(saved) && saved.length ? saved : rows));
      } else {
        await DB.barProducts.removeWhere(
          'bar_id=eq.' + DB._.enc(barId) + '&product_id=eq.' + DB._.enc(productId),
        );
        ctx.barProducts = ctx.barProducts.filter(
          (r) => !(r.bar_id === barId && r.product_id === productId),
        );
      }

      refreshLtaForProduct(productId);
      paintBodyOnly();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Failed to remove product from bar', true);
    }
  }

  function updateAllocation(productId, barId, val, inputEl) {
    const qty = round1(parseQty(val));
    let row = distRowFor(ctx.distRows, barId, productId);
    if (!row) {
      row = {
        event_id: ctx.eventId,
        product_id: productId,
        bar_id: barId,
        qty_allocated: qty,
      };
      ctx.distRows.push(row);
    } else {
      row.qty_allocated = qty;
    }

    refreshLtaForProduct(productId);
    inputEl?.closest('.dist-cell')?.classList.toggle('dist-cell--filled', qty > 0);

    const key = productId + barId;
    clearTimeout(ctx.saveTimers[key]);
    ctx.saveTimers[key] = setTimeout(async () => {
      try {
        const saved = await getDB().distribution.setAllocation(
          ctx.eventId, barId, productId, qty,
        );
        if (saved?.id) row.id = saved.id;
      } catch (err) {
        console.warn('save distribution', err);
        toast('Failed to save allocation', true);
      }
    }, 500);
  }

  reload().catch((err) => {
    reportError(err, { source: 'admin.distribution.reload', silent: true });
    panel.innerHTML = errorState({
      title: 'Couldn’t load distribution',
      copy: err.message || 'Failed to load',
      variant: 'admin',
    });
    bindEmptyRetry(panel, () => reload());
  });

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TABLE_FILTER, onDistControls);

  return () => {
    ctx.abort = true;
    stopCollab();
    Object.values(ctx.saveTimers).forEach(clearTimeout);
    ctx.theadObserver?.disconnect();
    ctx.gridWrap?.removeEventListener('scroll', syncGridLayout);
    window.removeEventListener('resize', syncGridLayout);
    panel.removeEventListener('click', onPanelClick);
    panel.removeEventListener('input', onPanelInput);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TABLE_FILTER, onDistControls);
  };
}
