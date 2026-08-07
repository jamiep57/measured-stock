import { $, escapeHtml, rid, toast, isBoneYard, syncChromeSizes } from './lib/util.js';
import { getDB } from './db.js';
import { filterEventProductsForBar, hasBarMenu } from './bar-products.js';
import { countEntryMode } from './pack-metrics.js';
import {
  formToCountStored,
  countStoredToForm,
  hasQuantity,
  totalUnitsForProduct,
  parseQty,
} from './stock-entry.js';
import { enqueueWrite, flushQueue, getQueueStats } from './sync-queue.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { mountSearchSelect } from './components/search-select.js';
import { confirmDialog } from './components/modal.js';
import { emptyState, errorState, bindEmptyRetry } from './components/empty-state.js';
import { loadingWidget } from './components/loading-widget.js';
import { scheduleDestructive } from './lib/action-undo.js';
import { reportError } from './lib/client-errors.js';

let ctx = null;
let counts = [];
let activeCountId = null;
let activeCountBar = null;
let activeLines = [];
let countTimers = {};

const SAVE_BAR_H = '62px';

export function initCounts(context) {
  ctx = context;
  $('cntSaveBtn')?.addEventListener('click', saveActiveCount);
  $('cntBackTop')?.addEventListener('click', closeActiveCount);
}

function enterCountMode() {
  document.documentElement.classList.add('counting');
  document.documentElement.classList.add('has-back');
  const back = $('cntBackTop');
  if (back) back.hidden = false;
  showCountSaveBar();
  syncChromeSizes();
}

function exitCountMode() {
  document.documentElement.classList.remove('counting');
  document.documentElement.classList.remove('has-back');
  const back = $('cntBackTop');
  if (back) back.hidden = true;
  hideCountSaveBar();
  syncChromeSizes();
}

function showCountSaveBar() {
  const bar = $('cntSaveBar');
  if (bar) bar.hidden = false;
  document.documentElement.style.setProperty('--save-bar-h', SAVE_BAR_H);
}

function hideCountSaveBar() {
  const bar = $('cntSaveBar');
  if (bar) bar.hidden = true;
  document.documentElement.style.setProperty('--save-bar-h', '0px');
}

export function onCountsTabVisible(visible) {
  if (visible && activeCountId) enterCountMode();
  else if (!activeCountId) exitCountMode();
}

export async function loadCountsView() {
  const el = $('view-counts');
  if (!ctx.eventId) {
    exitCountMode();
    el.innerHTML = emptyState({
      icon: 'calendar-blank',
      title: 'Choose an event',
      copy: 'Select an event in the top bar to start a stock count.',
    });
    return;
  }

  if (!activeCountId) {
    el.innerHTML = loadingWidget('Loading counts…');
  }

  try {
    counts = await getDB().stockCounts.forEvent(ctx.eventId);
  } catch (err) {
    reportError(err, { source: 'loadCountsView', silent: true });
    el.innerHTML = errorState({
      title: 'Couldn’t load counts',
      copy: err.message || 'Check your connection and try again.',
    });
    bindEmptyRetry(el, () => loadCountsView());
    return;
  }

  if (activeCountId) {
    renderActiveCount();
    return;
  }

  el.innerHTML = `
    <div class="page-hero page-hero--compact">
      <p class="page-kicker">Stock</p>
      <h1 class="page-title">Counts</h1>
      <p class="page-sub">Open a session and work through bar stock.</p>
    </div>
    <div id="countList" class="session-list"></div>
  `;
  renderCountList();
}

function renderCountList() {
  const list = $('countList');
  if (!list) return;
  if (!counts.length) {
    list.innerHTML = emptyState({
      icon: 'clipboard-text',
      title: 'No sessions yet',
      copy: 'Start a count session and work through each bar.',
      ctaHtml: '<button type="button" class="btn btn-primary empty-retry-btn" data-empty-cta="count">New count</button>',
    });
    list.querySelector('[data-empty-cta="count"]')?.addEventListener('click', () => startNewCount());
    return;
  }
  list.innerHTML = `
    <h2 class="section-label">Sessions</h2>
    ${counts.map((c) => {
    const bar = (ctx.event?.bars || []).find((b) => b.id === c.bar_id);
    const when = new Date(c.counted_at).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return `
      <div class="session-card">
        <button type="button" class="session-card-main" data-open="${c.id}">
          <span class="session-card-title">${escapeHtml(c.name || 'Count')}</span>
          <span class="session-card-meta">${escapeHtml(bar?.name || 'All bars')} · ${escapeHtml(when)}</span>
        </button>
        <button class="icon-btn session-card-del" type="button" data-del="${c.id}" aria-label="Delete">
          <i class="ph ph-trash"></i>
        </button>
      </div>`;
  }).join('')}`;

  list.querySelectorAll('[data-open]').forEach((btn) => {
    btn.onclick = async () => activateCount(btn.dataset.open);
  });
  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      deleteCount(btn.dataset.del);
    };
  });
}

function openNewCountSheet() {
  const bars = (ctx.event?.bars || []).filter((b) => !isBoneYard(b));
  openSheet({
    title: 'New count session',
    bodyHtml: `
      <div class="err" id="ncErr"></div>
      <div class="field"><label for="ncName">Session name</label><input type="text" id="ncName" placeholder="e.g. Friday close"></div>
      <div class="field"><label for="ncBarInput">Bar</label>
        <div id="ncBarMount"></div>
      </div>`,
    footHtml: `
      <div class="sheet-foot-row">
        <button class="btn" type="button" id="ncCancel">Cancel</button>
        <button class="btn btn-primary" type="button" id="ncSave">Create & count</button>
      </div>`,
  });
  mountSearchSelect($('ncBarMount'), {
    options: bars.map((b) => ({
      value: b.id,
      label: b.name || 'Bar',
      meta: 'Bar',
    })),
    value: '',
    placeholder: 'Search bars…',
    emptyLabel: 'All bars',
    allowEmpty: true,
    hiddenId: 'ncBar',
    inputId: 'ncBarInput',
    inputClass: 'search-select-input',
  });
  $('ncCancel').onclick = closeSheet;
  $('ncSave').onclick = createCountSession;
}

/** Open the new count session sheet (requires an event). */
export function startNewCount() {
  if (!ctx?.eventId) {
    toast('Choose an event first', true);
    return false;
  }
  openNewCountSheet();
  return true;
}

async function createCountSession() {
  const name = ($('ncName').value || '').trim();
  if (!name) { $('ncErr').textContent = 'Enter a session name.'; return; }
  const barId = $('ncBar').value || null;
  try {
    const DB = getDB();
    const created = await DB.insert('stock_counts', [{
      event_id: ctx.eventId,
      name,
      bar_id: barId,
      counted_at: new Date().toISOString(),
    }]);
    closeSheet();
    counts.unshift(created[0]);
    await activateCount(created[0].id);
    toast('Count session created');
  } catch (err) {
    $('ncErr').textContent = err.message || 'Failed to create session';
  }
}

async function deleteCount(id) {
  if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this count session?', confirmLabel: 'Delete', danger: true }))) return;
  const removed = counts.find((c) => c.id === id);
  const idx = counts.findIndex((c) => c.id === id);
  const wasActive = activeCountId === id;
  if (idx >= 0) {
    counts = counts.filter((c) => c.id !== id);
    if (wasActive) {
      activeCountId = null;
      activeLines = [];
    }
    loadCountsView();
  }
  scheduleDestructive({
    message: 'Count deleted',
    delayMs: 6000,
    commit: async () => {
      await getDB().stockCounts.clearLines(id);
      await getDB().remove('stock_counts', 'id=eq.' + getDB()._.enc(id));
    },
    onUndo: () => {
      if (removed && idx >= 0) {
        counts = [...counts.slice(0, idx), removed, ...counts.slice(idx)];
        if (wasActive) {
          activeCountId = id;
          activateCount(id).catch(() => loadCountsView());
        } else {
          loadCountsView();
        }
      }
    },
  });
}

async function activateCount(id) {
  activeCountId = id;
  const session = counts.find((c) => c.id === id);
  const bars = (ctx.event?.bars || []).filter((b) => !isBoneYard(b));
  activeCountBar = session?.bar_id || bars[0]?.id || null;
  activeLines = await getDB().stockCounts.lines(id);
  renderActiveCount();
}

function closeActiveCount() {
  activeCountId = null;
  activeLines = [];
  exitCountMode();
  loadCountsView();
}

async function renderActiveCount() {
  const session = counts.find((c) => c.id === activeCountId);
  const el = $('view-counts');
  const bars = (ctx.event?.bars || []).filter((b) => !isBoneYard(b));
  const showBarPicker = !session?.bar_id && bars.length > 1;
  const lockedBar = session?.bar_id
    ? (ctx.event?.bars || []).find((b) => b.id === session.bar_id)
    : null;
  const activeBar = bars.find((b) => b.id === activeCountBar);

  el.innerHTML = `
    <div class="count-panel-head">
      <h2>${escapeHtml(session?.name || 'Count')}</h2>
      ${lockedBar ? `<p class="count-panel-meta">${escapeHtml(lockedBar.name)}</p>` : ''}
      ${showBarPicker ? `<div class="chips" id="cntBarChips">${bars.map((b) =>
    `<button type="button" class="chip${activeCountBar === b.id ? ' active' : ''}" data-bar="${b.id}">${escapeHtml(b.name)}</button>`
  ).join('')}</div>` : ''}
      ${activeBar && hasBarMenu(ctx.event?.bar_products, activeBar.id)
    ? `<p class="count-panel-hint">Showing products assigned to ${escapeHtml(activeBar.name)}</p>`
    : activeBar
      ? `<p class="count-panel-hint">No bar menu set — showing all event products</p>`
      : ''}
      <div class="search-wrap"><input type="search" id="cntSearch" placeholder="Search products…"></div>
      <div class="progress"><div class="progress-fill" id="cntProgressFill"></div></div>
      <div class="progress-meta">
        <span id="cntProgressVal">0/0</span>
        <span id="cntStatsLabel">—</span>
      </div>
    </div>
    <div id="cntItemList"></div>
  `;

  $('cntSearch').oninput = filterCountItems;
  if (showBarPicker) {
    $('cntBarChips').querySelectorAll('[data-bar]').forEach((chip) => {
      chip.onclick = async () => {
        activeCountBar = chip.dataset.bar;
        renderActiveCount();
      };
    });
  }
  enterCountMode();
  renderCountItems();
}

async function saveActiveCount() {
  if (!activeCountId) return;

  Object.keys(countTimers).forEach((pid) => {
    clearTimeout(countTimers[pid]);
    delete countTimers[pid];
  });

  const pids = Array.from(document.querySelectorAll('#cntItemList .count-item')).map((el) => el.dataset.pid);
  const btn = $('cntSaveBtn');
  if (!btn) return;
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="ph-bold ph-floppy-disk"></i> Saving…';

  try {
    for (const pid of pids) {
      await persistCountLine(pid);
    }
    await flushQueue(getDB());
    activeLines = await getDB().stockCounts.lines(activeCountId);
    liveCountStats();
    toast('Count saved');
  } catch (err) {
    console.error('saveActiveCount', err);
    toast(err.message || 'Save failed — check connection', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

function renderCountItems() {
  const session = counts.find((c) => c.id === activeCountId);
  const barId = activeCountBar || session?.bar_id;
  const barProducts = ctx.event?.bar_products || [];
  const eps = filterEventProductsForBar(ctx.event?.event_products, barProducts, barId);
  const activeBar = (ctx.event?.bars || []).find((b) => b.id === barId);
  const grouped = {};
  eps.forEach((ep) => {
    const cat = ep.product.category?.name || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(ep);
  });

  let html = '';
  Object.keys(grouped).sort().forEach((cat) => {
    html += `<div class="cat-head" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</div>`;
    grouped[cat].sort((a, b) => a.product.name.localeCompare(b.product.name)).forEach((ep) => {
      const pid = ep.product_id;
      const line = activeLines.find((l) => l.product_id === pid && l.bar_id === barId);
      const form = countStoredToForm(line);
      const mode = countEntryMode(ep.product, ctx.caseSizes);
      const counted = line && hasQuantity(line.cases, line.singles);

      html += `<div class="count-item${counted ? ' counted' : ''}" data-pid="${pid}" data-name="${escapeHtml(ep.product.name.toLowerCase())}">`;
      html += `<div class="count-item-info"><div class="count-item-name">${escapeHtml(ep.product.name)}</div>`;
      html += `<div class="count-item-sub">${escapeHtml(mode.pack.label || ep.product.case_size || '—')}</div></div>`;
      html += `<div class="count-inputs">`;
      html += `<div class="cell"><label>${escapeHtml(mode.columnLabels.primary)}</label>`;
      html += `<input type="text" inputmode="decimal" autocomplete="off" class="cnt-cases num-math" id="cnt-cases-${pid}" data-pid="${pid}" value="${form.cases !== '' ? escapeHtml(form.cases) : ''}" placeholder="0"></div>`;
      if (mode.columnLabels.secondary) {
        const step = mode.secondaryStep || '1';
        html += `<div class="cell"><label>${escapeHtml(mode.columnLabels.secondary)}</label>`;
        html += `<input type="text" inputmode="${step === '0.1' ? 'decimal' : 'numeric'}" autocomplete="off" class="cnt-singles num-math" id="cnt-singles-${pid}" data-pid="${pid}" value="${form.singles !== '' ? escapeHtml(form.singles) : ''}" placeholder="0"></div>`;
      }
      html += `</div></div>`;
    });
  });

  $('cntItemList').innerHTML = html || (
    barId
      ? `<div class="empty empty--panel">
          <span class="empty-icon" aria-hidden="true"><i class="ph ph-package"></i></span>
          <p class="empty-title">Nothing on this bar</p>
          <p class="empty-copy">No products assigned to ${escapeHtml(activeBar?.name || 'this bar')} in Distribution.</p>
        </div>`
      : `<div class="empty empty--panel">
          <span class="empty-icon" aria-hidden="true"><i class="ph ph-map-pin"></i></span>
          <p class="empty-title">Select a bar</p>
          <p class="empty-copy">Choose a bar above to start counting.</p>
        </div>`
  );

  $('cntItemList').querySelectorAll('.cnt-cases, .cnt-singles').forEach((input) => {
    input.addEventListener('input', () => {
      liveCountStats();
      schedulePersist(input.dataset.pid);
    });
  });
  liveCountStats();
  filterCountItems();
}

function liveCountStats() {
  const items = document.querySelectorAll('#cntItemList .count-item');
  let total = 0;
  let counted = 0;
  items.forEach((el) => {
    total++;
    const pid = el.dataset.pid;
    const c = parseQty($('cnt-cases-' + pid)?.value);
    const s = parseQty($('cnt-singles-' + pid)?.value);
    const isC = !!(c || s);
    if (isC) counted++;
    el.classList.toggle('counted', isC);
  });
  $('cntProgressVal').textContent = `${counted}/${total} counted`;
  $('cntProgressFill').style.width = (total ? Math.round((counted / total) * 100) : 0) + '%';
  $('cntStatsLabel').textContent = `${counted} lines entered`;
}

function filterCountItems() {
  const q = ($('cntSearch')?.value || '').trim().toLowerCase();
  const list = $('cntItemList');
  if (!list) return;
  let catEl = null;
  let visible = 0;
  Array.from(list.children).forEach((el) => {
    if (el.classList.contains('cat-head')) {
      if (catEl) catEl.style.display = visible ? '' : 'none';
      catEl = el;
      visible = 0;
      return;
    }
    const show = !q || (el.dataset.name || '').includes(q);
    el.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  if (catEl) catEl.style.display = visible ? '' : 'none';
}

function schedulePersist(pid) {
  clearTimeout(countTimers[pid]);
  countTimers[pid] = setTimeout(() => persistCountLine(pid), 400);
}

async function persistCountLine(pid) {
  const session = counts.find((c) => c.id === activeCountId);
  if (!session) return;
  const barId = activeCountBar || session.bar_id;
  const casesEl = $('cnt-cases-' + pid);
  const singlesEl = $('cnt-singles-' + pid);
  const stored = formToCountStored({
    cases: casesEl?.value,
    singles: singlesEl?.value,
  });

  const dedupeKey = `count:${activeCountId}:${pid}:${barId || 'none'}`;
  const line = activeLines.find((l) => l.product_id === pid && l.bar_id === barId);

  if (!hasQuantity(stored.cases, stored.singles)) {
    if (line?.id) {
      await enqueueWrite({
        op: 'delete',
        table: 'stock_count_lines',
        payload: { id: line.id },
        dedupeKey,
      });
      activeLines = activeLines.filter((l) => l.id !== line.id);
    }
  } else if (line?.id) {
    line.cases = stored.cases;
    line.singles = stored.singles;
    await enqueueWrite({
      op: 'update',
      table: 'stock_count_lines',
      payload: {
        id: line.id,
        patch: { cases: stored.cases, singles: stored.singles },
      },
      dedupeKey,
    });
  } else {
    const tempId = rid('tmp');
    const optimistic = {
      id: tempId,
      count_id: activeCountId,
      product_id: pid,
      bar_id: barId,
      cases: stored.cases,
      singles: stored.singles,
    };
    activeLines.push(optimistic);
    await enqueueWrite({
      op: 'insert',
      table: 'stock_count_lines',
      payload: {
        row: {
          count_id: activeCountId,
          product_id: pid,
          bar_id: barId,
          cases: stored.cases,
          singles: stored.singles,
        },
      },
      dedupeKey,
    });
  }

  await flushQueue(getDB());
  const stats = await getQueueStats();
  if (stats.total === 0) {
    activeLines = await getDB().stockCounts.lines(activeCountId);
  }
}

export async function flushPendingCounts() {
  await flushQueue(getDB());
  if (activeCountId) {
    activeLines = await getDB().stockCounts.lines(activeCountId);
  }
}
