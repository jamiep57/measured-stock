/**
 * Mobile kit container counting UI.
 * Open /v5/scan (no session) or /v5/scan/?c=<containerProductId>
 */

import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType.js';
import { escapeHtml } from './lib/util.js';
import {
  loadKitLibraryProducts,
  loadKitCategories,
  loadKitContainerContents,
  replaceKitContainerContents,
  loadEventsList,
  loadEventKit,
} from './db.js';
import { contentsByContainer, balancesByProduct } from './lib/kit-stock.js';
import { findProductByBarcode, PHONE_DEBOUNCE_MS } from './lib/kit-scan-session.js';
import {
  bumpContentsLine,
  setContentsQty,
  removeContentsLine,
  filterKitProducts,
  resolveContainerScan,
  resolveItemScan,
  kitItemCreatePayload,
  kitCategoryCreatePayload,
  loadRecentContainerIds,
  pushRecentContainerId,
  contentsToSaveLines,
  parseContentsQty,
} from './lib/kit-container-count.js';
import { resolveKitLabelPayload } from './lib/kit-label-payload.js';
import { enqueueKitLabel, loadPendingKitLabelQueue } from './lib/kit-label-queue.js';
import { mountSearchSelect } from './components/search-select.js';
import {
  DEST_EVENT,
  DEST_WAREHOUSE,
  DEST_LABELS,
  DEST_HINTS,
  loadStoredDestination,
  storeDestination,
  applyEventPackDelta,
  setEventPackedQty,
  loadWarehouseKitStockMap,
  applyWarehouseDelta,
  setWarehouseQty,
  eventPackLines,
} from './lib/kit-count-dest.js';

function $(id) {
  return document.getElementById(id);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    setTimeout(() => ctx.close(), 200);
  } catch { /* ignore */ }
  try {
    navigator.vibrate?.(40);
  } catch { /* ignore */ }
}

function createZxingReader() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, 250);
}

function grabFrame(video, canvas, mode) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (mode === 'full') {
    canvas.width = vw;
    canvas.height = vh;
    ctx.drawImage(video, 0, 0, vw, vh);
    return canvas;
  }
  const cw = Math.max(160, Math.floor(vw * 0.78));
  const ch = Math.max(100, Math.floor(vh * 0.45));
  const sx = Math.floor((vw - cw) / 2);
  const sy = Math.floor((vh - ch) / 2);
  canvas.width = cw;
  canvas.height = ch;
  ctx.drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);
  return canvas;
}

function containerIdFromUrl() {
  const params = new URLSearchParams(location.search);
  return (params.get('c') || params.get('container') || '').trim();
}

function setUrlContainer(id, { embedded = false } = {}) {
  const url = new URL(location.href);
  url.searchParams.delete('s');
  url.searchParams.delete('session');
  if (embedded || url.pathname.replace(/\/$/, '') === '/v5') {
    url.searchParams.set('tab', 'kit');
  }
  if (id) url.searchParams.set('c', id);
  else url.searchParams.delete('c');
  history.replaceState(null, '', url.pathname + url.search);
}

/**
 * @param {object} DB
 * @param {{
 *   rootEl?: HTMLElement,
 *   embedded?: boolean,
 *   preferredEventId?: string,
 *   preferredEventName?: string,
 *   preferredWarehouseId?: string,
 *   preferredWarehouseName?: string,
 *   onDeepChange?: (deep: boolean) => void,
 * }} [opts]
 */
export async function startKitCountApp(DB, opts = {}) {
  const app = opts.rootEl || $('app');
  if (!app) throw new Error('Missing kit root');
  const embedded = !!opts.embedded;
  const onDeepChange = typeof opts.onDeepChange === 'function' ? opts.onDeepChange : () => {};
  let preferredEventId = String(opts.preferredEventId || '').trim();
  let preferredEventName = String(opts.preferredEventName || '').trim();
  let preferredWarehouseId = String(opts.preferredWarehouseId || '').trim();
  let preferredWarehouseName = String(opts.preferredWarehouseName || '').trim();

  if (embedded) app.classList.add('kc-root');

  function writeUrlContainer(id) {
    setUrlContainer(id, { embedded });
  }

  function syncDeepMode() {
    const deep = !['dest', 'pick-event', 'pick-warehouse', 'home'].includes(screen);
    onDeepChange(deep);
  }

  /** @type {object[]} */
  let products = [];
  /** @type {object[]} */
  let categories = [];
  /** @type {object[]} */
  let events = [];
  /** @type {object[]} */
  let warehouses = [];
  /** @type {{ type: string, eventId?: string, eventName?: string, warehouseId?: string, warehouseName?: string } | null} */
  let destination = null;
  /** @type {object[]} */
  let eventItems = [];
  /** @type {Map<string, { onHand: number, owned: number, hired: number }>} */
  let eventBalances = new Map();
  /** Event / warehouse id whose pack list or stock map is currently in `eventItems` / `stockMap`. */
  let boundEventId = '';
  let boundWarehouseId = '';
  /** Bumped on every location load so older in-flight requests cannot paint stale lists. */
  let locationLoadGen = 0;
  /** @type {Map<string, number>} */
  let stockMap = new Map();
  /** @type {Array<{ product_id: string, qty: number, product?: object }>} */
  let stockLines = [];
  /** @type {object | null} */
  let container = null;
  /** Parent container ids when drilling into nested boxes. */
  /** @type {string[]} */
  let containerStack = [];
  /** @type {Array<{ child_product_id: string, qty: number, child?: object }>} */
  let contents = [];
  /** @type {'dest'|'pick-event'|'pick-warehouse'|'home'|'scan-container'|'create-container'|'count'|'scan-item'|'stock-count'} */
  let screen = 'dest';
  let feedback = { msg: '', kind: '' };
  let saving = false;
  let createDraft = { name: '', categoryId: '', barcode: '', qty: '1', asContainer: false, queueLabel: true };
  let showCreateSheet = false;
  let showCategorySheet = false;
  let newCategoryName = '';
  let searchQuery = '';
  /** Event home tab: pick list vs physical on-event stock. */
  let homeEventTab = 'pick';
  let errMsg = '';
  /** Focus the search field once after entering a container (not on every re-paint). */
  let focusSearchNext = false;
  /** @type {Set<string>} */
  let queuedProductIds = new Set();

  // Camera state (shared by container + item scan screens)
  let stream = null;
  let stopped = true;
  let scanTimer = 0;
  let frameMode = 'crop';
  let frames = 0;
  let lastCode = '';
  let lastAt = 0;
  let handling = false;
  const reader = createZxingReader();

  async function refreshLibrary() {
    const [prods, cats, evs, whs] = await Promise.all([
      loadKitLibraryProducts(),
      loadKitCategories(),
      loadEventsList().catch(() => []),
      DB.warehouses.list().catch(() => []),
    ]);
    products = (prods || []).filter((p) => !p.archived);
    categories = (cats || []).slice().sort((a, b) =>
      (a.sort_order - b.sort_order) || String(a.name || '').localeCompare(String(b.name || '')));
    events = (evs || []).slice();
    warehouses = (whs || []).slice().sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || '')));
  }

  function isEventDest() {
    return destination?.type === DEST_EVENT && !!destination.eventId;
  }

  function isWarehouseDest() {
    return destination?.type === DEST_WAREHOUSE && !!destination.warehouseId;
  }

  function hasStockDest() {
    return isEventDest() || isWarehouseDest();
  }

  function hasPreferredEvent() {
    return !!preferredEventId;
  }

  function hasPreferredWarehouse() {
    return !!preferredWarehouseId;
  }

  function hasPreferredLocation() {
    return hasPreferredEvent() || hasPreferredWarehouse();
  }

  function preferredEventDestination() {
    if (!preferredEventId) return null;
    const ev = events.find((e) => e.id === preferredEventId);
    return {
      type: DEST_EVENT,
      eventId: preferredEventId,
      eventName: preferredEventName || ev?.name || 'Event',
    };
  }

  function preferredWarehouseDestination() {
    if (!preferredWarehouseId) return null;
    const wh = warehouses.find((w) => w.id === preferredWarehouseId);
    return {
      type: DEST_WAREHOUSE,
      warehouseId: preferredWarehouseId,
      warehouseName: preferredWarehouseName || wh?.name || 'Warehouse',
    };
  }

  /** Bind Kit to the main-app event and open container home. */
  async function enterPreferredEventHome() {
    const next = preferredEventDestination();
    if (!next) return false;
    // Drop the previous event's lists immediately so a paint cannot show the wrong event.
    eventItems = [];
    eventBalances = new Map();
    stockMap = new Map();
    boundEventId = '';
    boundWarehouseId = '';
    destination = next;
    storeDestination(destination);
    await enterContainerHome();
    return boundEventId === next.eventId;
  }

  /** Bind Kit to the main-app warehouse and open container home. */
  async function enterPreferredWarehouseHome() {
    const next = preferredWarehouseDestination();
    if (!next) return false;
    eventItems = [];
    eventBalances = new Map();
    stockMap = new Map();
    boundEventId = '';
    boundWarehouseId = '';
    destination = next;
    storeDestination(destination);
    await enterContainerHome();
    return boundWarehouseId === next.warehouseId;
  }

  async function enterPreferredLocationHome() {
    if (hasPreferredWarehouse()) return enterPreferredWarehouseHome();
    if (hasPreferredEvent()) return enterPreferredEventHome();
    return false;
  }

  function destTitle() {
    if (isEventDest()) return destination.eventName || 'Event';
    if (isWarehouseDest()) return destination.warehouseName || 'Warehouse';
    return 'Kit count';
  }

  async function enterContainerHome() {
    const gen = ++locationLoadGen;
    const expectEventId = isEventDest() ? destination.eventId : '';
    const expectWarehouseId = isWarehouseDest() ? destination.warehouseId : '';

    if (isEventDest()) {
      const data = await loadEventKit(destination.eventId);
      if (gen !== locationLoadGen) return;
      if (!isEventDest() || destination.eventId !== expectEventId) return;
      eventItems = data.items || [];
      eventBalances = balancesByProduct(data.movements || []);
      boundEventId = expectEventId;
      boundWarehouseId = '';
    } else if (isWarehouseDest()) {
      const map = await loadWarehouseKitStockMap(DB, destination.warehouseId);
      if (gen !== locationLoadGen) return;
      if (!isWarehouseDest() || destination.warehouseId !== expectWarehouseId) return;
      stockMap = map;
      eventItems = [];
      eventBalances = new Map();
      boundWarehouseId = expectWarehouseId;
      boundEventId = '';
    } else {
      eventItems = [];
      eventBalances = new Map();
      stockMap = new Map();
      boundEventId = '';
      boundWarehouseId = '';
    }
    container = null;
    containerStack = [];
    contents = [];
    stockLines = [];
    writeUrlContainer('');
    searchQuery = '';
    showCreateSheet = false;
    showCategorySheet = false;
    screen = 'home';
    stopCamera();
    paint();
  }

  /** Count loose / bulky items straight onto the event or warehouse (no container). */
  async function openLooseCount() {
    searchQuery = '';
    showCreateSheet = false;
    showCategorySheet = false;
    container = null;
    containerStack = [];
    contents = [];
    writeUrlContainer('');
    if (isEventDest()) {
      const data = await loadEventKit(destination.eventId);
      eventItems = data.items || [];
      stockLines = eventPackLines(eventItems).filter((line) => {
        const p = line.product || products.find((x) => x.id === line.product_id);
        return p && !p.is_container;
      });
    } else if (isWarehouseDest()) {
      stockMap = await loadWarehouseKitStockMap(DB, destination.warehouseId);
      stockLines = [];
    } else {
      return;
    }
    focusSearchNext = true;
    feedback = { msg: '', kind: '' };
    screen = 'stock-count';
    stopCamera();
    paint();
  }

  /** Mirror a qty delta onto the chosen event / warehouse destination. */
  async function applyDestDelta(product, delta) {
    if (!product?.id || !delta) return;
    if (isEventDest()) {
      const res = await applyEventPackDelta(
        DB,
        destination.eventId,
        eventItems,
        product,
        delta,
      );
      eventItems = res.items;
    } else if (isWarehouseDest()) {
      const res = await applyWarehouseDelta(
        DB,
        destination.warehouseId,
        stockMap,
        product.id,
        delta,
      );
      stockMap = res.stockMap;
    }
  }

  function syncStockLine(productId, qty, product) {
    const q = Math.max(0, Number(qty) || 0);
    const idx = stockLines.findIndex((l) => l.product_id === productId);
    if (q <= 0) {
      if (idx >= 0) stockLines.splice(idx, 1);
      return;
    }
    const row = {
      product_id: productId,
      qty: q,
      product: product || stockLines[idx]?.product || products.find((p) => p.id === productId) || null,
    };
    if (idx >= 0) stockLines[idx] = row;
    else stockLines.push(row);
    stockLines.sort((a, b) =>
      String(a.product?.name || '').localeCompare(String(b.product?.name || '')));
  }

  async function bumpStockProduct(product, delta = 1) {
    if (!product?.id) return;
    saving = true;
    try {
      if (isEventDest()) {
        const res = await applyEventPackDelta(
          DB,
          destination.eventId,
          eventItems,
          product,
          delta,
        );
        eventItems = res.items;
        if (res.line) syncStockLine(res.line.product_id, res.line.qty, res.line.product);
        else syncStockLine(product.id, 0, product);
      } else if (isWarehouseDest()) {
        const res = await applyWarehouseDelta(
          DB,
          destination.warehouseId,
          stockMap,
          product.id,
          delta,
        );
        stockMap = res.stockMap;
        syncStockLine(product.id, res.qty, product);
      }
      beep();
      feedback = {
        msg: `${product.name || 'Item'} · ${stockLines.find((l) => l.product_id === product.id)?.qty || 0}`,
        kind: 'ok',
      };
      paint();
    } catch (err) {
      feedback = { msg: err.message || 'Update failed', kind: 'err' };
      paintStatus();
    } finally {
      saving = false;
    }
  }

  async function setStockProductQty(product, qty) {
    if (!product?.id) return;
    saving = true;
    try {
      if (isEventDest()) {
        const res = await setEventPackedQty(
          DB,
          destination.eventId,
          eventItems,
          product,
          qty,
        );
        eventItems = res.items;
        if (res.line) syncStockLine(res.line.product_id, res.line.qty, res.line.product);
        else syncStockLine(product.id, 0, product);
      } else if (isWarehouseDest()) {
        const res = await setWarehouseQty(
          DB,
          destination.warehouseId,
          stockMap,
          product.id,
          qty,
        );
        stockMap = res.stockMap;
        syncStockLine(product.id, res.qty, product);
      }
      paint();
    } catch (err) {
      feedback = { msg: err.message || 'Update failed', kind: 'err' };
      paintStatus();
    } finally {
      saving = false;
    }
  }

  async function openContainer(product, {
    ensureContainer = false,
    pushParent = null,
    resetStack = false,
  } = {}) {
    if (!product?.id) return;
    let target = product;
    if (ensureContainer && !target.is_container) {
      target = await DB.products.update(target.id, { is_container: true });
      const idx = products.findIndex((p) => p.id === target.id);
      if (idx >= 0) products[idx] = { ...products[idx], ...target, is_container: true };
      else products.push({ ...target, is_container: true });
    }
    if (resetStack) containerStack = [];
    if (pushParent?.id && pushParent.id !== target.id) {
      containerStack = [...containerStack.filter((id) => id !== pushParent.id), pushParent.id];
    }
    container = products.find((p) => p.id === target.id) || target;

    // Top-level open (scan / pick from event home): pack/receive the box itself
    // onto the chosen event or warehouse if it isn’t there yet.
    let destNote = '';
    if (resetStack && !pushParent && hasStockDest()) {
      try {
        const before = isEventDest()
          ? (Number(eventItems.find((it) => it.product_id === container.id)?.qty_packed) || 0)
          : (Number(stockMap.get(container.id)) || 0);
        await ensureContainerOnDestination(container);
        if (before <= 0) {
          destNote = `Added to ${destTitle()}`;
        }
      } catch (err) {
        destNote = '';
        feedback = {
          msg: err.message || 'Opened box, but could not add it to the destination',
          kind: 'err',
        };
      }
    }

    const rows = await loadKitContainerContents([container.id]);
    const map = contentsByContainer(rows);
    contents = (map.get(container.id) || []).map((c) => ({
      child_product_id: c.child_product_id,
      qty: Number(c.qty) || 1,
      child: c.child || products.find((p) => p.id === c.child_product_id) || null,
    }));
    pushRecentContainerId(container.id);
    writeUrlContainer(container.id);
    searchQuery = '';
    showCreateSheet = false;
    showCategorySheet = false;
    if (feedback.kind !== 'err') {
      feedback = destNote
        ? { msg: destNote, kind: 'ok' }
        : { msg: '', kind: '' };
    }
    focusSearchNext = true;
    screen = 'count';
    stopCamera();
    paint();
  }

  /**
   * Ensure a scanned/selected container is on the event pack list (or
   * warehouse on-hand) so it appears under “On this event”.
   */
  async function ensureContainerOnDestination(product) {
    if (!product?.id || !hasStockDest()) return;
    if (isEventDest()) {
      const existing = eventItems.find((it) => it.product_id === product.id);
      const packed = Number(existing?.qty_packed) || 0;
      if (packed > 0) return;
      await applyDestDelta(product, 1);
      return;
    }
    if (isWarehouseDest()) {
      const onHand = Number(stockMap.get(product.id)) || 0;
      if (onHand > 0) return;
      await applyDestDelta(product, 1);
    }
  }

  async function goBackFromCount({ doneMessage = '' } = {}) {
    showCreateSheet = false;
    showCategorySheet = false;
    if (containerStack.length) {
      const parentId = containerStack.pop();
      const parent = products.find((p) => p.id === parentId);
      if (parent) {
        await openContainer(parent);
        if (doneMessage) {
          feedback = { msg: doneMessage, kind: 'ok' };
          paintStatus();
        }
        return;
      }
    }
    container = null;
    contents = [];
    containerStack = [];
    writeUrlContainer('');
    searchQuery = '';
    screen = 'home';
    if (doneMessage) feedback = { msg: doneMessage, kind: 'ok' };
    if (isEventDest()) {
      loadEventKit(destination.eventId)
        .then((data) => {
          eventItems = data.items || [];
          eventBalances = balancesByProduct(data.movements || []);
          boundEventId = destination.eventId;
          boundWarehouseId = '';
          if (screen === 'home') paint();
        })
        .catch(() => paint());
      return;
    }
    paint();
  }

  function openCreateSheet({ asContainer = false, name = '', barcode = '' } = {}) {
    createDraft = {
      name: name || searchQuery.trim(),
      categoryId: createDraft.categoryId || '',
      barcode: barcode || '',
      qty: '1',
      asContainer: !!asContainer,
      queueLabel: createDraft.queueLabel !== false,
    };
    showCreateSheet = true;
    showCategorySheet = false;
    paint();
  }

  async function queueLabelForProduct(product, { quiet = false } = {}) {
    if (!product?.id) return false;
    try {
      await enqueueKitLabel(DB, product, { resolveBarcode: resolveKitLabelPayload });
      queuedProductIds.add(product.id);
      const local = products.find((p) => p.id === product.id);
      if (local && product.barcode) local.barcode = product.barcode;
      if (!quiet) {
        feedback = { msg: `Label queued · ${product.name || 'item'}`, kind: 'ok' };
        paintStatus();
      }
      return true;
    } catch (err) {
      if (!quiet) {
        feedback = { msg: err.message || 'Could not queue label', kind: 'err' };
        paintStatus();
      }
      return false;
    }
  }

  async function refreshQueuedIds() {
    try {
      const rows = await loadPendingKitLabelQueue(DB);
      queuedProductIds = new Set((rows || []).map((r) => r.product_id).filter(Boolean));
    } catch {
      queuedProductIds = new Set();
    }
  }

  async function persistContents() {
    if (!container?.id || saving) return;
    saving = true;
    paintStatus();
    try {
      await replaceKitContainerContents(container.id, contentsToSaveLines(contents));
      if (!container.is_container) {
        const updated = await DB.products.update(container.id, { is_container: true });
        container = { ...container, ...updated, is_container: true };
        const idx = products.findIndex((p) => p.id === container.id);
        if (idx >= 0) products[idx] = { ...products[idx], is_container: true };
      }
      feedback = { msg: 'Saved', kind: 'ok' };
    } catch (err) {
      feedback = { msg: err.message || 'Save failed', kind: 'err' };
    } finally {
      saving = false;
      paintStatus();
    }
  }

  async function addOrBumpProduct(product, delta = 1) {
    if (!product?.id || !container?.id) return;
    if (product.id === container.id) {
      feedback = { msg: 'That’s this container', kind: 'err' };
      paintStatus();
      return;
    }
    const before = Number(contents.find((c) => c.child_product_id === product.id)?.qty) || 0;
    contents = bumpContentsLine(contents, product.id, delta, product);
    const after = Number(contents.find((c) => c.child_product_id === product.id)?.qty) || 0;
    const applied = after - before;
    beep();
    feedback = {
      msg: `${product.name || 'Item'} · ${after}`,
      kind: 'ok',
    };
    paint();
    await persistContents();
    if (applied) {
      try {
        await applyDestDelta(product, applied);
      } catch (err) {
        feedback = { msg: err.message || 'Saved in box, but destination update failed', kind: 'err' };
        paintStatus();
      }
    }
  }

  function stopCamera() {
    stopped = true;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = 0;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const video = $('kcVideo');
    if (video) video.srcObject = null;
  }

  async function openCamera() {
    const constraintsList = [
      { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: { ideal: 'environment' } } },
      { audio: false, video: true },
    ];
    let lastErr = null;
    for (const constraints of constraintsList) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('getUserMedia failed');
  }

  function scheduleTick(ms = 180) {
    if (stopped) return;
    scanTimer = window.setTimeout(tick, ms);
  }

  async function onScannedCode(raw) {
    const code = String(raw || '').trim();
    if (!code || handling || stopped) return;
    const now = Date.now();
    if (code === lastCode && now - lastAt < PHONE_DEBOUNCE_MS) return;
    lastCode = code;
    lastAt = now;
    handling = true;
    try {
      if (screen === 'scan-container') {
        const hit = resolveContainerScan(products, code, findProductByBarcode);
        if (hit.kind === 'container') {
          beep();
          await openContainer(hit.product, { resetStack: true });
          return;
        }
        if (hit.kind === 'item') {
          beep();
          // Promote existing kit item to a container and start counting
          await openContainer(hit.product, { ensureContainer: true, resetStack: true });
          feedback = { msg: `Using “${hit.product.name}” as container`, kind: 'ok' };
          paintStatus();
          return;
        }
        createDraft = { name: '', categoryId: '', barcode: code, qty: '1', asContainer: false };
        screen = 'create-container';
        stopCamera();
        feedback = { msg: 'Unknown barcode — create the container', kind: 'ok' };
        paint();
        return;
      }

      if (screen === 'scan-item') {
        const looseMode = !container && hasStockDest();
        const containerId = container?.id || '';
        const hit = resolveItemScan(products, code, containerId, findProductByBarcode);
        if (hit.kind === 'self') {
          feedback = { msg: 'That’s this container’s label', kind: 'err' };
          paintStatus();
          return;
        }
        if (hit.kind === 'match') {
          if (looseMode) {
            await bumpStockProduct(hit.product, 1);
          } else {
            await addOrBumpProduct(hit.product, 1);
          }
          return;
        }
        stopCamera();
        screen = looseMode ? 'stock-count' : 'count';
        openCreateSheet({ asContainer: false, barcode: code });
        feedback = { msg: 'Unknown item — create it', kind: 'ok' };
        return;
      }
    } finally {
      handling = false;
    }
  }

  function tick() {
    if (stopped) return;
    const video = $('kcVideo');
    const canvas = $('kcCanvas');
    if (!video || !canvas) {
      scheduleTick(300);
      return;
    }
    frames += 1;
    if (frames % 6 === 0) frameMode = frameMode === 'crop' ? 'full' : 'crop';
    if (video.readyState >= 2) {
      try {
        const frame = grabFrame(video, canvas, frameMode);
        if (frame) {
          const result = reader.decodeFromCanvas(frame);
          const text = result?.getText?.() || '';
          if (text) {
            onScannedCode(text);
            scheduleTick(600);
            return;
          }
        }
      } catch { /* miss */ }
    }
    scheduleTick(video.readyState >= 2 ? 160 : 280);
  }

  async function startCameraUi() {
    stopped = false;
    frames = 0;
    lastCode = '';
    lastAt = 0;
    const video = $('kcVideo');
    if (!video) return;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.muted = true;
    video.playsInline = true;
    try {
      stream = await openCamera();
    } catch {
      feedback = { msg: 'Camera unavailable — type the barcode below', kind: 'err' };
      paintStatus();
      $('kcManualInput')?.focus();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      feedback = { msg: 'Tap the camera to start', kind: 'err' };
      paintStatus();
    }
    feedback = { msg: 'Aim at the QR / barcode', kind: '' };
    paintStatus();
    scheduleTick(120);
  }

  function paintStatus() {
    const el = $('kcFeedback');
    if (!el) return;
    const msg = feedback.msg || (saving ? 'Saving…' : '');
    el.textContent = msg || ' ';
    el.className = 'kc-feedback' + (feedback.kind ? ` is-${feedback.kind}` : '');
  }

  function categorySelectOptions() {
    return categories.map((c) => ({
      value: c.id,
      label: c.name || 'Category',
    }));
  }

  /** @type {ReturnType<typeof mountSearchSelect> | null} */
  let categoryPicker = null;

  function mountCategorySelect(mountEl, {
    hiddenId = 'kcCategory',
    inputId = 'kcCategoryInput',
    value = '',
  } = {}) {
    if (!mountEl) return null;
    categoryPicker = mountSearchSelect(mountEl, {
      options: categorySelectOptions(),
      value: value || '',
      placeholder: 'Search categories…',
      emptyLabel: 'Category…',
      allowEmpty: true,
      hiddenId,
      inputId,
      inputClass: 'search-select-input kc-search-select-input',
      onSelect: ({ value: next }) => {
        createDraft.categoryId = next || '';
      },
    });
    return categoryPicker;
  }

  function recentContainers() {
    const ids = loadRecentContainerIds();
    return ids
      .map((id) => products.find((p) => p.id === id && p.is_container))
      .filter(Boolean);
  }

  function paintDest() {
    // Main-app location is already selected — skip warehouse / event pick.
    if (hasPreferredLocation()) {
      enterPreferredLocationHome().catch((err) => {
        feedback = { msg: err.message || 'Could not open location', kind: 'err' };
        preferredEventId = '';
        preferredWarehouseId = '';
        paintDest();
      });
      return;
    }

    app.innerHTML = `
      <header class="kc-top">
        <div class="kc-brand">Kit</div>
        <h1 class="kc-title">Where to count?</h1>
        <p class="kc-sub">Choose event or warehouse, then count containers and what’s inside.</p>
      </header>
      ${feedback.msg ? `<div class="kc-feedback${feedback.kind ? ` is-${feedback.kind}` : ''}" id="kcFeedback" style="margin:0 16px">${escapeHtml(feedback.msg)}</div>` : ''}
      <div class="kc-actions">
        <button type="button" class="kc-dest-btn" data-dest="${DEST_EVENT}">
          <strong>${escapeHtml(DEST_LABELS[DEST_EVENT])}</strong>
          <em>${escapeHtml(DEST_HINTS[DEST_EVENT])}</em>
        </button>
        <button type="button" class="kc-dest-btn" data-dest="${DEST_WAREHOUSE}">
          <strong>${escapeHtml(DEST_LABELS[DEST_WAREHOUSE])}</strong>
          <em>${escapeHtml(DEST_HINTS[DEST_WAREHOUSE])}</em>
        </button>
      </div>
    `;
    app.querySelectorAll('[data-dest]').forEach((btn) => {
      btn.onclick = () => {
        const type = btn.dataset.dest;
        feedback = { msg: '', kind: '' };
        if (type === DEST_EVENT) {
          screen = 'pick-event';
          paint();
          return;
        }
        if (type === DEST_WAREHOUSE) {
          screen = 'pick-warehouse';
          paint();
        }
      };
    });
  }

  function paintPickEvent() {
    app.innerHTML = `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcBack">Back</button>
        <div class="kc-top-grow">
          <div class="kc-brand">Kit</div>
          <h1 class="kc-title kc-title--sm">Choose event</h1>
        </div>
      </header>
      <div class="kc-section">
        <div class="kc-list">
          ${events.length ? events.map((ev) => `
            <button type="button" class="kc-row" data-event="${escapeHtml(ev.id)}">
              <span class="kc-row-name">${escapeHtml(ev.name || 'Event')}</span>
              <span class="kc-row-meta">${escapeHtml(ev.status || '')}</span>
            </button>`).join('') : '<p class="kc-empty">No events found.</p>'}
        </div>
      </div>
    `;
    $('kcBack').onclick = () => {
      screen = 'dest';
      paint();
    };
    app.querySelectorAll('[data-event]').forEach((btn) => {
      btn.onclick = async () => {
        const ev = events.find((e) => e.id === btn.dataset.event);
        if (!ev) return;
        destination = {
          type: DEST_EVENT,
          eventId: ev.id,
          eventName: ev.name || 'Event',
        };
        storeDestination(destination);
        try {
          await enterContainerHome();
        } catch (err) {
          feedback = { msg: err.message || 'Could not open event', kind: 'err' };
          screen = 'pick-event';
          paint();
        }
      };
    });
  }

  function paintPickWarehouse() {
    app.innerHTML = `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcBack">Back</button>
        <div class="kc-top-grow">
          <div class="kc-brand">Warehouse</div>
          <h1 class="kc-title kc-title--sm">Choose warehouse</h1>
        </div>
      </header>
      <div class="kc-section">
        <div class="kc-list">
          ${warehouses.length ? warehouses.map((wh) => `
            <button type="button" class="kc-row" data-wh="${escapeHtml(wh.id)}">
              <span class="kc-row-name">${escapeHtml(wh.name || 'Warehouse')}</span>
            </button>`).join('') : '<p class="kc-empty">No warehouses found.</p>'}
        </div>
      </div>
    `;
    $('kcBack').onclick = () => {
      screen = 'dest';
      paint();
    };
    app.querySelectorAll('[data-wh]').forEach((btn) => {
      btn.onclick = async () => {
        const wh = warehouses.find((w) => w.id === btn.dataset.wh);
        if (!wh) return;
        destination = {
          type: DEST_WAREHOUSE,
          warehouseId: wh.id,
          warehouseName: wh.name || 'Warehouse',
        };
        storeDestination(destination);
        try {
          await enterContainerHome();
        } catch (err) {
          feedback = { msg: err.message || 'Could not open warehouse', kind: 'err' };
          screen = 'pick-warehouse';
          paint();
        }
      };
    });
  }

  function resolveEventProduct(productId, fallback) {
    const lib = products.find((p) => p.id === productId);
    const p = lib || fallback;
    if (!p?.id) return null;
    return { ...p, is_container: !!(lib?.is_container || p.is_container) };
  }

  /** What this event needs (planned pick list). */
  function pickListRows() {
    const out = [];
    const seen = new Set();
    for (const it of eventItems || []) {
      const planned = Number(it.qty_planned) || 0;
      if (planned <= 0) continue;
      const p = resolveEventProduct(it.product_id, it.product);
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({
        product: p,
        planned,
        packed: Number(it.qty_packed) || 0,
      });
    }
    out.sort((a, b) =>
      String(a.product.name || '').localeCompare(String(b.product.name || '')));
    return out;
  }

  /**
   * Physical kit already on the event (movements), plus packed extras that
   * aren’t on the pick list (Need = 0).
   */
  function onEventRows() {
    const out = [];
    const seen = new Set();
    const itemByProduct = new Map((eventItems || []).map((it) => [it.product_id, it]));

    for (const [productId, bal] of eventBalances || []) {
      const onHand = Number(bal?.onHand) || 0;
      if (onHand <= 0) continue;
      const it = itemByProduct.get(productId);
      const p = resolveEventProduct(productId, it?.product);
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({
        product: p,
        onHand,
        owned: Number(bal?.owned) || 0,
        hired: Number(bal?.hired) || 0,
        packed: Number(it?.qty_packed) || 0,
      });
    }

    // Packed on phone but not planned and not moved onto the event yet.
    for (const it of eventItems || []) {
      const packed = Number(it.qty_packed) || 0;
      const planned = Number(it.qty_planned) || 0;
      if (packed <= 0 || planned > 0 || seen.has(it.product_id)) continue;
      const p = resolveEventProduct(it.product_id, it.product);
      if (!p?.id) continue;
      seen.add(p.id);
      out.push({
        product: p,
        onHand: 0,
        owned: 0,
        hired: 0,
        packed,
      });
    }

    out.sort((a, b) =>
      String(a.product.name || '').localeCompare(String(b.product.name || '')));
    return out;
  }

  function paintHome() {
    const q = searchQuery.trim();
    const pickList = isEventDest() ? pickListRows() : [];
    const onEvent = isEventDest() ? onEventRows() : [];
    const containerProducts = products.filter((p) => p.is_container);
    const searchHits = q
      ? filterKitProducts(containerProducts, q, { limit: 40 })
      : [];
    const recent = !isEventDest() && !q ? recentContainers() : [];
    const fallbackContainers = !isEventDest() && !q && !recent.length
      ? containerProducts.slice(0, 12)
      : [];

    function containerInitials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
    }

    function containerAvatarTone(seed) {
      const tones = ['teal', 'green', 'amber', 'rose', 'violet', 'sky', 'orange'];
      const s = String(seed || '');
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return tones[h % tones.length];
    }

    function containerRowHtml(p, {
      category = '',
      subtitle = '',
      trail = '',
      openable = true,
      rowClass = '',
    } = {}) {
      const name = p.name || 'Container';
      const cat = category || p.category?.name || '';
      const canOpen = openable && p.is_container;
      const openAttr = canOpen ? ` data-open="${escapeHtml(p.id)}"` : '';
      const tag = canOpen ? 'button' : 'div';
      const typeAttr = tag === 'button' ? ' type="button"' : '';
      const classes = [
        'kc-table-row',
        canOpen ? '' : 'kc-table-row--static',
        rowClass,
      ].filter(Boolean).join(' ');
      const caret = canOpen
        ? '<i class="ph ph-caret-right kc-table-caret" aria-hidden="true"></i>'
        : '';
      return `
        <${tag}${typeAttr} class="${classes}"${openAttr}>
          <span class="kc-table-avatar" data-tone="${escapeHtml(containerAvatarTone(p.id || name))}" aria-hidden="true">${escapeHtml(containerInitials(name))}</span>
          <span class="kc-table-main">
            <span class="kc-table-topline">
              <span class="kc-table-title">
                ${escapeHtml(name)}${cat ? ` <em class="kc-table-cat">(${escapeHtml(cat)})</em>` : ''}
              </span>
              ${trail ? `<span class="kc-table-trail">${escapeHtml(trail)}</span>` : ''}
            </span>
            ${subtitle ? `<span class="kc-table-sub">${escapeHtml(subtitle)}</span>` : ''}
          </span>
          ${caret}
        </${tag}>`;
    }

    function pickListRowHtml({ product: p, packed, planned }) {
      const short = planned > 0 && packed < planned;
      const statusBits = [
        `Need ${planned}`,
        packed ? `Packed ${packed}` : 'Not packed',
      ];
      return containerRowHtml(p, {
        category: p.category?.name || '',
        subtitle: statusBits.join(' · '),
        trail: `${packed || 0}/${planned}`,
        openable: !!p.is_container,
        rowClass: short ? 'kc-table-row--short' : '',
      });
    }

    function onEventRowHtml({ product: p, onHand, owned, hired, packed }) {
      const statusBits = [];
      if (onHand > 0) {
        statusBits.push(`Here ${onHand}`);
        if (owned > 0 && hired > 0) statusBits.push(`Own ${owned} · Hire ${hired}`);
        else if (hired > 0) statusBits.push('Hire-in');
        else if (owned > 0) statusBits.push('Own');
      } else if (packed > 0) {
        statusBits.push(`Packed ${packed}`);
        statusBits.push('Counted — not moved on yet');
      }
      const trail = onHand > 0 ? String(onHand) : (packed ? `P${packed}` : '');
      return containerRowHtml(p, {
        category: p.category?.name || '',
        subtitle: statusBits.join(' · ') || 'On event',
        trail,
        openable: !!p.is_container,
      });
    }

    const locationLocked = hasPreferredLocation()
      && ((hasPreferredEvent() && isEventDest()) || (hasPreferredWarehouse() && isWarehouseDest()));
    const homeTitle = isWarehouseDest() ? 'Warehouse' : (isEventDest() ? 'Event kit' : 'Kit');
    const homeSub = isEventDest()
      ? (homeEventTab === 'pick'
        ? 'What this event needs — pack against Need.'
        : 'Physical kit already here from warehouse or hire.')
      : 'Scan, search, or create a box, then add what’s inside.';
    const heroHtml = `
      <div class="page-hero page-hero--compact">
        <p class="page-kicker">Stock</p>
        <h1 class="page-title">${escapeHtml(homeTitle)}</h1>
        <p class="page-sub">${escapeHtml(homeSub)}</p>
      </div>`;

    const pickEmpty = '<p class="kc-empty kc-empty--panel"><span class="kc-empty-icon" aria-hidden="true"><i class="ph ph-clipboard-text"></i></span><span class="kc-empty-title">No pick list yet</span><span class="kc-empty-copy">Add Need qty in admin, or scan / create containers here to start packing.</span></p>';
    const onEventEmpty = '<p class="kc-empty kc-empty--panel"><span class="kc-empty-icon" aria-hidden="true"><i class="ph ph-package"></i></span><span class="kc-empty-title">Nothing on this event yet</span><span class="kc-empty-copy">Shows kit sent from warehouse or hired in. Packing updates Need progress on the pick list.</span></p>';
    const eventListHtml = !isEventDest() ? '' : (homeEventTab === 'pick'
      ? (pickList.length
        ? `<div class="kc-table" id="kcHomeList">${pickList.map(pickListRowHtml).join('')}</div>`
        : pickEmpty)
      : (onEvent.length
        ? `<div class="kc-table" id="kcHomeList">${onEvent.map(onEventRowHtml).join('')}</div>`
        : onEventEmpty));

    app.innerHTML = `
      ${locationLocked
    ? heroHtml
    : `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcChangeDest">Change</button>
        <div class="kc-top-grow">${heroHtml}</div>
      </header>`}
      ${feedback.msg ? `<div class="kc-feedback${feedback.kind ? ` is-${feedback.kind}` : ''}" id="kcFeedback">${escapeHtml(feedback.msg)}</div>` : ''}
      <div class="kc-actions kc-actions--home">
        <input class="kc-search kc-search--block" id="kcHomeSearch" type="search"
          placeholder="Search containers…" value="${escapeHtml(searchQuery)}"
          autocomplete="off" enterkeyhint="search">
        <div class="kc-quick" role="group" aria-label="Quick actions">
          <button type="button" class="kc-quick-item" id="kcScanContainer">
            <span class="kc-quick-icon" aria-hidden="true"><i class="ph-bold ph-barcode"></i></span>
            <strong>Scan</strong>
          </button>
          <button type="button" class="kc-quick-item" id="kcCreateContainer">
            <span class="kc-quick-icon" aria-hidden="true"><i class="ph-bold ph-plus"></i></span>
            <strong>Create</strong>
          </button>
          <button type="button" class="kc-quick-item" id="kcLooseItems">
            <span class="kc-quick-icon" aria-hidden="true"><i class="ph-bold ph-package"></i></span>
            <strong>Loose</strong>
          </button>
        </div>
      </div>

      ${q ? `
        <section class="kc-section">
          <h2 class="kc-section-title">Search results</h2>
          <div class="kc-table" id="kcHomeList">
            ${searchHits.length
    ? searchHits.map((p) => containerRowHtml(p, {
      category: p.category?.name || '',
      subtitle: 'Container',
    })).join('')
    : `<p class="kc-empty">No containers match “${escapeHtml(q)}”</p>`}
          </div>
        </section>` : ''}

      ${!q && isEventDest() ? `
        <div class="kc-event-tabs" role="tablist" aria-label="Event kit views">
          <button type="button" class="kc-event-tab${homeEventTab === 'pick' ? ' is-active' : ''}"
            role="tab" aria-selected="${homeEventTab === 'pick' ? 'true' : 'false'}"
            id="kcTabPick" data-event-tab="pick">
            Pick list${pickList.length ? ` <span class="kc-event-tab-count">${pickList.length}</span>` : ''}
          </button>
          <button type="button" class="kc-event-tab${homeEventTab === 'on-event' ? ' is-active' : ''}"
            role="tab" aria-selected="${homeEventTab === 'on-event' ? 'true' : 'false'}"
            id="kcTabOnEvent" data-event-tab="on-event">
            On event${onEvent.length ? ` <span class="kc-event-tab-count">${onEvent.length}</span>` : ''}
          </button>
        </div>
        <section class="kc-section kc-section--event-tab" aria-labelledby="${homeEventTab === 'pick' ? 'kcTabPick' : 'kcTabOnEvent'}">
          ${eventListHtml}
        </section>` : ''}

      ${!q && recent.length ? `
        <section class="kc-section">
          <h2 class="kc-section-title">Recent</h2>
          <div class="kc-table" id="kcHomeList">
            ${recent.map((p) => containerRowHtml(p, {
              category: p.category?.name || '',
              subtitle: 'Recent',
            })).join('')}
          </div>
        </section>` : ''}

      ${!q && fallbackContainers.length ? `
        <section class="kc-section">
          <h2 class="kc-section-title">Containers</h2>
          <div class="kc-table" id="kcHomeList">
            ${fallbackContainers.map((p) => containerRowHtml(p, {
              category: p.category?.name || '',
              subtitle: 'Container',
            })).join('')}
          </div>
        </section>` : ''}
    `;

    $('kcChangeDest')?.addEventListener('click', () => {
      destination = null;
      storeDestination(null);
      screen = 'dest';
      paint();
    });
    app.querySelectorAll('[data-event-tab]').forEach((btn) => {
      btn.onclick = () => {
        const next = btn.dataset.eventTab === 'on-event' ? 'on-event' : 'pick';
        if (homeEventTab === next) return;
        homeEventTab = next;
        searchQuery = '';
        paintHome();
      };
    });
    $('kcScanContainer').onclick = () => {
      screen = 'scan-container';
      feedback = { msg: '', kind: '' };
      paint();
      startCameraUi();
    };
    $('kcCreateContainer').onclick = () => {
      createDraft = { name: '', categoryId: '', barcode: '', qty: '1', asContainer: false, queueLabel: true };
      screen = 'create-container';
      paint();
      $('kcName')?.focus();
    };
    $('kcLooseItems').onclick = () => {
      openLooseCount().catch((err) => {
        feedback = { msg: err.message || 'Could not open', kind: 'err' };
        paint();
      });
    };

    const homeSearch = $('kcHomeSearch');
    let homeTimer = 0;
    homeSearch?.addEventListener('input', () => {
      searchQuery = homeSearch.value || '';
      window.clearTimeout(homeTimer);
      homeTimer = window.setTimeout(() => {
        paintHome();
        const again = $('kcHomeSearch');
        if (again) {
          again.focus();
          const len = again.value.length;
          again.setSelectionRange(len, len);
        }
      }, 80);
    });

    app.querySelectorAll('[data-open]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.open;
        const fromEvent = eventItems.find((it) => it.product_id === id)?.product;
        const p = products.find((x) => x.id === id)
          || resolveEventProduct(id, fromEvent);
        if (p) openContainer(p, { resetStack: true, ensureContainer: true });
      };
    });
  }

  function paintStockCount() {
    const exclude = new Set(stockLines.map((l) => l.product_id));
    const q = searchQuery.trim();
    const hits = q
      ? filterKitProducts(products.filter((p) => !p.is_container), searchQuery, {
        excludeIds: exclude,
        limit: 8,
      })
      : [];
    const totalQty = stockLines.reduce((s, c) => s + (Number(c.qty) || 0), 0);
    const qtyLabel = isEventDest() ? 'packed' : 'on hand';

    function suggestHtml(query, list) {
      if (!query) {
        return `
          <p class="kc-empty">Type to search, or scan a barcode</p>
          <button type="button" class="kc-btn kc-btn--ghost kc-btn--block" id="kcCreateItem">Create new item</button>`;
      }
      return `
        ${list.length ? list.map((p) => `
          <button type="button" class="kc-suggest-row" data-add="${escapeHtml(p.id)}">
            <span>
              <strong>${escapeHtml(p.name || 'Item')}</strong>
              <em>${escapeHtml(p.category?.name || '')}</em>
            </span>
            <span class="kc-suggest-plus">+1</span>
          </button>`).join('') : `<p class="kc-empty">No match for “${escapeHtml(query)}”</p>`}
        <button type="button" class="kc-btn kc-btn--ghost kc-btn--block" id="kcCreateItem">
          Create item “${escapeHtml(query)}”
        </button>`;
    }

    app.innerHTML = `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcBack">Back</button>
        <div class="kc-top-grow">
          <div class="kc-brand">${escapeHtml(isEventDest() ? 'Kit' : 'Warehouse')} · loose / bulky</div>
          <h1 class="kc-title kc-title--sm">${escapeHtml(destTitle())}</h1>
          <p class="kc-meta">${stockLines.length} item${stockLines.length === 1 ? '' : 's'} · ${escapeHtml(String(totalQty))} ${qtyLabel}</p>
        </div>
      </header>

      <div class="kc-add-panel">
        <div class="kc-search-row">
          <input class="kc-search" id="kcSearch" type="search" placeholder="Search kit to add…"
            value="${escapeHtml(searchQuery)}" autocomplete="off" enterkeyhint="search">
          <button type="button" class="kc-btn kc-btn--icon" id="kcScanItem" title="Scan item">Scan</button>
        </div>
        <div class="kc-feedback" id="kcFeedback"> </div>
        <div class="kc-suggest" id="kcSuggest">
          ${suggestHtml(q, hits)}
        </div>
      </div>

      <section class="kc-section kc-section--grow">
        <h2 class="kc-section-title">Loose / bulky items</h2>
        <div class="kc-list" id="kcContents">
          ${stockLines.length ? stockLines.map((c) => {
    const name = c.product?.name || 'Item';
    const cat = c.product?.category?.name || '';
    const queued = queuedProductIds.has(c.product_id);
    return `
              <div class="kc-content-row" data-child="${escapeHtml(c.product_id)}">
                <div class="kc-content-main" disabled>
                  <strong>${escapeHtml(name)}</strong>
                  ${cat ? `<em>${escapeHtml(cat)}</em>` : ''}
                </div>
                <button type="button" class="kc-label-btn${queued ? ' is-queued' : ''}" data-queue-label
                  title="${queued ? 'Already in print queue' : 'Add label to print queue'}">
                  ${queued ? 'Queued' : 'Label'}
                </button>
                <div class="kc-stepper">
                  <button type="button" class="kc-step" data-delta="-1" aria-label="Decrease">−</button>
                  <input type="text" inputmode="decimal" class="kc-qty" value="${escapeHtml(String(c.qty))}" aria-label="Qty">
                  <button type="button" class="kc-step" data-delta="1" aria-label="Increase">+</button>
                </div>
                <button type="button" class="kc-remove" data-remove title="Remove">×</button>
              </div>`;
  }).join('') : `<p class="kc-empty">Nothing counted yet — search, scan, or create an item.</p>`}
        </div>
      </section>

      <div class="kc-complete-bar">
        <button type="button" class="kc-btn kc-btn--primary kc-btn--block" id="kcComplete">
          Complete loose count
        </button>
      </div>

      ${showCreateSheet ? createItemSheetHtml() : ''}
      ${showCategorySheet ? categorySheetHtml() : ''}
    `;
    paintStatus();

    $('kcBack').onclick = () => {
      searchQuery = '';
      screen = 'home';
      paint();
    };

    $('kcComplete').onclick = async () => {
      const btn = $('kcComplete');
      if (btn) btn.disabled = true;
      feedback = {
        msg: `Loose count done · ${stockLines.length} item${stockLines.length === 1 ? '' : 's'}`,
        kind: 'ok',
      };
      searchQuery = '';
      stockLines = [];
      screen = 'home';
      if (isEventDest()) {
        try {
          const data = await loadEventKit(destination.eventId);
          eventItems = data.items || [];
          eventBalances = balancesByProduct(data.movements || []);
          boundEventId = destination.eventId;
          boundWarehouseId = '';
        } catch { /* ignore */ }
      }
      paint();
    };

    function wireSuggest(root) {
      root?.querySelectorAll('[data-add]').forEach((btn) => {
        btn.onclick = () => {
          const p = products.find((x) => x.id === btn.dataset.add);
          if (!p) return;
          searchQuery = '';
          bumpStockProduct(p, 1);
        };
      });
      root?.querySelector('#kcCreateItem')?.addEventListener('click', () => {
        openCreateSheet({ asContainer: false });
      });
    }

    const search = $('kcSearch');
    if (focusSearchNext) {
      focusSearchNext = false;
      requestAnimationFrame(() => search?.focus());
    }
    let searchTimer = 0;
    search?.addEventListener('input', () => {
      searchQuery = search.value || '';
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        const box = $('kcSuggest');
        if (!box) return;
        const nextQ = searchQuery.trim();
        const nextHits = nextQ
          ? filterKitProducts(products.filter((p) => !p.is_container), searchQuery, {
            excludeIds: new Set(stockLines.map((l) => l.product_id)),
            limit: 8,
          })
          : [];
        box.innerHTML = suggestHtml(nextQ, nextHits);
        wireSuggest(box);
      }, 80);
    });

    $('kcScanItem').onclick = () => {
      showCreateSheet = false;
      showCategorySheet = false;
      screen = 'scan-item';
      feedback = { msg: '', kind: '' };
      paint();
      startCameraUi();
    };

    wireSuggest($('kcSuggest'));

    app.querySelectorAll('.kc-content-row').forEach((row) => {
      const childId = row.dataset.child;
      row.querySelector('[data-queue-label]')?.addEventListener('click', async () => {
        const child = products.find((p) => p.id === childId)
          || stockLines.find((c) => c.product_id === childId)?.product;
        if (!child) return;
        const ok = await queueLabelForProduct(child);
        if (ok) paint();
      });
      row.querySelectorAll('[data-delta]').forEach((btn) => {
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try { btn.blur(); } catch { /* ignore */ }
          const delta = Number(btn.dataset.delta) || 0;
          const product = products.find((p) => p.id === childId)
            || stockLines.find((c) => c.product_id === childId)?.product;
          if (!product) return;
          const line = stockLines.find((c) => c.product_id === childId);
          if (delta < 0 && line && (Number(line.qty) || 0) + delta <= 0) {
            await setStockProductQty(product, 0);
            return;
          }
          await bumpStockProduct(product, delta);
        };
      });
      const qtyInput = row.querySelector('.kc-qty');
      qtyInput?.addEventListener('change', async () => {
        const product = products.find((p) => p.id === childId)
          || stockLines.find((c) => c.product_id === childId)?.product;
        if (!product) return;
        await setStockProductQty(product, parseContentsQty(qtyInput.value));
      });
      row.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const product = products.find((p) => p.id === childId)
          || stockLines.find((c) => c.product_id === childId)?.product;
        if (!product) return;
        if (isEventDest()) await setStockProductQty(product, 0);
        else if (isWarehouseDest()) {
          // Remove from this count session only — leave warehouse stock unchanged
          syncStockLine(childId, 0, product);
          paint();
        }
      });
    });

    if (showCreateSheet) wireCreateItemSheet();
    wireCategorySheet(() => paint());
  }

  function paintScanShell({ title, hint, backLabel, backScreen }) {
    app.innerHTML = `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcBack">${escapeHtml(backLabel)}</button>
        <div>
          <div class="kc-brand">Measured · Kit</div>
          <h1 class="kc-title kc-title--sm">${escapeHtml(title)}</h1>
        </div>
      </header>
      <p class="kc-sub kc-pad">${escapeHtml(hint)}</p>
      <div class="kc-stage" id="kcStage">
        <video id="kcVideo" playsinline muted autoplay></video>
        <canvas id="kcCanvas"></canvas>
        <div class="kc-reticle" aria-hidden="true"></div>
      </div>
      <div class="kc-feedback" id="kcFeedback"> </div>
      <form class="kc-manual" id="kcManualForm">
        <input id="kcManualInput" type="text" inputmode="text" autocomplete="off"
          placeholder="Or type / paste barcode" aria-label="Barcode">
        <button type="submit">Go</button>
      </form>
    `;
    paintStatus();
    $('kcBack').onclick = () => {
      stopCamera();
      screen = backScreen
        || (container ? 'count' : (hasStockDest() ? 'stock-count' : 'home'));
      paint();
    };
    $('kcManualForm').onsubmit = (e) => {
      e.preventDefault();
      const input = $('kcManualInput');
      const val = input?.value || '';
      if (input) input.value = '';
      onScannedCode(val);
    };
    $('kcStage')?.addEventListener('click', () => {
      lastCode = '';
      lastAt = 0;
      feedback = { msg: 'Ready — aim at the QR / barcode', kind: '' };
      paintStatus();
      $('kcVideo')?.play?.().catch(() => {});
    });
  }

  function paintCreateContainer() {
    app.innerHTML = `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcBack">Back</button>
        <div>
          <div class="kc-brand">Measured · Kit</div>
          <h1 class="kc-title kc-title--sm">New container</h1>
        </div>
      </header>
      <form class="kc-form" id="kcCreateForm">
        <label class="kc-field">
          <span>Name</span>
          <input id="kcName" type="text" required placeholder="e.g. Pallet box A12" autocomplete="off">
        </label>
        <label class="kc-field">
          <span>Category</span>
          <div class="kc-field-row">
            <div id="kcCategoryMount" class="kc-search-select-mount"></div>
            <button type="button" class="kc-btn kc-btn--compact" id="kcNewCat">+ New</button>
          </div>
        </label>
        <label class="kc-field">
          <span>Barcode <em>(optional)</em></span>
          <input id="kcBarcode" type="text" placeholder="Scan or paste" autocomplete="off" inputmode="text">
        </label>
        <label class="kc-check">
          <input type="checkbox" id="kcQueueLabel" checked>
          <span>Add label to print queue <em>(print from Kit library on desktop)</em></span>
        </label>
        <p class="kc-err" id="kcFormErr" hidden></p>
        <button type="submit" class="kc-btn kc-btn--primary kc-btn--block">Create &amp; start counting</button>
      </form>
      ${showCategorySheet ? categorySheetHtml() : ''}
    `;
    $('kcName').value = createDraft.name;
    $('kcBarcode').value = createDraft.barcode;
    mountCategorySelect($('kcCategoryMount'), {
      hiddenId: 'kcCategory',
      inputId: 'kcCategoryInput',
      value: createDraft.categoryId || '',
    });
    $('kcBack').onclick = () => {
      showCategorySheet = false;
      screen = 'home';
      paint();
    };
    $('kcNewCat').onclick = () => {
      createDraft.name = $('kcName')?.value || '';
      createDraft.categoryId = categoryPicker?.getValue?.() || $('kcCategory')?.value || '';
      createDraft.barcode = $('kcBarcode')?.value || '';
      newCategoryName = '';
      showCategorySheet = true;
      paint();
    };
    wireCategorySheet(() => {
      paintCreateContainer();
    });
    $('kcCreateForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = ($('kcName')?.value || '').trim();
      const categoryId = categoryPicker?.getValue?.() || $('kcCategory')?.value || null;
      const barcode = ($('kcBarcode')?.value || '').trim() || null;
      const queueLabel = !!$('kcQueueLabel')?.checked;
      const err = $('kcFormErr');
      if (!name) {
        if (err) { err.hidden = false; err.textContent = 'Name is required.'; }
        return;
      }
      const btn = e.submitter || $('kcCreateForm')?.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const saved = await DB.products.create(kitItemCreatePayload({
          name,
          categoryId,
          barcode,
          isContainer: true,
        }));
        const cat = categories.find((c) => c.id === categoryId) || null;
        const full = { ...saved, category: cat, is_container: true };
        products.push(full);
        if (queueLabel) {
          await queueLabelForProduct(full, { quiet: true });
        }
        try {
          await applyDestDelta(full, 1);
        } catch { /* best-effort */ }
        await openContainer(full, { resetStack: true });
        if (queueLabel) {
          feedback = { msg: 'Label queued for print', kind: 'ok' };
          paintStatus();
        }
      } catch (ex) {
        if (err) { err.hidden = false; err.textContent = ex.message || 'Create failed'; }
        if (btn) btn.disabled = false;
      }
    };
  }

  function categorySheetHtml() {
    return `
      <div class="kc-sheet" id="kcCatSheet">
        <div class="kc-sheet-card">
          <h2 class="kc-sheet-title">New category</h2>
          <label class="kc-field">
            <span>Name</span>
            <input id="kcCatName" type="text" placeholder="e.g. Power" autocomplete="off">
          </label>
          <p class="kc-err" id="kcCatErr" hidden></p>
          <div class="kc-sheet-actions">
            <button type="button" class="kc-btn" id="kcCatCancel">Cancel</button>
            <button type="button" class="kc-btn kc-btn--primary" id="kcCatSave">Save</button>
          </div>
        </div>
      </div>`;
  }

  function wireCategorySheet(afterSave) {
    if (!showCategorySheet) return;
    const nameEl = $('kcCatName');
    if (nameEl) {
      nameEl.value = newCategoryName;
      nameEl.focus();
    }
    $('kcCatCancel').onclick = () => {
      showCategorySheet = false;
      paint();
    };
    $('kcCatSave').onclick = async () => {
      const name = ($('kcCatName')?.value || '').trim();
      const err = $('kcCatErr');
      if (!name) {
        if (err) { err.hidden = false; err.textContent = 'Name is required.'; }
        return;
      }
      if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        if (err) { err.hidden = false; err.textContent = 'That category already exists.'; }
        return;
      }
      try {
        const saved = await DB.categories.create(
          kitCategoryCreatePayload(name, categories.length),
        );
        categories.push(saved);
        categories.sort((a, b) =>
          (a.sort_order - b.sort_order) || String(a.name || '').localeCompare(String(b.name || '')));
        createDraft.categoryId = saved.id;
        showCategorySheet = false;
        afterSave?.();
      } catch (ex) {
        if (err) { err.hidden = false; err.textContent = ex.message || 'Save failed'; }
      }
    };
  }

  function paintCount() {
    const exclude = new Set([container.id, ...containerStack]);
    const q = searchQuery.trim();
    const hits = q
      ? filterKitProducts(products, searchQuery, { excludeIds: exclude, limit: 8 })
      : [];
    const totalQty = contents.reduce((s, c) => s + (Number(c.qty) || 0), 0);
    const parentId = containerStack.length ? containerStack[containerStack.length - 1] : null;
    const parent = parentId ? products.find((p) => p.id === parentId) : null;
    const backLabel = 'Back';

    function suggestActionsHtml(query) {
      return `
        <button type="button" class="kc-btn kc-btn--ghost kc-btn--block" id="kcCreateItem">
          ${query ? `Create item “${escapeHtml(query)}”` : 'Create new item'}
        </button>`;
    }

    function suggestHtml(query, list) {
      if (!query) {
        return `
          <p class="kc-empty">Type to search the kit library, or scan a barcode</p>
          ${suggestActionsHtml('')}`;
      }
      return `
        ${list.length ? list.map((p) => `
          <button type="button" class="kc-suggest-row" data-add="${escapeHtml(p.id)}">
            <span>
              <strong>${escapeHtml(p.name || 'Item')}</strong>
              <em>${escapeHtml(p.is_container ? 'Container' : (p.category?.name || ''))}</em>
            </span>
            <span class="kc-suggest-plus">+1</span>
          </button>`).join('') : `<p class="kc-empty">No match for “${escapeHtml(query)}”</p>`}
        ${suggestActionsHtml(query)}`;
    }

    app.innerHTML = `
      <header class="kc-top kc-top--row">
        <button type="button" class="kc-back" id="kcBack">${escapeHtml(backLabel)}</button>
        <div class="kc-top-grow">
          <div class="kc-brand">${parent ? 'Inside container' : escapeHtml(isEventDest() ? 'Kit' : 'Warehouse')}</div>
          <h1 class="kc-title kc-title--sm">${escapeHtml(container.name || 'Container')}</h1>
          <p class="kc-meta">${contents.length} item${contents.length === 1 ? '' : 's'} · ${escapeHtml(String(totalQty))} units · ${escapeHtml(destTitle())}</p>
        </div>
      </header>

      <div class="kc-add-panel">
        <div class="kc-search-row">
          <input class="kc-search" id="kcSearch" type="search" placeholder="Search kit to add…"
            value="${escapeHtml(searchQuery)}" autocomplete="off" enterkeyhint="search">
          <button type="button" class="kc-btn kc-btn--icon" id="kcScanItem" title="Scan item">Scan</button>
        </div>
        <button type="button" class="kc-nested-btn" id="kcCreateNested">
          <strong>${q ? `Create nested box “${escapeHtml(q)}”` : 'Create a nested box'}</strong>
          <em>e.g. kit box, bale arm crate, pallet</em>
        </button>
        <div class="kc-feedback" id="kcFeedback"> </div>
        <div class="kc-suggest" id="kcSuggest">
          ${suggestHtml(q, hits)}
        </div>
      </div>

      <section class="kc-section kc-section--grow">
        <h2 class="kc-section-title">Inside this container</h2>
        <div class="kc-list" id="kcContents">
          ${contents.length ? contents.map((c) => {
    const child = c.child || products.find((p) => p.id === c.child_product_id) || null;
    const name = child?.name || 'Item';
    const isNested = !!child?.is_container;
    const cat = isNested ? 'Container — tap to open' : (child?.category?.name || '');
    const queued = queuedProductIds.has(c.child_product_id);
    return `
              <div class="kc-content-row${isNested ? ' is-container' : ''}" data-child="${escapeHtml(c.child_product_id)}">
                <button type="button" class="kc-content-main" data-open-nested="${isNested ? escapeHtml(c.child_product_id) : ''}"
                  ${isNested ? '' : 'disabled'}>
                  <strong>${escapeHtml(name)}</strong>
                  ${cat ? `<em>${escapeHtml(cat)}</em>` : ''}
                </button>
                <button type="button" class="kc-label-btn${queued ? ' is-queued' : ''}" data-queue-label
                  title="${queued ? 'Already in print queue' : 'Add label to print queue'}">
                  ${queued ? 'Queued' : 'Label'}
                </button>
                <div class="kc-stepper">
                  <button type="button" class="kc-step" data-delta="-1" aria-label="Decrease">−</button>
                  <input type="text" inputmode="decimal" class="kc-qty" value="${escapeHtml(String(c.qty))}" aria-label="Qty">
                  <button type="button" class="kc-step" data-delta="1" aria-label="Increase">+</button>
                </div>
                <button type="button" class="kc-remove" data-remove title="Remove">×</button>
              </div>`;
  }).join('') : `<p class="kc-empty">Nothing counted yet — add an item or create a container inside.</p>`}
        </div>
      </section>

      <div class="kc-complete-bar">
        <button type="button" class="kc-btn kc-btn--primary kc-btn--block" id="kcComplete">
          ${parent ? 'Complete · back to parent' : 'Complete container'}
        </button>
      </div>

      ${showCreateSheet ? createItemSheetHtml() : ''}
      ${showCategorySheet ? categorySheetHtml() : ''}
    `;
    paintStatus();

    $('kcBack').onclick = () => {
      goBackFromCount();
    };

    $('kcComplete').onclick = async () => {
      const btn = $('kcComplete');
      if (btn) btn.disabled = true;
      const name = container?.name || 'container';
      const doneMessage = parent
        ? `Completed ${name}`
        : `Completed ${name} · ${contents.length} item${contents.length === 1 ? '' : 's'}`;
      try {
        // Flush any qty field still focused
        app.querySelectorAll('.kc-content-row').forEach((row) => {
          const childId = row.dataset.child;
          const qtyInput = row.querySelector('.kc-qty');
          if (!childId || !qtyInput) return;
          const child = products.find((p) => p.id === childId)
            || contents.find((c) => c.child_product_id === childId)?.child;
          contents = setContentsQty(contents, childId, parseContentsQty(qtyInput.value), child);
        });
        await persistContents();
        await goBackFromCount({ doneMessage });
      } catch (err) {
        feedback = { msg: err.message || 'Could not complete', kind: 'err' };
        paintStatus();
        if (btn) btn.disabled = false;
      }
    };

    function wireSuggestActions(root) {
      root?.querySelectorAll('[data-add]').forEach((btn) => {
        btn.onclick = () => {
          const p = products.find((x) => x.id === btn.dataset.add);
          if (!p) return;
          searchQuery = '';
          addOrBumpProduct(p, 1);
        };
      });
      root?.querySelector('#kcCreateItem')?.addEventListener('click', () => {
        openCreateSheet({ asContainer: false });
      });
    }

    $('kcCreateNested').onclick = () => {
      openCreateSheet({ asContainer: true });
    };

    const search = $('kcSearch');
    if (focusSearchNext) {
      focusSearchNext = false;
      // Defer so iOS doesn't keep the keyboard up from a prior tap target.
      requestAnimationFrame(() => search?.focus());
    }
    let searchTimer = 0;
    search?.addEventListener('input', () => {
      searchQuery = search.value || '';
      const nestedBtn = $('kcCreateNested');
      if (nestedBtn) {
        const nextQ = searchQuery.trim();
        nestedBtn.innerHTML = `
          <strong>${nextQ ? `Create nested box “${escapeHtml(nextQ)}”` : 'Create a nested box'}</strong>
          <em>e.g. kit box, bale arm crate, pallet</em>`;
      }
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        const box = $('kcSuggest');
        if (!box) return;
        const nextQ = searchQuery.trim();
        const nextHits = nextQ
          ? filterKitProducts(products, searchQuery, { excludeIds: exclude, limit: 8 })
          : [];
        box.innerHTML = suggestHtml(nextQ, nextHits);
        wireSuggestActions(box);
      }, 80);
    });

    $('kcScanItem').onclick = () => {
      showCreateSheet = false;
      showCategorySheet = false;
      screen = 'scan-item';
      feedback = { msg: '', kind: '' };
      paint();
      startCameraUi();
    };

    wireSuggestActions($('kcSuggest'));

    app.querySelectorAll('.kc-content-row').forEach((row) => {
      const childId = row.dataset.child;
      row.querySelector('[data-open-nested]')?.addEventListener('click', () => {
        const nestedId = row.querySelector('[data-open-nested]')?.dataset.openNested;
        if (!nestedId) return;
        const nested = products.find((p) => p.id === nestedId)
          || contents.find((c) => c.child_product_id === nestedId)?.child;
        if (!nested) return;
        openContainer(nested, { ensureContainer: true, pushParent: container });
      });
      row.querySelector('[data-queue-label]')?.addEventListener('click', async () => {
        const child = products.find((p) => p.id === childId)
          || contents.find((c) => c.child_product_id === childId)?.child;
        if (!child) return;
        const ok = await queueLabelForProduct(child);
        if (ok) paint();
      });
      row.querySelectorAll('[data-delta]').forEach((btn) => {
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Keep focus off inputs so the mobile keyboard stays closed.
          try { btn.blur(); } catch { /* ignore */ }
          const delta = Number(btn.dataset.delta) || 0;
          const child = products.find((p) => p.id === childId) || contents.find((c) => c.child_product_id === childId)?.child;
          const before = Number(contents.find((c) => c.child_product_id === childId)?.qty) || 0;
          contents = bumpContentsLine(contents, childId, delta, child);
          const after = Number(contents.find((c) => c.child_product_id === childId)?.qty) || 0;
          const applied = after - before;
          const qtyEl = row.querySelector('.kc-qty');
          const next = contents.find((c) => c.child_product_id === childId);
          if (!next) {
            paint();
            await persistContents();
            if (applied && child) {
              try { await applyDestDelta(child, applied); } catch { /* ignore */ }
            }
            return;
          }
          if (qtyEl) qtyEl.value = String(next.qty);
          const meta = app.querySelector('.kc-meta');
          if (meta) {
            const totalQty = contents.reduce((s, c) => s + (Number(c.qty) || 0), 0);
            meta.textContent = `${contents.length} item${contents.length === 1 ? '' : 's'} · ${totalQty} units`;
          }
          await persistContents();
          if (applied && child) {
            try { await applyDestDelta(child, applied); } catch { /* ignore */ }
          }
        };
      });
      const qtyInput = row.querySelector('.kc-qty');
      qtyInput?.addEventListener('change', async () => {
        const child = products.find((p) => p.id === childId) || contents.find((c) => c.child_product_id === childId)?.child;
        const before = Number(contents.find((c) => c.child_product_id === childId)?.qty) || 0;
        contents = setContentsQty(contents, childId, parseContentsQty(qtyInput.value), child);
        const after = Number(contents.find((c) => c.child_product_id === childId)?.qty) || 0;
        paint();
        await persistContents();
        if (child && after !== before) {
          try { await applyDestDelta(child, after - before); } catch { /* ignore */ }
        }
      });
      row.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const child = products.find((p) => p.id === childId) || contents.find((c) => c.child_product_id === childId)?.child;
        const before = Number(contents.find((c) => c.child_product_id === childId)?.qty) || 0;
        contents = removeContentsLine(contents, childId);
        paint();
        await persistContents();
        if (child && before) {
          try { await applyDestDelta(child, -before); } catch { /* ignore */ }
        }
      });
    });

    if (showCreateSheet) wireCreateItemSheet();
    wireCategorySheet(() => {
      paint();
    });
  }

  function createItemSheetHtml() {
    const asContainer = !!createDraft.asContainer && !!container;
    const looseMode = !container && hasStockDest();
    return `
      <div class="kc-sheet" id="kcItemSheet">
        <div class="kc-sheet-card">
          <h2 class="kc-sheet-title">${asContainer ? 'New nested box' : 'New kit item'}</h2>
          <p class="kc-sheet-hint">${asContainer
    ? `Add a kit box, bale arm crate, pallet, etc. inside “${escapeHtml(container?.name || 'this one')}”, then open it to count contents.`
    : looseMode
      ? `Quick add loose / bulky item to ${escapeHtml(destTitle())}.`
      : `Quick add into ${escapeHtml(destTitle())}.`}</p>
          <label class="kc-field">
            <span>Name</span>
            <input id="kcItemName" type="text" required placeholder="${asContainer ? 'e.g. Flight case 3' : 'Item name'}" autocomplete="off">
          </label>
          <label class="kc-field">
            <span>Category</span>
            <div class="kc-field-row">
              <div id="kcItemCategoryMount" class="kc-search-select-mount"></div>
              <button type="button" class="kc-btn kc-btn--compact" id="kcItemNewCat">+ New</button>
            </div>
          </label>
          <div class="kc-field-grid">
            <label class="kc-field">
              <span>Qty</span>
              <input id="kcItemQty" type="text" inputmode="decimal" value="1">
            </label>
            <label class="kc-field">
              <span>Barcode</span>
              <input id="kcItemBarcode" type="text" placeholder="Optional" autocomplete="off">
            </label>
          </div>
          <label class="kc-check">
            <input type="checkbox" id="kcItemQueueLabel"${createDraft.queueLabel !== false ? ' checked' : ''}>
            <span>Add label to print queue <em>(print from Kit library on desktop)</em></span>
          </label>
          <p class="kc-err" id="kcItemErr" hidden></p>
          <div class="kc-sheet-actions">
            <button type="button" class="kc-btn" id="kcItemCancel">Cancel</button>
            <button type="button" class="kc-btn kc-btn--primary" id="kcItemSave">
              ${asContainer ? 'Create &amp; open' : looseMode ? 'Add to count' : 'Add to container'}
            </button>
          </div>
        </div>
      </div>`;
  }

  function wireCreateItemSheet() {
    const nameEl = $('kcItemName');
    const qtyEl = $('kcItemQty');
    const bcEl = $('kcItemBarcode');
    const asContainer = !!createDraft.asContainer && !!container;
    if (nameEl) nameEl.value = createDraft.name;
    if (qtyEl) qtyEl.value = createDraft.qty || '1';
    if (bcEl) bcEl.value = createDraft.barcode || '';
    mountCategorySelect($('kcItemCategoryMount'), {
      hiddenId: 'kcItemCategory',
      inputId: 'kcItemCategoryInput',
      value: createDraft.categoryId || '',
    });
    nameEl?.focus();

    $('kcItemCancel').onclick = () => {
      showCreateSheet = false;
      paint();
    };
    $('kcItemNewCat').onclick = () => {
      createDraft.name = nameEl?.value || '';
      createDraft.categoryId = categoryPicker?.getValue?.() || $('kcItemCategory')?.value || '';
      createDraft.barcode = bcEl?.value || '';
      createDraft.qty = qtyEl?.value || '1';
      createDraft.queueLabel = !!$('kcItemQueueLabel')?.checked;
      newCategoryName = '';
      showCategorySheet = true;
      paint();
    };
    $('kcItemSave').onclick = async () => {
      const name = (nameEl?.value || '').trim();
      const categoryId = categoryPicker?.getValue?.() || $('kcItemCategory')?.value || null;
      const barcode = (bcEl?.value || '').trim() || null;
      const qty = parseContentsQty(qtyEl?.value);
      const queueLabel = !!$('kcItemQueueLabel')?.checked;
      const err = $('kcItemErr');
      if (!name) {
        if (err) { err.hidden = false; err.textContent = 'Name is required.'; }
        return;
      }
      const btn = $('kcItemSave');
      if (btn) btn.disabled = true;
      try {
        const parent = container;
        const saved = await DB.products.create(kitItemCreatePayload({
          name,
          categoryId,
          barcode,
          isContainer: asContainer,
        }));
        const cat = categories.find((c) => c.id === categoryId) || null;
        const full = { ...saved, category: cat, is_container: asContainer };
        products.push(full);
        showCreateSheet = false;
        searchQuery = '';
        createDraft = {
          name: '',
          categoryId: categoryId || '',
          barcode: '',
          qty: '1',
          asContainer: false,
          queueLabel: true,
        };
        beep();
        if (queueLabel) {
          await queueLabelForProduct(full, { quiet: true });
        }
        if (parent) {
          contents = bumpContentsLine(contents, full.id, qty, full);
          await persistContents();
          try {
            await applyDestDelta(full, qty);
          } catch { /* container saved; dest best-effort */ }
          if (asContainer) {
            feedback = {
              msg: queueLabel ? `Opened ${full.name} · label queued` : `Opened ${full.name}`,
              kind: 'ok',
            };
            await openContainer(full, { pushParent: parent });
            return;
          }
          feedback = {
            msg: queueLabel ? `Added ${full.name} · label queued` : `Added ${full.name}`,
            kind: 'ok',
          };
          paint();
          return;
        }
        if (hasStockDest()) {
          await bumpStockProduct(full, qty);
          feedback = {
            msg: queueLabel ? `Added ${full.name} · label queued` : `Added ${full.name}`,
            kind: 'ok',
          };
          paint();
          return;
        }
        feedback = { msg: `Created ${full.name}`, kind: 'ok' };
        paint();
      } catch (ex) {
        if (err) { err.hidden = false; err.textContent = ex.message || 'Create failed'; }
        if (btn) btn.disabled = false;
      }
    };
  }

  function paint() {
    syncDeepMode();
    if (errMsg) {
      app.innerHTML = `<div class="kc-fatal">${escapeHtml(errMsg)}</div>`;
      return;
    }
    if (screen === 'dest') return paintDest();
    if (screen === 'pick-event') return paintPickEvent();
    if (screen === 'pick-warehouse') return paintPickWarehouse();
    if (screen === 'home') return paintHome();
    if (screen === 'stock-count') return paintStockCount();
    if (screen === 'scan-container') {
      paintScanShell({
        title: 'Scan box / pallet',
        hint: 'Point at a box, pallet box, or container label. Unknown codes can create a new one.',
        backLabel: 'Back',
        backScreen: 'home',
      });
      return;
    }
    if (screen === 'scan-item') {
      paintScanShell({
        title: 'Scan item',
        hint: `Adding into ${container?.name || 'loose / bulky'} (${destTitle()}). Unknown → create new.`,
        backLabel: 'Back',
        backScreen: container ? 'count' : 'stock-count',
      });
      return;
    }
    if (screen === 'create-container') return paintCreateContainer();
    if (screen === 'count') return paintCount();
  }

  // Boot
  async function runHomeAction(action) {
    if (!destination) {
      if (hasPreferredLocation()) {
        try {
          await enterPreferredLocationHome();
        } catch {
          return false;
        }
      } else {
        screen = 'dest';
        paint();
        return false;
      }
    }

    if (action === 'scan') {
      screen = 'scan-container';
      feedback = { msg: '', kind: '' };
      paint();
      startCameraUi();
      return true;
    }
    if (action === 'create') {
      createDraft = {
        name: '', categoryId: '', barcode: '', qty: '1', asContainer: false, queueLabel: true,
      };
      screen = 'create-container';
      paint();
      $('kcName')?.focus();
      return true;
    }
    if (action === 'loose') {
      try {
        await openLooseCount();
        return true;
      } catch (err) {
        feedback = { msg: err.message || 'Could not open', kind: 'err' };
        paint();
        return false;
      }
    }
    return false;
  }

  function api() {
    return {
      /**
       * Main-app event is the source of truth. Always reload that event's pack list
       * (Need / Packed) when the preferred id changes — including mid-count.
       * @returns {Promise<void>}
       */
      setPreferredEvent(id, name = '') {
        preferredEventId = String(id || '').trim();
        preferredEventName = String(name || '').trim();
        if (preferredEventId) {
          preferredWarehouseId = '';
          preferredWarehouseName = '';
        }
        if (!preferredEventId) return Promise.resolve();

        const alreadyBound = isEventDest()
          && destination.eventId === preferredEventId
          && boundEventId === preferredEventId;
        if (alreadyBound) {
          destination.eventName = preferredEventName || destination.eventName || 'Event';
          storeDestination(destination);
          if (screen === 'home') paint();
          return Promise.resolve();
        }

        return enterPreferredEventHome().then(() => {}).catch((err) => {
          feedback = { msg: err?.message || 'Could not load event kit', kind: 'err' };
          paint();
        });
      },
      /**
       * @returns {Promise<void>}
       */
      setPreferredWarehouse(id, name = '') {
        preferredWarehouseId = String(id || '').trim();
        preferredWarehouseName = String(name || '').trim();
        if (preferredWarehouseId) {
          preferredEventId = '';
          preferredEventName = '';
        }
        if (!preferredWarehouseId) return Promise.resolve();

        const alreadyBound = isWarehouseDest()
          && destination.warehouseId === preferredWarehouseId
          && boundWarehouseId === preferredWarehouseId;
        if (alreadyBound) {
          destination.warehouseName = preferredWarehouseName || destination.warehouseName || 'Warehouse';
          storeDestination(destination);
          if (screen === 'home') paint();
          return Promise.resolve();
        }

        return enterPreferredWarehouseHome().then(() => {}).catch((err) => {
          feedback = { msg: err?.message || 'Could not load warehouse kit', kind: 'err' };
          paint();
        });
      },
      runHomeAction,
    };
  }

  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (screen === 'scan-container' || screen === 'scan-item') {
      $('kcVideo')?.play?.().catch(() => {});
    }
  });

  app.innerHTML = `<div class="kc-loading">Loading kit library…</div>`;
  try {
    await refreshLibrary();
    await refreshQueuedIds();
  } catch (err) {
    errMsg = err.message || 'Could not load kit library.';
    paint();
    return api();
  }

  const resumeId = containerIdFromUrl();
  const stored = loadStoredDestination();
  if (resumeId && stored && (stored.type === DEST_EVENT || stored.type === DEST_WAREHOUSE)) {
    destination = stored;
    try {
      if (isEventDest()) {
        const data = await loadEventKit(destination.eventId);
        eventItems = data.items || [];
        eventBalances = balancesByProduct(data.movements || []);
        boundEventId = destination.eventId;
        boundWarehouseId = '';
      } else if (isWarehouseDest()) {
        stockMap = await loadWarehouseKitStockMap(DB, destination.warehouseId);
        boundWarehouseId = destination.warehouseId;
        boundEventId = '';
      }
      const existing = products.find((p) => p.id === resumeId);
      if (existing) {
        await openContainer(existing, { ensureContainer: true, resetStack: true });
        return api();
      }
    } catch { /* fall through */ }
  }

  // Main-app location wins — skip warehouse / choose-event entirely.
  if (hasPreferredLocation()) {
    try {
      await enterPreferredLocationHome();
      return api();
    } catch { /* fall through */ }
  }

  if (stored?.type === DEST_EVENT && stored.eventId) {
    destination = stored;
    try {
      await enterContainerHome();
      return api();
    } catch { /* fall through */ }
  }
  if (stored?.type === DEST_WAREHOUSE && stored.warehouseId) {
    destination = stored;
    try {
      await enterContainerHome();
      return api();
    } catch { /* fall through */ }
  }

  screen = 'dest';
  paint();
  return api();
}
