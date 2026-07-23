import { $, escapeHtml, toast, isBoneYard } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadEventFull } from '../../db.js';
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
  round1,
} from '../../lib/opening-stock.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TABLE_FILTER, getDistControls } from '../table-filter.js';
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

  if (!serves) {
    return `
      <td class="dist-cell dist-cell--off" data-col="bar:${escapeHtml(barId)}" data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
        <button type="button" class="dist-cell-add" title="Add to ${barName} menu" aria-label="Add to ${barName} menu">
          ${icon('plus', { size: 14, strokeWidth: 2.5 })}
        </button>
      </td>`;
  }

  return `
    <td class="dist-cell dist-cell--on" data-col="bar:${escapeHtml(barId)}" data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
      <div class="dist-cell-body">
        <div class="dist-pill lta-badge lta-ok">
          <input type="text" inputmode="decimal" autocomplete="off"
            class="dist-pill-input"
            value="${qty ? qty : ''}" placeholder="-"
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

function renderProductRow(ep, ctx) {
  const pid = ep.product_id;
  const opening = ctx.opening[pid] ?? epOpeningStock(ep);
  const allocated = distAllocatedToBars(ctx.distRows, pid, ctx.bars, isBoneYard);
  const lta = leftToAllocate(opening, allocated);
  const bone = goodsInStock(opening, allocated);
  const boneNeg = bone < 0 ? ' dist-bone--neg' : '';

  let html = `<tr class="dist-prod-row" data-pid="${escapeHtml(pid)}">
    <th class="dist-sticky dist-prod-name" data-col="product" scope="row">${escapeHtml(ep.product.name)}</th>`;

  if (colVisible(ctx, 'pack')) {
    html += `<td class="dist-sticky dist-prod-pack muted" data-col="pack">${escapeHtml(ep.product.case_size || '—')}</td>`;
  }
  if (colVisible(ctx, 'opening')) {
    html += `<td class="dist-sticky dist-prod-opening" data-col="opening">${opening}</td>`;
  }
  if (colVisible(ctx, 'lta')) {
    html += `<td class="dist-sticky dist-prod-lta" data-col="lta">
      <span class="lta-badge ${ltaClass(lta)}" data-lta="${escapeHtml(pid)}">${lta}</span>
    </td>`;
  }
  if (colVisible(ctx, 'bone-yard')) {
    html += `<td class="dist-cell dist-cell--bone-yard${boneNeg}" data-col="bone-yard" title="Goods in — undistributed stock">
      <span class="dist-bone-yard-value" data-bone="${escapeHtml(pid)}">${bone}</span>
    </td>`;
  }
  ctx.bars.forEach((b) => {
    if (colVisible(ctx, `bar:${b.id}`)) html += renderBarCell(b, ep, ctx);
  });

  return `${html}</tr>`;
}

function renderGridHead(ctx) {
  let html = `<tr>
    <th class="dist-sticky dist-col-header dist-col-product" data-col="product">
      <div class="dist-bar-head dist-bar-head--left">
        <span class="dist-bar-name">Product</span>
      </div>
    </th>`;

  if (colVisible(ctx, 'pack')) {
    html += `<th class="dist-sticky dist-col-header dist-col-pack" data-col="pack">
      <div class="dist-bar-head"><span class="dist-bar-name">Pack</span></div>
    </th>`;
  }
  if (colVisible(ctx, 'opening')) {
    html += `<th class="dist-sticky dist-col-header dist-col-opening" data-col="opening">
      <div class="dist-bar-head"><span class="dist-bar-name">Opening</span></div>
    </th>`;
  }
  if (colVisible(ctx, 'lta')) {
    html += `<th class="dist-sticky dist-col-header dist-col-lta" data-col="lta">
      <div class="dist-bar-head"><span class="dist-bar-name">Left to allocate</span></div>
    </th>`;
  }
  if (colVisible(ctx, 'bone-yard')) {
    html += `<th class="dist-bar-header dist-col-bone" data-col="bone-yard">
      <div class="dist-bar-head">
        <span class="dist-bar-name">Bone Yard</span>
        <span class="dist-bar-tag">Goods in</span>
      </div>
    </th>`;
  }
  ctx.bars.forEach((b) => {
    if (!colVisible(ctx, `bar:${b.id}`)) return;
    html += `<th class="dist-bar-header" data-col="bar:${escapeHtml(b.id)}">
      <div class="dist-bar-head">
        <span class="dist-bar-name">${escapeHtml(b.name)}</span>
      </div>
    </th>`;
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
    const hay = [ep.product.name, ep.product.sku, cat].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function renderDistributionShell() {
  return `
    <div class="dist-panel" id="distPanel">
      <div class="dist-loading">Loading distribution…</div>
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
  };

  function refreshLtaForProduct(productId) {
    const opening = ctx.opening[productId] ?? 0;
    const allocated = distAllocatedToBars(ctx.distRows, productId, ctx.bars, isBoneYard);
    const lta = leftToAllocate(opening, allocated);
    const bone = goodsInStock(opening, allocated);

    document.querySelectorAll(`[data-lta="${productId}"]`).forEach((el) => {
      el.textContent = lta;
      el.className = 'lta-badge ' + ltaClass(lta);
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
  }

  function paintBodyOnly() {
    const tbody = panel.querySelector('#distGridBody');
    if (tbody) tbody.innerHTML = renderGridBody(ctx);
    syncGridLayout();
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
      panel.innerHTML = `
        <div class="empty-state">
          <p>Add products and bars in Event Setup first.</p>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div class="dist-grid-wrap">
        <table class="dist-grid" id="distGrid">
          <thead id="distGridHead">${renderGridHead(ctx)}</thead>
          <tbody id="distGridBody">${renderGridBody(ctx)}</tbody>
        </table>
      </div>`;

    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', onPanelInput);
    bindGridLayoutSync();
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
    const event = await loadEventFull(ctx.eventId);
    if (ctx.abort || !event) return;
    const distRows = (await DB.distribution.forEvent(ctx.eventId)) || [];
    ctx.event = event;
    ctx.distRows = distRows;
    ctx.barProducts = event.bar_products || [];
    ctx.bars = servingBars(event.bars);
    ctx.eps = eventProducts(event);
    ctx.opening = openingByProduct(ctx.eps);
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
        const ok = confirm(
          `This product still has ${allocatedQty} allocated to this bar. Removing it will set that allocation to zero. Continue?`,
        );
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
    const qty = round1(parseFloat(val) || 0);
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
    console.error(err);
    panel.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message || 'Failed to load')}</p></div>`;
  });

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TABLE_FILTER, onDistControls);

  return () => {
    ctx.abort = true;
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
