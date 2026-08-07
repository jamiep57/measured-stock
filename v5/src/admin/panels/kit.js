/**
 * Admin event Kit panel — planning sheet (own vs hire-in).
 *
 * Need   = qty planned for the event
 * Source = planned cover: Own (warehouse) or Hire-in
 * Avail  = warehouse on-hand (scoped to selected warehouse when set)
 * On event = owned / hired already sent (from movements)
 * Packed = secondary dispatch checklist
 */

import {
  $, escapeHtml, rid, toast, nowLocalInput, fmtDateTime,
} from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadEventKit, loadKitLibraryProducts, loadSuppliers,
} from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openModal, closeModal, confirmDialog } from '../../components/modal.js';
import { mountProductSearch } from '../../components/product-search.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
  setTableFilterContext,
} from '../table-filter.js';
import { createGridCollabSession } from '../../lib/collab-presence.js';
import {
  kitCellKeyFromInput,
  kitFindCellEl,
} from '../../lib/grid-collab-keys.js';
import {
  KIT_MOVEMENT_LABELS,
  balancesByProduct,
  validateEventStock,
  affectsWarehouse,
  warehouseQtyDelta,
  normalizeKitSource,
  isOwnSource,
  isOwnShort,
  isHireUncovered,
  isLineShort,
  packListStats,
  contentsByContainer,
  scaledContainerContents,
} from '../../lib/kit-stock.js';
import {
  SCAN_MODE_PACK,
  SCAN_MODE_CHECK_IN,
  SCAN_MODE_LABELS,
  createScanSession,
  updateScanSessionMode,
  startScanPoll,
  findProductByBarcode,
  planPackScan,
  bumpCheckInPending,
  pendingCheckInGroups,
  pendingCheckInTotal,
  scanPageUrl,
  qrImageUrl,
  normalizeScanMode,
  normalizeBarcode,
  resolvePhoneOrigin,
  originWithHost,
  setStoredPhoneOrigin,
  isLoopbackHost,
  scanCodeCandidates,
} from '../../lib/kit-scan-session.js';
import { parseQty } from '../../stock-entry.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function qtyLabel(n) {
  const v = round1(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return String(v);
}

function qtyDisplay(n) {
  const v = round1(n);
  return Number.isFinite(v) ? String(v) : '0';
}

async function adjustWarehouseStock(warehouseId, productId, delta) {
  const DB = getDB();
  const rows = await DB.select(
    'warehouse_stock',
    '?warehouse_id=eq.' + DB._.enc(warehouseId) +
    '&product_id=eq.' + DB._.enc(productId) +
    '&select=qty_on_hand',
  );
  const current = rows?.[0] ? Number(rows[0].qty_on_hand) || 0 : 0;
  const next = round1(current + delta);
  if (next < 0) throw new Error('Insufficient warehouse kit stock');
  await DB.warehouseStock.setQty(warehouseId, productId, next);
}

/** @param {string} [warehouseId] when set, Avail is scoped to that warehouse */
async function loadWarehouseAvail(warehouseId) {
  const DB = getDB();
  try {
    let q = '?select=product_id,qty_on_hand&qty_on_hand=gt.0';
    if (warehouseId) {
      q += '&warehouse_id=eq.' + DB._.enc(warehouseId);
    }
    const rows = await DB.select('warehouse_stock', q);
    const map = new Map();
    for (const row of rows || []) {
      const pid = row.product_id;
      if (!pid) continue;
      map.set(pid, round1((map.get(pid) || 0) + (Number(row.qty_on_hand) || 0)));
    }
    return map;
  } catch {
    return new Map();
  }
}

function groupItems(items) {
  const grouped = {};
  (items || []).forEach((it) => {
    const cat = it.product?.category?.name || 'Uncategorised';
    const order = it.product?.category?.sort_order ?? 9999;
    if (!grouped[cat]) grouped[cat] = { order, rows: [] };
    grouped[cat].rows.push(it);
  });
  Object.values(grouped).forEach((g) => {
    g.rows.sort((a, b) => (a.product?.name || '').localeCompare(b.product?.name || ''));
  });
  const keys = Object.keys(grouped).sort((a, b) => {
    if (grouped[a].order !== grouped[b].order) return grouped[a].order - grouped[b].order;
    return a.localeCompare(b);
  });
  return { grouped, keys };
}

function renderShell() {
  return `
    <div class="admin-page kit-panel">
      <div class="kit-pack-toolbar" id="kitPackToolbar">
        <div class="kit-pack-toolbar-inner">
          <div class="kit-pack-toolbar-controls" id="kitPackToolbarControls"></div>
          <div class="kit-pack-stats muted" id="kitPackStats"></div>
        </div>
      </div>
      <div class="kit-scan-banner" id="kitScanBanner" hidden></div>
      <div class="kit-pack-wrap admin-surface" id="kitItemsWrap">
        <div class="catalog-list-empty">${loadingWidget('Loading kit…')}</div>
      </div>
      <details class="kit-movements-details admin-surface">
        <summary class="kit-movements-summary">
          <span>Movement log</span>
          <span class="kit-movements-count muted" id="kitMovementsCount"></span>
        </summary>
        <div id="kitMovementsWrap"></div>
      </details>
    </div>`;
}

function renderScanBanner({ mode, pairUrl, lastMsg, pendingTotal, committing, phoneOrigin, phoneEditable, phoneCandidates }) {
  const isPack = mode === SCAN_MODE_PACK;
  const pending = pendingTotal > 0;
  let phoneHost = '';
  try { phoneHost = new URL(phoneOrigin || pairUrl).host; } catch { phoneHost = ''; }
  const candidateOpts = (phoneCandidates || [])
    .map((o) => {
      let host = o;
      try { host = new URL(o).host; } catch { /* ignore */ }
      return `<option value="${escapeHtml(host)}"${host === phoneHost ? ' selected' : ''}>${escapeHtml(host)}</option>`;
    }).join('');
  return `
    <div class="kit-scan-banner-inner">
      <div class="kit-scan-banner-main">
        <div class="kit-scan-modes rcn-seg" role="group" aria-label="Scan mode">
          <button type="button" class="rcn-seg-btn${isPack ? ' is-active' : ''}"
            data-kit-scan-mode="${SCAN_MODE_PACK}">${escapeHtml(SCAN_MODE_LABELS[SCAN_MODE_PACK])}</button>
          <button type="button" class="rcn-seg-btn${!isPack ? ' is-active' : ''}"
            data-kit-scan-mode="${SCAN_MODE_CHECK_IN}">${escapeHtml(SCAN_MODE_LABELS[SCAN_MODE_CHECK_IN])}</button>
        </div>
        <div class="kit-scan-status">
          <strong>${isPack ? 'Pack scan' : 'Check-in scan'}</strong>
          <span class="muted">${isPack
            ? 'Phone scans add to Packed (and add missing library items).'
            : 'Phone scans build a return batch — commit when done.'}</span>
          ${lastMsg ? `<span class="kit-scan-last">${escapeHtml(lastMsg)}</span>` : ''}
        </div>
        ${!isPack ? `
          <div class="kit-scan-pending">
            <span class="kit-scan-pending-count">${pending ? escapeHtml(String(pendingTotal)) + ' to check in' : 'No scans yet'}</span>
            <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="kitScanCommit"
              ${pending && !committing ? '' : 'disabled'}>${committing ? 'Saving…' : 'Commit check-in'}</button>
            <button type="button" class="admin-drawer-btn" id="kitScanClearPending"
              ${pending && !committing ? '' : 'disabled'}>Clear</button>
          </div>` : ''}
        <button type="button" class="admin-drawer-btn" id="kitScanStop">Stop scan</button>
      </div>
      <div class="kit-scan-pair">
        <img class="kit-scan-qr" src="${escapeHtml(qrImageUrl(pairUrl, 140))}"
          width="140" height="140" alt="QR code to open scanner on your phone">
        <div class="kit-scan-pair-meta">
          <span class="kit-scan-pair-label">Pair phone (same Wi‑Fi)</span>
          ${phoneEditable ? `
            <label class="kit-scan-host-label" for="kitScanHost">Phone opens
              <input class="admin-input kit-scan-host" id="kitScanHost" list="kitScanHostList"
                value="${escapeHtml(phoneHost)}" placeholder="192.168.x.x:5173" autocomplete="off">
            </label>
            <datalist id="kitScanHostList">${candidateOpts}</datalist>
            <span class="muted kit-scan-host-hint">Same Wi‑Fi. First visit: accept the certificate warning, then reload.</span>
          ` : ''}
          <a class="kit-scan-pair-link" href="${escapeHtml(pairUrl)}" target="_blank" rel="noopener">${escapeHtml(pairUrl)}</a>
          <button type="button" class="admin-drawer-btn" id="kitScanCopyLink">Copy link</button>
        </div>
      </div>
    </div>`;
}

function renderSourceSelect(itemId, source, name) {
  const src = normalizeKitSource(source);
  return `
    <select class="kit-pack-source admin-select" data-field="source"
      data-item-id="${escapeHtml(itemId)}"
      aria-label="Source for ${escapeHtml(name)}">
      <option value="own"${src === 'own' ? ' selected' : ''}>Own</option>
      <option value="hire"${src === 'hire' ? ' selected' : ''}>Hire-in</option>
    </select>`;
}

function renderOnEvent(balance) {
  const owned = Number(balance?.owned) || 0;
  const hired = Number(balance?.hired) || 0;
  if (!owned && !hired) {
    return '<span class="muted">—</span>';
  }
  const parts = [];
  if (owned) parts.push(`<span class="kit-on-event-owned" title="Own kit on event">${escapeHtml(qtyDisplay(owned))}</span>`);
  if (hired) parts.push(`<span class="kit-on-event-hired" title="Hired on event">${escapeHtml(qtyDisplay(hired))} hire</span>`);
  return `<div class="kit-on-event">${parts.join('<span class="kit-on-event-sep">·</span>')}</div>`;
}

function renderPackControls() {
  return '';
}

function renderPackStats(stats, movementCount) {
  return `
    <span>${stats.lines} lines</span>
    <span>·</span>
    <span>${stats.own} own</span>
    <span>·</span>
    <span>${stats.hire} hire-in</span>
    <span>·</span>
    <span class="${stats.short ? 'kit-pack-stats-short' : ''}">${stats.short} short</span>
    ${movementCount
      ? `<span>·</span><span>${movementCount} movement${movementCount === 1 ? '' : 's'}</span>`
      : ''}`;
}

function filterItems(items, availMap, balanceMap, query, productId, sourceFilter, contentsMap) {
  const q = (query || '').trim().toLowerCase();
  return (items || []).filter((it) => {
    if (productId) return it.product_id === productId;
    if (sourceFilter === 'own' && !isOwnSource(it.source)) return false;
    if (sourceFilter === 'hire' && isOwnSource(it.source)) return false;
    if (sourceFilter === 'short') {
      const avail = Number(availMap.get(it.product_id)) || 0;
      const bal = balanceMap.get(it.product_id);
      if (!isLineShort(it, avail, bal)) return false;
    }
    if (!q) return true;
    const contentNames = (contentsMap?.get(it.product_id) || [])
      .map((c) => c.child?.name || '')
      .join(' ');
    const hay = [
      it.product?.name,
      it.product?.sku,
      it.product?.barcode,
      it.product?.category?.name,
      contentNames,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function renderContentsUnder(it, contentsMap) {
  if (!it.product?.is_container) return '';
  const raw = contentsMap?.get(it.product_id) || [];
  if (!raw.length) {
    return '<div class="kit-pack-contents muted">Container — no contents listed</div>';
  }
  const need = Number(it.qty_planned) || 0;
  const scaled = scaledContainerContents(raw, need > 0 ? need : 1);
  const bits = scaled.map((c) => {
    const name = c.child?.name || 'Item';
    const qty = Number(c.qty) || 0;
    return `<li><span class="kit-pack-contents-qty">${escapeHtml(String(qty))}</span> ${escapeHtml(name)}</li>`;
  }).join('');
  return `
    <div class="kit-pack-contents">
      <span class="kit-pack-contents-label">Inside (×${escapeHtml(String(need > 0 ? need : 1))})</span>
      <ul class="kit-pack-contents-list">${bits}</ul>
    </div>`;
}

function renderPackList(items, availMap, balanceMap, query, productId, sourceFilter, contentsMap) {
  const filtered = filterItems(items, availMap, balanceMap, query, productId, sourceFilter, contentsMap);

  if (!filtered.length) {
    return `<div class="catalog-list-empty">${items?.length
      ? 'No kit items match your filters.'
      : 'No kit on this event yet. Add lines via scan or a stock movement.'}</div>`;
  }

  const { grouped, keys } = groupItems(filtered);
  let html = `
    <table class="kit-pack-table">
      <tbody>`;

  keys.forEach((cat) => {
    const list = grouped[cat].rows;
    html += `
      <tr class="kit-pack-cat-row">
        <td class="kit-pack-cat-name">${escapeHtml(cat)}</td>
        <td class="kit-pack-col-head num">Need</td>
        <td class="kit-pack-col-head kit-pack-col-head--source">Source</td>
        <td class="kit-pack-col-head num">Avail</td>
        <td class="kit-pack-col-head kit-pack-col-head--on">On event</td>
        <td class="kit-pack-col-head num kit-pack-col-head--packed">Packed</td>
        <td class="kit-pack-act"></td>
      </tr>`;

    list.forEach((it) => {
      const name = it.product?.name || 'Item';
      const need = Number(it.qty_planned) || 0;
      const avail = Number(availMap.get(it.product_id)) || 0;
      const packed = Number(it.qty_packed) || 0;
      const bal = balanceMap.get(it.product_id);
      const source = normalizeKitSource(it.source);
      const ownShort = isOwnShort(it, avail);
      const hireShort = isHireUncovered(it, bal);
      const short = ownShort || hireShort;
      const shortPacked = need > 0 && packed < need;
      const isContainer = !!it.product?.is_container;
      const rowClass = [
        'kit-pack-item-row',
        short ? 'kit-pack-item-row--short' : '',
        hireShort ? 'kit-pack-item-row--hire-short' : '',
        source === 'hire' ? 'kit-pack-item-row--hire' : '',
        isContainer ? 'kit-pack-item-row--container' : '',
      ].filter(Boolean).join(' ');

      let availCell;
      if (!isOwnSource(source)) {
        availCell = '<span class="muted">—</span>';
      } else if (avail) {
        availCell = escapeHtml(qtyDisplay(avail));
      } else {
        availCell = '<span class="muted">—</span>';
      }

      html += `
        <tr class="${rowClass}"
          data-item-id="${escapeHtml(it.id)}"
          data-pid="${escapeHtml(it.product_id)}"
          data-source="${escapeHtml(source)}"
          data-product-name="${escapeHtml(name.toLowerCase())}"
          data-barcode="${escapeHtml((it.product?.barcode || '').toLowerCase())}">
          <td class="kit-pack-item-name">
            <span class="kit-pack-item-title">${escapeHtml(name)}</span>
            ${isContainer ? '<span class="kit-lib-container-tag">Container</span>' : ''}
            ${it.product?.barcode ? `<span class="kit-pack-barcode muted">${escapeHtml(it.product.barcode)}</span>` : ''}
            ${renderContentsUnder(it, contentsMap)}
          </td>
          <td class="num kit-pack-qty">
            <input type="text" inputmode="decimal" autocomplete="off"
              class="kit-pack-inp num-math" data-field="qty_planned"
              value="${escapeHtml(qtyLabel(need))}" placeholder="—"
              aria-label="Need ${escapeHtml(name)}">
          </td>
          <td class="kit-pack-source-cell">
            ${renderSourceSelect(it.id, source, name)}
          </td>
          <td class="num kit-pack-avail${ownShort ? ' kit-pack-avail--short' : ''}">${availCell}</td>
          <td class="kit-pack-on-event-cell${hireShort ? ' kit-pack-on-event--short' : ''}">${renderOnEvent(bal)}</td>
          <td class="num kit-pack-qty kit-pack-qty--packed">
            <input type="text" inputmode="decimal" autocomplete="off"
              class="kit-pack-inp num-math kit-pack-inp--packed${shortPacked ? ' kit-pack-inp--incomplete' : ''}"
              data-field="qty_packed"
              value="${escapeHtml(qtyLabel(packed))}" placeholder="—"
              aria-label="Packed ${escapeHtml(name)}">
          </td>
          <td class="kit-pack-act">
            <button type="button" class="topbar-tool" data-remove-item="${escapeHtml(it.id)}"
              title="Remove from kit list" aria-label="Remove ${escapeHtml(name)}">
              ${icon('x', { size: 14 })}
            </button>
          </td>
        </tr>`;
    });
  });

  html += '</tbody></table>';
  return html;
}

function movementMeta(m) {
  const lines = m.lines || [];
  const first = lines[0];
  const parts = [];
  if (m.movement_type === 'warehouse_in' || m.movement_type === 'warehouse_out') {
    const wh = first?.warehouse?.name;
    if (wh) parts.push(wh);
  }
  if (m.movement_type === 'hire_in' || m.movement_type === 'hire_return') {
    const hire = first?.hire_company || first?.supplier?.name;
    if (hire) parts.push(hire);
  }
  if (m.notes) parts.push(m.notes);
  return parts.join(' · ');
}

function renderMovements(movements) {
  if (!(movements || []).length) {
    return '<div class="catalog-list-empty">No sends, returns, or hire yet.</div>';
  }

  return `
    <div class="wh-xfer-log kit-xfer-log">
      ${movements.map((m) => {
        const label = KIT_MOVEMENT_LABELS[m.movement_type] || m.movement_type;
        const meta = movementMeta(m);
        const lines = m.lines || [];
        const lineRows = lines.length
          ? lines.map((l) => `
              <div class="wh-xfer-line">
                <span class="wh-xfer-line-name">${escapeHtml(l.product?.name || 'Item')}</span>
                <span class="wh-xfer-line-qty">${escapeHtml(qtyDisplay(l.qty))}</span>
              </div>`).join('')
          : '<div class="muted" style="font-size:12px">No items</div>';
        return `
          <article class="wh-xfer-item">
            <div class="wh-xfer-head">
              <div class="wh-xfer-title">
                <span class="wh-xfer-dir">${escapeHtml(label)}</span>
                ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
              </div>
              <span class="wh-xfer-time muted">${escapeHtml(fmtDateTime(m.moved_at))}</span>
            </div>
            <div class="wh-xfer-lines">${lineRows}</div>
          </article>`;
      }).join('')}
    </div>`;
}

export function renderKitShell() {
  return renderShell();
}

export function mountKitPanel(route) {
  const eventId = route?.eventId;
  if (!eventId) return () => {};

  const controlsEl = $('kitPackToolbarControls');
  const statsEl = $('kitPackStats');
  const itemsWrap = $('kitItemsWrap');
  const movWrap = $('kitMovementsWrap');
  const movCountEl = $('kitMovementsCount');
  const scanBannerEl = $('kitScanBanner');
  if (!itemsWrap || !movWrap) return () => {};

  let items = [];
  let movements = [];
  let kitProducts = [];
  let warehouses = [];
  let suppliers = [];
  let availMap = new Map();
  let balanceMap = new Map();
  let contentsMap = new Map();
  let warehouseId = '';
  let sourceFilter = 'all';
  let productFilter = getLastProductFilter();
  let saveTimers = new Map();

  const seeded = getTableFilterValues('kit');
  if (seeded) {
    sourceFilter = seeded.stockFilter || 'all';
    warehouseId = seeded.warehouseId || '';
  }

  /** @type {null | { id: string, mode: string }} */
  let scanSession = null;
  let scanMode = SCAN_MODE_PACK;
  let stopScanPoll = null;
  let scanLastMsg = '';
  /** @type {Map<string, number>} */
  let checkInPending = new Map();
  let checkInCommitting = false;
  let flashProductId = '';
  let flashTimer = null;
  let phoneOrigin = typeof location !== 'undefined' ? location.origin : '';
  let phoneOriginEditable = false;
  /** @type {string[]} */
  let phoneOriginCandidates = [];
  let assignBarcodeOpen = false;
  /** @type {string | null} */
  let assignBarcodePending = null;
  let collab = null;

  function stopCollab() {
    const session = collab;
    collab = null;
    session?.destroy();
  }

  function startCollab() {
    if (collab) {
      collab.repaint();
      return;
    }
    collab = createGridCollabSession({
      channelName: `collab:kit:${eventId}`,
      root: itemsWrap,
      inputSelector: '.kit-pack-inp',
      cellKeyFromInput: kitCellKeyFromInput,
      findCellEl: kitFindCellEl,
    });
  }

  function paint() {
    const stats = packListStats(items, availMap, balanceMap);
    if (controlsEl) {
      controlsEl.innerHTML = renderPackControls();
      controlsEl.hidden = true;
    }
    if (statsEl) {
      statsEl.innerHTML = renderPackStats(stats, movements.length);
    }
    if (movCountEl) {
      movCountEl.textContent = movements.length
        ? `(${movements.length})`
        : '';
    }
    paintScanBanner();
    itemsWrap.innerHTML = renderPackList(
      items, availMap, balanceMap,
      productFilter.query, productFilter.productId, sourceFilter,
      contentsMap,
    );
    if (flashProductId) {
      itemsWrap.querySelector(`[data-pid="${flashProductId}"]`)
        ?.classList.add('kit-pack-item-row--flash');
    }
    wirePackInputs();
    movWrap.innerHTML = renderMovements(movements);
    startCollab();

    const scrollPid = flashProductId || productFilter.productId;
    if (scrollPid) {
      itemsWrap.querySelector(`[data-pid="${scrollPid}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  function currentPairUrl() {
    if (!scanSession?.id) return '';
    return scanPageUrl(scanSession.id, phoneOrigin);
  }

  function paintScanBanner() {
    if (!scanBannerEl) return;
    if (!scanSession) {
      scanBannerEl.hidden = true;
      scanBannerEl.innerHTML = '';
      return;
    }
    const pairUrl = currentPairUrl();
    scanBannerEl.hidden = false;
    scanBannerEl.innerHTML = renderScanBanner({
      mode: scanMode,
      pairUrl,
      lastMsg: scanLastMsg,
      pendingTotal: pendingCheckInTotal(checkInPending),
      committing: checkInCommitting,
      phoneOrigin,
      phoneEditable: phoneOriginEditable,
      phoneCandidates: phoneOriginCandidates,
    });
    wireScanBanner();
  }

  function applyPhoneHostInput(rawHost) {
    const next = originWithHost(phoneOrigin || location.origin, rawHost);
    if (!next || next === phoneOrigin) return;
    let host = '';
    try { host = new URL(next).hostname; } catch { /* ignore */ }
    if (isLoopbackHost(host)) {
      toast('Use your computer’s Wi‑Fi IP (e.g. 192.168.x.x), not localhost', true);
      return;
    }
    phoneOrigin = next;
    setStoredPhoneOrigin(next);
    if (!phoneOriginCandidates.includes(next)) {
      phoneOriginCandidates = [next, ...phoneOriginCandidates];
    }
    paintScanBanner();
    toast('QR updated for phone');
  }

  function wireScanBanner() {
    scanBannerEl?.querySelectorAll('[data-kit-scan-mode]').forEach((btn) => {
      btn.onclick = () => {
        setScanMode(btn.dataset.kitScanMode || SCAN_MODE_PACK)
          .catch((err) => toast(err.message || 'Could not switch mode', true));
      };
    });
    $('kitScanStop')?.addEventListener('click', () => {
      stopScanMode();
      toast('Scan mode stopped');
    });
    $('kitScanCopyLink')?.addEventListener('click', async () => {
      const url = currentPairUrl();
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch {
        toast('Copy failed — select the link instead', true);
      }
    });
    const hostInput = $('kitScanHost');
    if (hostInput) {
      hostInput.addEventListener('change', () => applyPhoneHostInput(hostInput.value));
      hostInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyPhoneHostInput(hostInput.value);
          hostInput.blur();
        }
      });
    }
    $('kitScanClearPending')?.addEventListener('click', () => {
      checkInPending = new Map();
      scanLastMsg = 'Check-in batch cleared';
      paintScanBanner();
    });
    $('kitScanCommit')?.addEventListener('click', () => {
      commitCheckIn().catch((err) => toast(err.message || 'Check-in failed', true));
    });
  }

  function flashRow(productId) {
    flashProductId = productId || '';
    clearTimeout(flashTimer);
    if (!flashProductId) return;
    flashTimer = setTimeout(() => {
      flashProductId = '';
      itemsWrap.querySelector('.kit-pack-item-row--flash')
        ?.classList.remove('kit-pack-item-row--flash');
    }, 1600);
  }

  function wirePackInputs() {
    itemsWrap.querySelectorAll('.kit-pack-inp').forEach((inp) => {
      inp.addEventListener('change', () => {
        const row = inp.closest('[data-item-id]');
        if (!row) return;
        scheduleSave(row.dataset.itemId, inp.dataset.field, inp.value);
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
      });
    });
    itemsWrap.querySelectorAll('select[data-field="source"]').forEach((sel) => {
      sel.addEventListener('change', () => {
        saveSource(sel.dataset.itemId, sel.value)
          .catch((err) => toast(err.message || 'Save failed', true));
      });
    });
    itemsWrap.querySelectorAll('[data-remove-item]').forEach((btn) => {
      btn.onclick = () => removeItem(btn.dataset.removeItem);
    });
  }

  function scheduleSave(itemId, field, raw) {
    const key = `${itemId}:${field}`;
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(() => {
      saveField(itemId, field, raw).catch((err) => toast(err.message || 'Save failed', true));
    }, 250));
  }

  async function saveSource(itemId, raw) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const source = normalizeKitSource(raw);
    if (normalizeKitSource(it.source) === source) return;
    const DB = getDB();
    await DB.update('event_kit_items', 'id=eq.' + DB._.enc(itemId), { source });
    it.source = source;
    paint();
  }

  async function saveField(itemId, field, raw) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const trimmed = String(raw || '').trim();
    const qty = trimmed === '' ? 0 : parseQty(trimmed);
    if (!Number.isFinite(qty) || qty < 0) {
      toast('Enter a valid quantity', true);
      paint();
      return;
    }
    if (field !== 'qty_planned' && field !== 'qty_packed') return;
    if (Number(it[field]) === qty) return;

    const DB = getDB();
    await DB.update('event_kit_items', 'id=eq.' + DB._.enc(itemId), { [field]: qty });
    it[field] = qty;
    paint();
  }

  async function removeItem(itemId) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    if ((Number(it.qty_packed) || 0) > 0) {
      toast('Clear Packed qty before removing this line.', true);
      return;
    }
    if (!(await confirmDialog({ title: 'Confirm', message: `Remove “${it.product?.name || 'item'}” from the kit list?`, confirmLabel: 'Delete', danger: true }))) return;
    const DB = getDB();
    await DB.remove('event_kit_items', 'id=eq.' + DB._.enc(itemId));
    await refresh();
    toast('Removed from kit list');
  }

  async function refresh() {
    const [kit, products, wh, sup, avail] = await Promise.all([
      loadEventKit(eventId),
      loadKitLibraryProducts(),
      getDB().warehouses.list(),
      loadSuppliers(),
      loadWarehouseAvail(warehouseId || undefined),
    ]);
    items = (kit.items || []).map((it) => ({
      ...it,
      source: normalizeKitSource(it.source),
    }));
    movements = kit.movements || [];
    contentsMap = contentsByContainer(kit.contents || []);
    kitProducts = products || [];
    warehouses = wh || [];
    suppliers = sup || [];
    availMap = avail;
    balanceMap = balancesByProduct(movements);
    if (warehouseId && !warehouses.some((w) => w.id === warehouseId)) {
      warehouseId = warehouses[0]?.id || '';
      if (warehouseId) {
        availMap = await loadWarehouseAvail(warehouseId);
      }
    }
    setTableFilterContext('kit', { warehouses });
    paint();
  }

  function stopScanMode() {
    if (stopScanPoll) {
      stopScanPoll();
      stopScanPoll = null;
    }
    scanSession = null;
    scanLastMsg = '';
    checkInPending = new Map();
    checkInCommitting = false;
    paintScanBanner();
  }

  async function startScanMode(initialMode = SCAN_MODE_PACK) {
    if (scanSession) {
      paintScanBanner();
      return;
    }
    const DB = getDB();
    scanMode = normalizeScanMode(initialMode);

    try {
      const resolved = await resolvePhoneOrigin();
      phoneOrigin = resolved.origin;
      phoneOriginEditable = resolved.editable;
      phoneOriginCandidates = resolved.candidates || [];
      if (resolved.editable && phoneOrigin) setStoredPhoneOrigin(phoneOrigin);
    } catch {
      phoneOrigin = location.origin;
      phoneOriginEditable = isLoopbackHost(location.hostname);
      phoneOriginCandidates = [];
    }

    const row = await createScanSession(DB, { eventId, mode: scanMode });
    scanSession = { id: row.id, mode: scanMode };
    scanLastMsg = phoneOriginEditable
      ? 'Waiting for phone on Wi‑Fi…'
      : 'Waiting for phone…';
    checkInPending = new Map();
    paintScanBanner();

    stopScanPoll = startScanPoll(DB, row.id, async (events) => {
      for (const ev of events || []) {
        await applyScanBarcode(ev.barcode);
      }
    }, {
      onError: (err) => toast(err.message || 'Scan poll failed', true),
    });
  }

  async function setScanMode(nextMode) {
    const mode = normalizeScanMode(nextMode);
    if (mode === scanMode) return;
    scanMode = mode;
    if (scanSession?.id) {
      await updateScanSessionMode(getDB(), scanSession.id, mode);
      scanSession.mode = mode;
    }
    scanLastMsg = mode === SCAN_MODE_CHECK_IN
      ? 'Check-in mode — scan returns'
      : 'Pack mode — scan to pack';
    paintScanBanner();
  }

  async function applyScanBarcode(rawBarcode) {
    const code = normalizeBarcode(rawBarcode);
    if (!code) return;

    const product = findProductByBarcode(kitProducts, code);
    if (!product) {
      openAssignBarcodeModal(code);
      return;
    }
    await applyMatchedProduct(product);
  }

  async function applyMatchedProduct(product) {
    if (!product?.id) return;

    if (scanMode === SCAN_MODE_CHECK_IN) {
      const onList = items.find((it) => it.product_id === product.id);
      if (!onList) {
        scanLastMsg = `“${product.name}” is not on this pack list`;
        toast(scanLastMsg, true);
        paintScanBanner();
        return;
      }
      checkInPending = bumpCheckInPending(checkInPending, product.id, 1);
      const n = checkInPending.get(product.id) || 1;
      scanLastMsg = `Check-in +1 ${product.name} (${n})`;
      flashRow(product.id);
      paint();
      return;
    }

    // Pack mode
    const plan = planPackScan({ items, product });
    const DB = getDB();
    try {
      if (plan.action === 'bump') {
        await DB.update(
          'event_kit_items',
          'id=eq.' + DB._.enc(plan.itemId),
          { qty_packed: plan.nextPacked },
        );
        const it = items.find((x) => x.id === plan.itemId);
        if (it) it.qty_packed = plan.nextPacked;
        scanLastMsg = `Packed +1 ${plan.name || product.name} → ${plan.nextPacked}`;
        flashRow(product.id);
        paint();
        return;
      }
      if (plan.action === 'add') {
        await DB.insert('event_kit_items', {
          event_id: eventId,
          product_id: plan.productId,
          qty_planned: plan.nextPlanned,
          qty_packed: plan.nextPacked,
          source: 'own',
        });
        await refresh();
        scanLastMsg = `Added + packed ${plan.name || product.name}`;
        flashRow(product.id);
        paint();
      }
    } catch (err) {
      toast(err.message || 'Scan apply failed', true);
      throw err;
    }
  }

  function openAssignBarcodeModal(rawCode) {
    const code = normalizeBarcode(rawCode);
    if (!code) return;

    if (assignBarcodeOpen) {
      assignBarcodePending = code;
      scanLastMsg = 'Finish assigning the previous barcode first';
      paintScanBanner();
      return;
    }

    assignBarcodeOpen = true;
    const candidates = scanCodeCandidates(code);
    const idHint = candidates.find((c) => /^\d+$/.test(c));
    const displayCode = code.length > 64 ? `${code.slice(0, 40)}…${code.slice(-16)}` : code;

    scanLastMsg = idHint
      ? `Unknown Current RMS #${idHint} — pick a kit item`
      : 'Unknown barcode — pick a kit item';
    paintScanBanner();

    openModal({
      title: 'Assign barcode',
      bodyHtml: `
        <div class="kit-assign-barcode">
          <p class="muted" style="margin:0 0 10px;font-size:13px;line-height:1.4">
            This scan isn’t linked to a kit library item yet. Pick the product to attach it to — it’ll be saved for next time.
          </p>
          <div class="admin-field">
            <label class="admin-label">Scanned</label>
            <div class="kit-assign-code" title="${escapeHtml(code)}">${escapeHtml(displayCode)}</div>
            ${idHint ? `<div class="muted" style="font-size:12px;margin-top:4px">Current RMS id · ${escapeHtml(idHint)}</div>` : ''}
          </div>
          <div class="admin-field">
            <label class="admin-label" for="kitAssignSearch">Kit library item</label>
            <div id="kitAssignSearch"></div>
          </div>
          <div class="del-form-err" id="kitAssignErr" hidden></div>
        </div>`,
      footHtml: `
        <button type="button" class="admin-drawer-btn" id="kitAssignSkip">Skip</button>`,
      onClose: () => {
        assignBarcodeOpen = false;
        const next = assignBarcodePending;
        assignBarcodePending = null;
        if (next && next !== code) {
          queueMicrotask(() => openAssignBarcodeModal(next));
        }
      },
    });

    const errEl = $('kitAssignErr');
    const searchMount = $('kitAssignSearch');
    let saving = false;

    $('kitAssignSkip')?.addEventListener('click', () => {
      scanLastMsg = 'Skipped unknown barcode';
      paintScanBanner();
      closeModal();
    });

    if (searchMount) {
      mountProductSearch(searchMount, {
        products: kitProducts,
        placeholder: 'Search kit library…',
        onSelect: async ({ productId, product }) => {
          if (!productId || saving) return;
          const target = product || kitProducts.find((p) => p.id === productId);
          if (!target) return;

          const existingBc = normalizeBarcode(target.barcode);
          if (existingBc && existingBc.toLowerCase() !== code.toLowerCase()) {
            const ok = await confirmDialog({ title: 'Confirm', message: `“${target.name}” already has barcode “${existingBc}”.\n\nReplace it with this scan?`, confirmLabel: 'Confirm', danger: true });
            if (!ok) return;
          }

          // Another product already owns this code?
          const taken = kitProducts.find((p) => {
            if (p.id === productId) return false;
            return findProductByBarcode([p], code);
          });
          if (taken) {
            const ok = await confirmDialog({ title: 'Confirm', message: `“${taken.name}” already matches this scan.\n\nMove the barcode to “${target.name}”?`, confirmLabel: 'Confirm', danger: true });
            if (!ok) return;
          }

          saving = true;
          if (errEl) {
            errEl.hidden = true;
            errEl.textContent = '';
          }
          try {
            const DB = getDB();
            if (taken?.barcode && normalizeBarcode(taken.barcode).toLowerCase() === code.toLowerCase()) {
              await DB.update(
                'products',
                'id=eq.' + DB._.enc(taken.id),
                { barcode: null },
              );
              taken.barcode = null;
            }
            await DB.update(
              'products',
              'id=eq.' + DB._.enc(productId),
              { barcode: code },
            );
            target.barcode = code;
            const local = kitProducts.find((p) => p.id === productId);
            if (local) local.barcode = code;

            scanLastMsg = `Linked → ${target.name}`;
            closeModal();
            toast(`Barcode saved on ${target.name}`);
            await applyMatchedProduct(target);
          } catch (err) {
            const msg = err?.message || 'Could not save barcode';
            if (errEl) {
              errEl.hidden = false;
              errEl.textContent = /23505|duplicate|unique/i.test(msg)
                ? 'That barcode is already used by another product.'
                : msg;
            } else {
              toast(msg, true);
            }
          } finally {
            saving = false;
          }
        },
      });
      queueMicrotask(() => {
        searchMount.querySelector('.product-search-input')?.focus();
      });
    }
  }

  async function writeMovementBatch(movementType, lines, notes) {
    if (!lines.length) return;
    const DB = getDB();
    const needsWarehouse = affectsWarehouse(movementType);
    const whId = warehouseId || '';
    if (needsWarehouse && !whId) {
      throw new Error('Select a warehouse in the pack toolbar before committing check-in.');
    }

    const check = validateEventStock(balancesByProduct(movements), movementType, lines);
    if (!check.ok) {
      const name = kitProducts.find((p) => p.id === check.productId)?.name || 'Item';
      throw new Error(`Not enough booked on event for ${name} (have ${qtyDisplay(check.available)}).`);
    }

    if (needsWarehouse) {
      for (const line of lines) {
        const delta = warehouseQtyDelta(movementType, line.qty);
        if (delta) await adjustWarehouseStock(whId, line.product_id, delta);
      }
    }

    const [header] = await DB.insert('kit_movements', {
      event_id: eventId,
      movement_type: movementType,
      moved_at: new Date().toISOString(),
      notes: notes || null,
    });

    await DB.insert('kit_movement_lines', lines.map((l) => ({
      movement_id: header.id,
      product_id: l.product_id,
      qty: l.qty,
      warehouse_id: needsWarehouse ? whId : null,
      supplier_id: null,
      hire_company: null,
    })));

    if (movementType === 'warehouse_out' || movementType === 'hire_return' || movementType === 'write_off') {
      for (const line of lines) {
        const it = items.find((x) => x.product_id === line.product_id);
        if (!it) continue;
        const next = Math.max(0, round1((Number(it.qty_packed) || 0) - line.qty));
        await DB.update('event_kit_items', 'id=eq.' + DB._.enc(it.id), { qty_packed: next });
      }
    }
  }

  async function commitCheckIn() {
    if (checkInCommitting) return;
    const groups = pendingCheckInGroups(checkInPending, items);
    if (!groups.warehouseOut.length && !groups.hireReturn.length) {
      toast('Nothing to check in', true);
      return;
    }
    if (groups.missing.length) {
      toast('Some scanned items are no longer on the list — clear and rescan.', true);
      return;
    }

    checkInCommitting = true;
    paintScanBanner();
    try {
      if (groups.warehouseOut.length) {
        await writeMovementBatch(
          'warehouse_out',
          groups.warehouseOut.map((l) => ({ product_id: l.product_id, qty: l.qty })),
          'Phone scan check-in',
        );
      }
      if (groups.hireReturn.length) {
        await writeMovementBatch(
          'hire_return',
          groups.hireReturn.map((l) => ({ product_id: l.product_id, qty: l.qty })),
          'Phone scan hire return',
        );
      }
      checkInPending = new Map();
      scanLastMsg = 'Check-in committed';
      await refresh();
      toast('Check-in saved');
    } finally {
      checkInCommitting = false;
      paintScanBanner();
    }
  }

  function openMovement(movementType) {
    const label = KIT_MOVEMENT_LABELS[movementType] || movementType;
    const needsWarehouse = affectsWarehouse(movementType);
    const needsHire = movementType === 'hire_in' || movementType === 'hire_return';
    const draftLines = [];

    const whOpts = warehouses.map((w) =>
      `<option value="${escapeHtml(w.id)}"${w.id === warehouseId ? ' selected' : ''}>${escapeHtml(w.name)}</option>`).join('');
    const hireOpts = suppliers.map((s) =>
      `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');

    openSheet({
      title: label,
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="kitMovErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="kitMovWhen">When</label>
            <input class="admin-input" type="datetime-local" id="kitMovWhen" value="${escapeHtml(nowLocalInput())}">
          </div>
          ${needsWarehouse ? `
            <div class="admin-field">
              <label class="admin-label" for="kitMovWarehouse">Warehouse</label>
              <select class="admin-select" id="kitMovWarehouse">
                <option value="">— select —</option>
                ${whOpts}
              </select>
            </div>` : ''}
          ${needsHire ? `
            <div class="admin-field">
              <label class="admin-label" for="kitMovHireCompany">Hire company</label>
              <input class="admin-input" type="text" id="kitMovHireCompany" list="kitMovHireList" placeholder="Company name">
              <datalist id="kitMovHireList">${suppliers.map((s) =>
                `<option value="${escapeHtml(s.name)}"></option>`).join('')}</datalist>
            </div>
            <div class="admin-field">
              <label class="admin-label" for="kitMovSupplier">Or pick supplier</label>
              <select class="admin-select" id="kitMovSupplier">
                <option value="">— optional —</option>
                ${hireOpts}
              </select>
            </div>` : ''}
          <div class="admin-field">
            <label class="admin-label">Lines</label>
            <div id="kitMovLines" class="del-lines"></div>
            <button type="button" class="admin-drawer-btn" id="kitMovAddLine">+ Add line</button>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="kitMovNotes">Notes</label>
            <textarea class="admin-textarea" id="kitMovNotes" rows="2" placeholder="Optional"></textarea>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitMovCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="kitMovSave">Save</button>
          </div>
        </div>`,
    });

    const linesEl = $('kitMovLines');

    function paintLines() {
      if (!draftLines.length) {
        linesEl.innerHTML = '<p class="muted" style="font-size:13px">No lines yet.</p>';
        return;
      }
      linesEl.innerHTML = draftLines.map((line) => `
        <div class="del-line-row" data-lid="${escapeHtml(line.id)}">
          <div class="del-line-search" id="kitLineSearch_${escapeHtml(line.id)}"></div>
          <div class="del-qty-field">
            <label class="admin-label">Qty</label>
            <input class="admin-input num-math" type="text" inputmode="decimal"
              data-qty="${escapeHtml(line.id)}" value="${escapeHtml(line.qty || '')}" placeholder="0">
          </div>
          <button type="button" class="topbar-tool" data-remove-line="${escapeHtml(line.id)}" aria-label="Remove line">
            ${icon('x', { size: 14 })}
          </button>
        </div>`).join('');

      draftLines.forEach((line) => {
        const mount = $(`kitLineSearch_${line.id}`);
        if (!mount) return;
        mountProductSearch(mount, {
          products: kitProducts,
          value: line.productId || '',
          placeholder: 'Search kit…',
          onSelect: ({ productId }) => { line.productId = productId; },
        });
      });

      linesEl.querySelectorAll('[data-qty]').forEach((inp) => {
        inp.oninput = () => {
          const line = draftLines.find((l) => l.id === inp.dataset.qty);
          if (line) line.qty = inp.value;
        };
      });
      linesEl.querySelectorAll('[data-remove-line]').forEach((btn) => {
        btn.onclick = () => {
          const idx = draftLines.findIndex((l) => l.id === btn.dataset.removeLine);
          if (idx >= 0) draftLines.splice(idx, 1);
          paintLines();
        };
      });
    }

    $('kitMovAddLine').onclick = () => {
      draftLines.push({ id: rid('kl'), productId: '', qty: '' });
      paintLines();
    };
    $('kitMovCancel').onclick = closeSheet;
    draftLines.push({ id: rid('kl'), productId: '', qty: '' });
    paintLines();

    $('kitMovSave').onclick = async () => {
      const errEl = $('kitMovErr');
      const whId = needsWarehouse ? ($('kitMovWarehouse')?.value || '') : '';
      if (needsWarehouse && !whId) {
        errEl.textContent = 'Select a warehouse.';
        return;
      }

      const hireCompany = needsHire ? ($('kitMovHireCompany')?.value || '').trim() : '';
      const supplierId = needsHire ? ($('kitMovSupplier')?.value || null) : null;
      if (needsHire && !hireCompany && !supplierId) {
        errEl.textContent = 'Enter a hire company (or pick a supplier).';
        return;
      }

      const lines = [];
      for (const row of draftLines) {
        const qty = parseQty(row.qty);
        if (!row.productId) continue;
        if (!Number.isFinite(qty) || qty <= 0) {
          errEl.textContent = 'Each line needs a quantity greater than zero.';
          return;
        }
        lines.push({ product_id: row.productId, qty });
      }
      if (!lines.length) {
        errEl.textContent = 'Add at least one line.';
        return;
      }

      const onEvent = new Set(items.map((i) => i.product_id));
      for (const line of lines) {
        if (!onEvent.has(line.product_id)) {
          try {
            const defaultSource = needsHire ? 'hire' : 'own';
            await getDB().insert('event_kit_items', {
              event_id: eventId,
              product_id: line.product_id,
              qty_planned: 0,
              qty_packed: 0,
              source: defaultSource,
            });
            onEvent.add(line.product_id);
          } catch (err) {
            if (!/23505/.test(String(err?.message || err))) {
              errEl.textContent = err.message || 'Could not add item to event';
              return;
            }
          }
        }
      }

      const check = validateEventStock(balancesByProduct(movements), movementType, lines);
      if (!check.ok) {
        const name = kitProducts.find((p) => p.id === check.productId)?.name || 'Item';
        errEl.textContent = `Not enough booked on event for ${name} (have ${qtyDisplay(check.available)}).`;
        return;
      }

      const DB = getDB();
      const btn = $('kitMovSave');
      btn.disabled = true;
      try {
        if (needsWarehouse) {
          for (const line of lines) {
            const delta = warehouseQtyDelta(movementType, line.qty);
            if (delta) await adjustWarehouseStock(whId, line.product_id, delta);
          }
        }

        const movedAt = $('kitMovWhen')?.value
          ? new Date($('kitMovWhen').value).toISOString()
          : new Date().toISOString();

        const [header] = await DB.insert('kit_movements', {
          event_id: eventId,
          movement_type: movementType,
          moved_at: movedAt,
          notes: ($('kitMovNotes')?.value || '').trim() || null,
        });

        await DB.insert('kit_movement_lines', lines.map((l) => ({
          movement_id: header.id,
          product_id: l.product_id,
          qty: l.qty,
          warehouse_id: needsWarehouse ? whId : null,
          supplier_id: supplierId || null,
          hire_company: hireCompany || null,
        })));

        // Keep Packed in step with hire / send own kit
        if (movementType === 'warehouse_in' || movementType === 'hire_in') {
          for (const line of lines) {
            const it = items.find((x) => x.product_id === line.product_id);
            if (!it) continue;
            const next = round1((Number(it.qty_packed) || 0) + line.qty);
            await DB.update('event_kit_items', 'id=eq.' + DB._.enc(it.id), { qty_packed: next });
          }
        }
        if (movementType === 'warehouse_out' || movementType === 'hire_return' || movementType === 'write_off') {
          for (const line of lines) {
            const it = items.find((x) => x.product_id === line.product_id);
            if (!it) continue;
            const next = Math.max(0, round1((Number(it.qty_packed) || 0) - line.qty));
            await DB.update('event_kit_items', 'id=eq.' + DB._.enc(it.id), { qty_packed: next });
          }
        }

        closeSheet();
        await refresh();
        toast('Saved');
      } catch (err) {
        errEl.textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };
  }

  const onProductFilter = (e) => {
    productFilter = e.detail || {};
    paint();
    if (e.detail?.productId) e.detail.handled = true;
  };

  const onToolbarAction = (e) => {
    const action = e.detail?.action;
    if (!action) return;
    const map = {
      'kit-scan': () => {
        startScanMode(scanMode).catch((err) => toast(err.message || 'Could not start scan', true));
      },
      'kit-warehouse-in': () => openMovement('warehouse_in'),
      'kit-warehouse-out': () => openMovement('warehouse_out'),
      'kit-hire-in': () => openMovement('hire_in'),
      'kit-hire-return': () => openMovement('hire_return'),
      'kit-write-off': () => openMovement('write_off'),
    };
    if (map[action]) {
      e.detail.handled = true;
      map[action]();
    }
  };

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'kit') return;
    const values = e.detail?.values;
    if (!values) return;
    const nextStock = values.stockFilter || 'all';
    const nextWh = values.warehouseId || '';
    const stockChanged = nextStock !== sourceFilter;
    const whChanged = nextWh !== warehouseId;
    sourceFilter = nextStock;
    if (!whChanged) {
      if (stockChanged) paint();
      return;
    }
    warehouseId = nextWh;
    loadWarehouseAvail(warehouseId || undefined)
      .then((map) => {
        availMap = map;
        paint();
      })
      .catch(() => paint());
  };

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  refresh().catch((err) => {
    reportError(err, { source: 'admin.kit.load', silent: true });
    itemsWrap.innerHTML = errorState({
      title: 'Couldn’t load kit',
      copy: err.message || 'Failed to load',
      variant: 'admin',
    });
    bindEmptyRetry(itemsWrap, () => refresh());
  });

  return () => {
    stopScanMode();
    stopCollab();
    clearTimeout(flashTimer);
    assignBarcodePending = null;
    if (assignBarcodeOpen) closeModal();
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    saveTimers.forEach((t) => clearTimeout(t));
  };
}
