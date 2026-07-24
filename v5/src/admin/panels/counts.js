/**
 * Admin stock counts — session picker + distribution-style product × bar grid.
 */

import { $, escapeHtml, toast, fmtDateTime, isBoneYard } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadEventFull, loadCaseSizes } from '../../db.js';
import { barServesProduct, hasBarMenu } from '../../bar-products.js';
import {
  formToCountStored, countStoredToForm, hasQuantity, inputAttrsPrimary, inputAttrsForSecondary,
} from '../../stock-entry.js';
import { countEntryMode, productStockPack } from '../../pack-metrics.js';
import { printCountSheets } from '../../lib/count-sheets-print.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';

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

function countLineFor(lines, barId, productId) {
  return (lines || []).find((l) => l.bar_id === barId && l.product_id === productId);
}

function attrString(attrs) {
  return Object.entries(attrs || {}).map(([k, v]) => {
    const name = k === 'inputMode' ? 'inputmode' : k;
    return `${name}="${escapeHtml(v)}"`;
  }).join(' ');
}

function renderBarQtyCells(bar, ep, ctx) {
  const pid = ep.product_id;
  const barId = bar.id;
  const barName = escapeHtml(bar.name);
  const serves = barServesProduct(ctx.barProducts, barId, pid);
  const product = ep.product;
  const mode = countEntryMode(product, ctx.caseSizes);
  const line = countLineFor(ctx.lines, barId, pid);
  const form = countStoredToForm(line);
  const hasCases = form.cases !== '' && parseFloat(form.cases) > 0;
  const hasSingles = form.singles !== '' && parseFloat(form.singles) > 0;

  if (!serves) {
    return `
      <td colspan="2" class="dist-cell dist-cell--off" data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
        <button type="button" class="dist-cell-add" title="Add to ${barName} menu" aria-label="Add to ${barName} menu">
          ${icon('plus', { size: 14, strokeWidth: 2.5 })}
        </button>
      </td>`;
  }

  const primary = inputAttrsPrimary();
  const secondary = mode.columnLabels.secondary ? inputAttrsForSecondary(mode) : null;
  const primaryLabel = `${mode.columnLabels.primary} at ${bar.name}`;
  const secondaryLabel = mode.columnLabels.secondary
    ? `${mode.columnLabels.secondary} at ${bar.name}`
    : '';

  const casesCell = `
    <td class="dist-cell dist-cell--on cnt-qty-cell cnt-qty-cell--cases${hasCases ? ' cnt-qty-cell--filled' : ''}"
      data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
      <input type="text" class="cnt-inp cnt-inp--primary"
        data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}"
        ${attrString(primary)}
        value="${form.cases !== '' ? escapeHtml(form.cases) : ''}"
        placeholder="—"
        aria-label="${escapeHtml(primaryLabel)}">
      <button type="button" class="dist-cell-remove cnt-cell-remove" title="Remove from ${barName} menu" aria-label="Remove from ${barName} menu">
        ${icon('x', { size: 14 })}
      </button>
    </td>`;

  const singlesCell = secondary
    ? `
    <td class="dist-cell dist-cell--on cnt-qty-cell cnt-qty-cell--singles${hasSingles ? ' cnt-qty-cell--filled' : ''}"
      data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
      <input type="text" class="cnt-inp cnt-inp--secondary"
        data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}"
        ${attrString(secondary)}
        value="${form.singles !== '' ? escapeHtml(form.singles) : ''}"
        placeholder="—"
        aria-label="${escapeHtml(secondaryLabel)}">
    </td>`
    : `
    <td class="dist-cell dist-cell--on cnt-qty-cell cnt-qty-cell--singles cnt-qty-cell--na"
      data-bar="${escapeHtml(barId)}" data-pid="${escapeHtml(pid)}">
      <span class="muted">—</span>
    </td>`;

  return casesCell + singlesCell;
}

function renderProductRow(ep, ctx) {
  const pid = ep.product_id;
  const pack = productStockPack(ep.product, ctx.caseSizes);

  let html = `<tr class="dist-prod-row cnt-prod-row" data-pid="${escapeHtml(pid)}">
    <th class="dist-sticky dist-prod-name" scope="row">${escapeHtml(ep.product.name)}</th>
    <td class="dist-sticky dist-prod-pack muted">${escapeHtml(pack?.label || ep.product.case_size || '—')}</td>`;

  ctx.bars.forEach((b) => {
    html += renderBarQtyCells(b, ep, ctx);
  });

  return `${html}</tr>`;
}

function barColCount(ctx) {
  return ctx.bars.length * 2;
}

function renderGridHead(ctx) {
  let row1 = `<tr class="cnt-head-row cnt-head-row1">
    <th class="dist-sticky dist-col-header dist-col-product" rowspan="2">
      <div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div>
    </th>
    <th class="dist-sticky dist-col-header dist-col-pack" rowspan="2">
      <div class="dist-bar-head"><span class="dist-bar-name">Pack</span></div>
    </th>`;

  ctx.bars.forEach((b) => {
    row1 += `<th class="dist-bar-header cnt-bar-group" colspan="2">
      <div class="dist-bar-head">
        <span class="dist-bar-name">${escapeHtml(b.name)}</span>
      </div>
    </th>`;
  });
  row1 += '</tr>';

  let row2 = '<tr class="cnt-head-row cnt-head-row2">';
  ctx.bars.forEach(() => {
    row2 += `
      <th class="cnt-qty-header">C</th>
      <th class="cnt-qty-header">S</th>`;
  });
  row2 += '</tr>';

  return row1 + row2;
}

function renderGridBody(ctx) {
  const filtered = filterProducts(ctx);
  const colSpan = 2 + barColCount(ctx);
  let html = '';

  const grouped = groupByCategory(filtered);
  Object.keys(grouped).sort().forEach((cat) => {
    html += `<tr class="dist-cat-row">
      <td colspan="2" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
      <td colspan="${barColCount(ctx)}" class="dist-cat-scroll"></td>
    </tr>`;
    grouped[cat].forEach((ep) => {
      html += renderProductRow(ep, ctx);
    });
  });

  return html || `<tr><td colspan="${colSpan}" class="dist-empty">No products match your filter.</td></tr>`;
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

function applyCntStickyOffsets(grid, panelEl) {
  if (!grid) return;
  const rs = getComputedStyle(panelEl);
  const productW = rs.getPropertyValue('--dist-product-w').trim() || '200px';
  grid.style.setProperty('--col-pack-left', productW);
  grid.closest('.dist-grid-wrap')?.style.setProperty('--dist-scroll-hint-left', productW);
}

function sessionProgress(ctx) {
  let total = 0;
  let counted = 0;
  ctx.eps.forEach((ep) => {
    ctx.bars.forEach((bar) => {
      if (!barServesProduct(ctx.barProducts, bar.id, ep.product_id)) return;
      total += 1;
      const line = countLineFor(ctx.lines, bar.id, ep.product_id);
      if (line && hasQuantity(line.cases, line.singles)) counted += 1;
    });
  });
  return { counted, total };
}

function renderSessionBar(ctx) {
  if (!ctx.sessions.length) {
    return `<div class="cnt-session-bar cnt-session-bar--empty muted">No count session yet — use <strong>New count session</strong> in the toolbar.</div>`;
  }

  const opts = ctx.sessions.map((s) => {
    const selected = s.id === ctx.activeSessionId ? ' selected' : '';
    const bar = s.bar_id
      ? servingBars(ctx.event?.bars).find((b) => b.id === s.bar_id)?.name
      : 'All bars';
    return `<option value="${escapeHtml(s.id)}"${selected}>${escapeHtml(s.name || 'Count')} · ${escapeHtml(fmtDateTime(s.counted_at))}${bar ? ` · ${escapeHtml(bar)}` : ''}</option>`;
  }).join('');

  const prog = sessionProgress(ctx);
  const pct = prog.total ? Math.round((prog.counted / prog.total) * 100) : 0;

  return `
    <div class="cnt-session-bar">
      <label class="cnt-session-label admin-label" for="cntSessionSelect">Session</label>
      <select class="admin-select cnt-session-select" id="cntSessionSelect">${opts}</select>
      <span class="cnt-session-progress muted">${prog.counted}/${prog.total} cells · ${pct}%</span>
      <button type="button" class="topbar-tool del-card-action del-card-action--danger" id="cntDeleteSession"
        title="Delete session" aria-label="Delete session">
        ${icon('trash', { size: 16 })}
      </button>
    </div>`;
}

export function renderCountsShell() {
  return `
    <div class="dist-panel cnt-panel" id="cntPanel">
      <div class="dist-loading">Loading counts…</div>
    </div>`;
}

export function mountCountsPanel(route) {
  const panel = $('cntPanel');
  if (!panel) return () => {};

  const ctx = {
    eventId: route.eventId,
    event: null,
    caseSizes: [],
    sessions: [],
    activeSessionId: null,
    lines: [],
    barProducts: [],
    bars: [],
    eps: [],
    searchQuery: '',
    saveTimers: {},
    theadObserver: null,
    gridWrap: null,
    abort: false,
  };

  function syncGridLayout() {
    const wrap = panel.querySelector('.dist-grid-wrap');
    if (!wrap) return;
    requestAnimationFrame(() => {
      const grid = panel.querySelector('.dist-grid');
      const headRow1 = panel.querySelector('.cnt-head-row1');
      const headRow2 = panel.querySelector('.cnt-head-row2');
      if (headRow1 && headRow2) {
        const h1 = headRow1.getBoundingClientRect().height;
        wrap.style.setProperty('--cnt-head-row1-h', `${h1}px`);
        wrap.style.setProperty('--dist-thead-h', `${h1 + headRow2.getBoundingClientRect().height}px`);
      }
      applyCntStickyOffsets(grid, panel);
      wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 8);
    });
  }

  function paintGrid() {
    const thead = panel.querySelector('#cntGridHead');
    const tbody = panel.querySelector('#cntGridBody');
    if (thead) thead.innerHTML = renderGridHead(ctx);
    if (tbody) tbody.innerHTML = renderGridBody(ctx);
    syncGridLayout();
  }

  function paint() {
    ctx.searchQuery = getLastProductFilter().query || ctx.searchQuery;

    if (!ctx.activeSessionId) {
      panel.innerHTML = `
        ${renderSessionBar(ctx)}
        <div class="empty-state"><p>Start a count session to enter stock by bar.</p></div>`;
      bindSessionBar();
      return;
    }

    if (!ctx.eps.length || !ctx.bars.length) {
      panel.innerHTML = `
        ${renderSessionBar(ctx)}
        <div class="empty-state"><p>Add products and bars in Event Setup first.</p></div>`;
      bindSessionBar();
      return;
    }

    panel.innerHTML = `
      ${renderSessionBar(ctx)}
      <div class="dist-grid-wrap">
        <table class="dist-grid cnt-grid" id="cntGrid">
          <thead id="cntGridHead">${renderGridHead(ctx)}</thead>
          <tbody id="cntGridBody">${renderGridBody(ctx)}</tbody>
        </table>
      </div>`;

    bindSessionBar();
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', onPanelInput);
    bindGridLayoutSync();
  }

  function bindSessionBar() {
    $('cntSessionSelect')?.addEventListener('change', (e) => {
      switchSession(e.target.value);
    });
    $('cntDeleteSession')?.addEventListener('click', () => {
      if (ctx.activeSessionId) deleteSession(ctx.activeSessionId);
    });
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

  function updateSessionBarProgress() {
    const el = panel.querySelector('.cnt-session-progress');
    if (!el) return;
    const prog = sessionProgress(ctx);
    const pct = prog.total ? Math.round((prog.counted / prog.total) * 100) : 0;
    el.textContent = `${prog.counted}/${prog.total} cells · ${pct}%`;
  }

  function markQtyCells(bar, pid, stored) {
    const casesCell = panel.querySelector(
      `.cnt-qty-cell--cases[data-bar="${bar}"][data-pid="${pid}"]`,
    );
    const singlesCell = panel.querySelector(
      `.cnt-qty-cell--singles[data-bar="${bar}"][data-pid="${pid}"]`,
    );
    casesCell?.classList.toggle('cnt-qty-cell--filled', stored.cases > 0);
    singlesCell?.classList.toggle('cnt-qty-cell--filled', stored.singles > 0);
  }

  async function switchSession(id) {
    if (!id || id === ctx.activeSessionId) return;
    ctx.activeSessionId = id;
    const DB = getDB();
    ctx.lines = await DB.stockCounts.lines(id);
    panel.removeEventListener('click', onPanelClick);
    panel.removeEventListener('input', onPanelInput);
    paint();
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
      const cell = removeBtn.closest('[data-bar][data-pid]');
      if (cell) disableProductOnBar(cell.dataset.bar, cell.dataset.pid);
    }
  }

  function onPanelInput(e) {
    if (!e.target.matches('.cnt-inp')) return;
    const { bar, pid } = e.target.dataset;
    if (!bar || !pid) return;
    persistCell(bar, pid);
  }

  function persistCell(bar, pid) {
    const casesEl = panel.querySelector(
      `.cnt-inp--primary[data-bar="${bar}"][data-pid="${pid}"]`,
    );
    const singlesEl = panel.querySelector(
      `.cnt-inp--secondary[data-bar="${bar}"][data-pid="${pid}"]`,
    );
    const stored = formToCountStored({
      cases: casesEl?.value,
      singles: singlesEl?.value,
    });
    markQtyCells(bar, pid, stored);
    updateSessionBarProgress();

    const line = countLineFor(ctx.lines, bar, pid);
    if (line) {
      line.cases = stored.cases;
      line.singles = stored.singles;
    }

    const key = `${bar}:${pid}`;
    clearTimeout(ctx.saveTimers[key]);
    ctx.saveTimers[key] = setTimeout(() => saveLine(bar, pid, stored, line), 450);
  }

  async function saveLine(barId, productId, stored, existing) {
    if (!ctx.activeSessionId) return;
    const DB = getDB();
    try {
      if (!hasQuantity(stored.cases, stored.singles)) {
        if (existing?.id) {
          await DB.remove('stock_count_lines', 'id=eq.' + DB._.enc(existing.id));
          ctx.lines = ctx.lines.filter((l) => l.id !== existing.id);
        }
      } else if (existing?.id) {
        await DB.update('stock_count_lines', 'id=eq.' + DB._.enc(existing.id), {
          cases: stored.cases,
          singles: stored.singles,
        });
      } else {
        const inserted = await DB.stockCounts.addLines([{
          count_id: ctx.activeSessionId,
          product_id: productId,
          bar_id: barId,
          cases: stored.cases,
          singles: stored.singles,
        }]);
        if (inserted?.[0]) ctx.lines.push(inserted[0]);
      }
    } catch (err) {
      toast(err.message || 'Failed to save count', true);
    }
  }

  async function enableProductOnBar(barId, productId) {
    const DB = getDB();
    if (barServesProduct(ctx.barProducts, barId, productId)) {
      focusCellInput(barId, productId);
      return;
    }
    try {
      const needsBackfill = !hasBarMenu(ctx.barProducts, barId);
      const rows = needsBackfill
        ? ctx.eps.map((ep) => ({ event_id: ctx.eventId, bar_id: barId, product_id: ep.product_id }))
        : [{ event_id: ctx.eventId, bar_id: barId, product_id: productId }];
      const saved = await DB.barProducts.createMany(rows);
      ctx.barProducts.push(...(Array.isArray(saved) && saved.length ? saved : rows));
      paintGrid();
      focusCellInput(barId, productId);
    } catch (err) {
      toast(err.message || 'Failed to add product to bar', true);
    }
  }

  async function disableProductOnBar(barId, productId) {
    const DB = getDB();
    if (!barServesProduct(ctx.barProducts, barId, productId)) return;

    const line = countLineFor(ctx.lines, barId, productId);
    if (line && hasQuantity(line.cases, line.singles)) {
      const ok = confirm('This cell has a count entered. Removing from the bar menu will delete it. Continue?');
      if (!ok) return;
      if (line.id) {
        await DB.remove('stock_count_lines', 'id=eq.' + DB._.enc(line.id));
        ctx.lines = ctx.lines.filter((l) => l.id !== line.id);
      }
    }

    try {
      const hadCustom = hasBarMenu(ctx.barProducts, barId);
      if (!hadCustom) {
        const rows = ctx.eps
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
      paintGrid();
    } catch (err) {
      toast(err.message || 'Failed to remove product from bar', true);
    }
  }

  function focusCellInput(barId, productId) {
    requestAnimationFrame(() => {
      const field = panel.querySelector(
        `.cnt-inp--primary[data-bar="${barId}"][data-pid="${productId}"]`,
      );
      field?.focus();
      field?.select?.();
    });
  }

  function openNewSessionSheet() {
    openSheet({
      title: 'New count session',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="cntNewErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="cntNewName">Session name</label>
            <input class="admin-input" type="text" id="cntNewName" placeholder="e.g. Friday close">
          </div>
          <p class="muted cnt-new-hint">Count all bars in the grid — pick a bar column and enter cases and singles per product.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="cntNewCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="cntNewSave">Create session</button>
        </div>`,
    });
    $('cntNewCancel').onclick = closeSheet;
    $('cntNewSave').onclick = createSession;
    requestAnimationFrame(() => $('cntNewName')?.focus());
  }

  async function createSession() {
    const name = ($('cntNewName')?.value || '').trim();
    if (!name) {
      $('cntNewErr').textContent = 'Enter a session name.';
      return;
    }
    try {
      const DB = getDB();
      const created = await DB.insert('stock_counts', [{
        event_id: ctx.eventId,
        name,
        bar_id: null,
        counted_at: new Date().toISOString(),
      }]);
      closeSheet();
      const session = created[0];
      ctx.sessions.unshift(session);
      ctx.activeSessionId = session.id;
      ctx.lines = [];
      panel.removeEventListener('click', onPanelClick);
      panel.removeEventListener('input', onPanelInput);
      paint();
      toast('Count session created');
    } catch (err) {
      $('cntNewErr').textContent = err.message || 'Failed to create session';
    }
  }

  async function deleteSession(id) {
    if (!confirm('Delete this count session and all its lines?')) return;
    try {
      const DB = getDB();
      await DB.stockCounts.clearLines(id);
      await DB.remove('stock_counts', 'id=eq.' + DB._.enc(id));
      ctx.sessions = ctx.sessions.filter((s) => s.id !== id);
      if (ctx.activeSessionId === id) {
        ctx.activeSessionId = ctx.sessions[0]?.id || null;
        ctx.lines = ctx.activeSessionId
          ? await DB.stockCounts.lines(ctx.activeSessionId)
          : [];
      }
      panel.removeEventListener('click', onPanelClick);
      panel.removeEventListener('input', onPanelInput);
      paint();
      toast('Count session deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  async function reload() {
    const DB = getDB();
    const [event, caseSizes, sessions] = await Promise.all([
      loadEventFull(ctx.eventId),
      loadCaseSizes(),
      DB.stockCounts.forEvent(ctx.eventId),
    ]);
    if (ctx.abort) return;

    ctx.event = event;
    ctx.caseSizes = caseSizes || [];
    ctx.sessions = (sessions || []).slice().reverse();
    ctx.barProducts = event?.bar_products || [];
    ctx.bars = servingBars(event?.bars);
    ctx.eps = eventProducts(event);

    if (!ctx.activeSessionId && ctx.sessions.length) {
      ctx.activeSessionId = ctx.sessions[0].id;
    }
    ctx.lines = ctx.activeSessionId
      ? await DB.stockCounts.lines(ctx.activeSessionId)
      : [];

    paint();
  }

  function onProductFilter(e) {
    ctx.searchQuery = e.detail?.query || '';
    if (!ctx.activeSessionId) {
      e.detail.handled = true;
      return;
    }
    paintGrid();
    if (e.detail?.scroll && e.detail?.productId) {
      panel.querySelector(`[data-pid="${e.detail.productId}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    e.detail.handled = true;
  }

  function handlePrintCountSheets() {
    if (!ctx.event) {
      toast('Counts are still loading', true);
      return;
    }
    const result = printCountSheets({
      event: ctx.event,
      barProducts: ctx.barProducts,
      caseSizes: ctx.caseSizes,
    });
    if (result.error) {
      toast(result.error, true);
      return;
    }
    toast(`Opened ${result.barCount} count sheet${result.barCount === 1 ? '' : 's'}`);
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-count') {
      e.detail.handled = true;
      openNewSessionSheet();
      return;
    }
    if (e.detail?.action === 'print-count-sheets') {
      e.detail.handled = true;
      handlePrintCountSheets();
    }
  };

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  reload().catch((err) => {
    panel.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message || 'Failed to load')}</p></div>`;
  });

  return () => {
    ctx.abort = true;
    Object.values(ctx.saveTimers).forEach(clearTimeout);
    ctx.theadObserver?.disconnect();
    ctx.gridWrap?.removeEventListener('scroll', syncGridLayout);
    window.removeEventListener('resize', syncGridLayout);
    panel.removeEventListener('click', onPanelClick);
    panel.removeEventListener('input', onPanelInput);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  };
}
