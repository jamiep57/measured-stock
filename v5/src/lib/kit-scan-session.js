/**
 * Kit phone barcode scanner — session helpers + pack / check-in apply logic.
 *
 * Transport: short-lived kit_scan_sessions + kit_scan_events via PostgREST.
 * Desktop polls; phone inserts barcodes from the camera companion page.
 */

import { isOwnSource, normalizeKitSource } from './kit-stock.js';

export const SCAN_MODE_PACK = 'pack';
export const SCAN_MODE_CHECK_IN = 'check_in';
export const SCAN_MODES = [SCAN_MODE_PACK, SCAN_MODE_CHECK_IN];

export const SCAN_MODE_LABELS = {
  [SCAN_MODE_PACK]: 'Pack',
  [SCAN_MODE_CHECK_IN]: 'Check in',
};

/** Session lifetime — matches plan (~4 hours). */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** Desktop poll interval for unconsumed scan events. */
export const POLL_MS = 400;

/** Ignore duplicate same-code bursts on the phone. */
export const PHONE_DEBOUNCE_MS = 1500;

export function normalizeBarcode(raw) {
  return String(raw ?? '').trim();
}

export function normalizeScanMode(mode) {
  return mode === SCAN_MODE_CHECK_IN ? SCAN_MODE_CHECK_IN : SCAN_MODE_PACK;
}

/**
 * Current RMS (and similar) labels often encode a URL, e.g.
 *   http://measured.current-rms.com/stock_levels/755
 * rather than a plain barcode number. Extract lookup candidates.
 *
 * @param {string} raw
 * @returns {string[]} unique candidates, preferred order (raw first, then ids)
 */
export function scanCodeCandidates(raw) {
  const code = normalizeBarcode(raw);
  if (!code) return [];

  /** @type {string[]} */
  const out = [];
  const push = (v) => {
    const s = normalizeBarcode(v);
    if (!s) return;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) return;
    out.push(s);
  };

  push(code);

  const looksLikeUrl = /^(https?:\/\/|\/\/)/i.test(code)
    || /current-rms\.com/i.test(code)
    || /\/(?:stock_levels|products|items)\//i.test(code);

  if (looksLikeUrl) {
    let path = code;
    try {
      const withScheme = /^(https?:)?\/\//i.test(code)
        ? (code.startsWith('//') ? `http:${code}` : code)
        : (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(code) ? `http://${code}` : '');
      if (withScheme) {
        path = new URL(withScheme).pathname + (new URL(withScheme).search || '');
        // Full URL without scheme variants for stored barcodes
        const u = new URL(withScheme);
        push(`${u.host}${u.pathname}`.replace(/\/$/, ''));
        push(`http://${u.host}${u.pathname}`.replace(/\/$/, ''));
        push(`https://${u.host}${u.pathname}`.replace(/\/$/, ''));
      }
    } catch { /* keep path as raw */ }

    const idMatch = path.match(/\/(?:stock_levels|products|items)\/(\d+)\b/i)
      || path.match(/\/(\d+)\/?$/);
    if (idMatch?.[1]) push(idMatch[1]);
  }

  return out;
}

/**
 * Match a scanned code against kit library products.
 * Tries product.barcode and product.sku (Current RMS Id) against
 * the raw scan plus any Current RMS URL id extract.
 *
 * @param {Array<{ id?: string, barcode?: string|null, sku?: string|null }>} products
 * @param {string} barcode
 */
export function findProductByBarcode(products, barcode) {
  const candidates = scanCodeCandidates(barcode).map((c) => c.toLowerCase());
  if (!candidates.length) return null;
  const list = products || [];

  const matchField = (value) => {
    const v = normalizeBarcode(value).toLowerCase();
    return v && candidates.includes(v);
  };

  // 1) Exact barcode field
  for (const p of list) {
    if (matchField(p?.barcode)) return p;
  }
  // 2) Current RMS product Id stored as sku
  for (const p of list) {
    if (matchField(p?.sku)) return p;
  }
  // 3) Stored barcode is itself a Current RMS URL — compare extracted ids
  for (const p of list) {
    const stored = normalizeBarcode(p?.barcode);
    if (!stored) continue;
    const storedIds = scanCodeCandidates(stored)
      .map((c) => c.toLowerCase())
      .filter((c) => /^\d+$/.test(c));
    if (storedIds.some((id) => candidates.includes(id))) return p;
  }
  return null;
}

/**
 * Decide how a pack-mode scan should change the event kit list.
 * Pure — caller persists.
 *
 * @param {{
 *   items: Array<{ id?: string, product_id?: string, qty_planned?: number, qty_packed?: number }>,
 *   product: { id: string, name?: string } | null,
 * }} args
 * @returns {{
 *   action: 'unknown' | 'bump' | 'add',
 *   productId?: string,
 *   itemId?: string,
 *   nextPacked?: number,
 *   nextPlanned?: number,
 *   name?: string,
 * }}
 */
export function planPackScan({ items, product }) {
  if (!product?.id) return { action: 'unknown' };
  const existing = (items || []).find((it) => it.product_id === product.id);
  if (existing) {
    const nextPacked = Math.round(((Number(existing.qty_packed) || 0) + 1) * 10) / 10;
    return {
      action: 'bump',
      productId: product.id,
      itemId: existing.id,
      nextPacked,
      name: product.name || existing.product?.name,
    };
  }
  return {
    action: 'add',
    productId: product.id,
    nextPlanned: 1,
    nextPacked: 1,
    name: product.name,
  };
}

/**
 * @param {Map<string, number>|Record<string, number>|null|undefined} pending
 * @param {string} productId
 * @param {number} [qty]
 * @returns {Map<string, number>}
 */
export function bumpCheckInPending(pending, productId, qty = 1) {
  const next = pending instanceof Map
    ? new Map(pending)
    : new Map(Object.entries(pending || {}));
  if (!productId) return next;
  const add = Math.round((Number(qty) || 0) * 10) / 10;
  if (!(add > 0)) return next;
  const cur = Math.round((Number(next.get(productId)) || 0) * 10) / 10;
  next.set(productId, Math.round((cur + add) * 10) / 10);
  return next;
}

/**
 * Expand pending check-in counts into movement-ready lines grouped by type.
 * Own lines → warehouse_out; hire lines → hire_return.
 *
 * @param {Map<string, number>|Record<string, number>} pending
 * @param {Array<{ product_id?: string, source?: string, product?: { name?: string } }>} items
 */
export function pendingCheckInGroups(pending, items) {
  const map = pending instanceof Map
    ? pending
    : new Map(Object.entries(pending || {}));
  const byPid = new Map((items || []).map((it) => [it.product_id, it]));
  /** @type {{ product_id: string, qty: number, name: string }[]} */
  const warehouseOut = [];
  /** @type {{ product_id: string, qty: number, name: string }[]} */
  const hireReturn = [];
  /** @type {string[]} */
  const missing = [];

  for (const [productId, rawQty] of map.entries()) {
    const qty = Math.round((Number(rawQty) || 0) * 10) / 10;
    if (!(qty > 0)) continue;
    const it = byPid.get(productId);
    if (!it) {
      missing.push(productId);
      continue;
    }
    const line = {
      product_id: productId,
      qty,
      name: it.product?.name || productId,
    };
    if (isOwnSource(it.source)) warehouseOut.push(line);
    else hireReturn.push(line);
  }

  return { warehouseOut, hireReturn, missing };
}

/** Total units in a pending check-in map. */
export function pendingCheckInTotal(pending) {
  const map = pending instanceof Map
    ? pending
    : new Map(Object.entries(pending || {}));
  let total = 0;
  for (const qty of map.values()) total += Number(qty) || 0;
  return Math.round(total * 10) / 10;
}

/**
 * Build the phone companion URL for a session.
 * @param {string} sessionId
 * @param {string} [origin]
 */
export function scanPageUrl(sessionId, origin) {
  const base = String(origin || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');
  return `${base}/v5/scan/?s=${encodeURIComponent(sessionId)}`;
}

/** localStorage key for a manually chosen phone-reachable origin (LAN IP). */
export const PHONE_ORIGIN_KEY = 'v5_scan_phone_origin';

export function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * @param {string} origin
 * @param {string} host  hostname or host:port (no scheme)
 */
export function originWithHost(origin, host) {
  const rawHost = String(host || '').trim();
  if (!rawHost) return String(origin || '').replace(/\/$/, '');
  try {
    const u = new URL(origin || 'http://localhost');
    if (rawHost.includes('://')) {
      return new URL(rawHost).origin;
    }
    // host or host:port
    if (rawHost.includes(':') && !rawHost.startsWith('[')) {
      const idx = rawHost.lastIndexOf(':');
      u.hostname = rawHost.slice(0, idx);
      u.port = rawHost.slice(idx + 1);
    } else {
      u.hostname = rawHost.replace(/^\[|\]$/g, '');
    }
    return u.origin;
  } catch {
    return String(origin || '').replace(/\/$/, '');
  }
}

export function getStoredPhoneOrigin() {
  try {
    const v = localStorage.getItem(PHONE_ORIGIN_KEY);
    return v ? String(v).replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

export function setStoredPhoneOrigin(origin) {
  try {
    const v = String(origin || '').replace(/\/$/, '');
    if (v) localStorage.setItem(PHONE_ORIGIN_KEY, v);
    else localStorage.removeItem(PHONE_ORIGIN_KEY);
  } catch { /* ignore */ }
}

/**
 * Ask the Vite dev server which LAN origins it is listening on.
 * @returns {Promise<string[]>}
 */
export async function fetchDevLanOrigins() {
  if (typeof fetch === 'undefined') return [];
  const paths = ['/v5/__dev-lan', '/__dev-lan'];
  for (const p of paths) {
    try {
      const res = await fetch(p, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      const list = Array.isArray(data?.origins) ? data.origins : [];
      return list.map((o) => String(o).replace(/\/$/, '')).filter(Boolean);
    } catch { /* try next */ }
  }
  return [];
}

/**
 * Best-effort LAN IPv4 via WebRTC (fallback when /__dev-lan is unavailable).
 * @returns {Promise<string|null>}
 */
export function discoverLanIpv4() {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (ip) => {
      if (done) return;
      done = true;
      try { pc.close(); } catch { /* ignore */ }
      resolve(ip || null);
    };
    const timer = setTimeout(() => finish(null), 1500);
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
    } catch {
      clearTimeout(timer);
      resolve(null);
      return;
    }
    pc.createDataChannel('lan');
    pc.onicecandidate = (e) => {
      const cand = e.candidate?.candidate || '';
      const m = cand.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (m && !isLoopbackHost(m[1])) {
        clearTimeout(timer);
        finish(m[1]);
      }
      if (!e.candidate) {
        clearTimeout(timer);
        finish(null);
      }
    };
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timer);
        finish(null);
      });
  });
}

/**
 * Origin the phone should open (LAN-reachable when desktop is on localhost).
 * @param {{ pageOrigin?: string }} [opts]
 * @returns {Promise<{ origin: string, editable: boolean, candidates: string[] }>}
 */
export async function resolvePhoneOrigin(opts = {}) {
  const pageOrigin = String(
    opts.pageOrigin
    || (typeof location !== 'undefined' ? location.origin : ''),
  ).replace(/\/$/, '');

  let pageHost = '';
  let pageProtocol = 'http:';
  try {
    const u = new URL(pageOrigin);
    pageHost = u.hostname;
    pageProtocol = u.protocol;
  } catch { /* ignore */ }

  if (pageOrigin && !isLoopbackHost(pageHost)) {
    return { origin: pageOrigin, editable: false, candidates: [pageOrigin] };
  }

  const stored = getStoredPhoneOrigin();
  const fromDev = await fetchDevLanOrigins();
  const candidates = [];
  const preferHttps = pageProtocol === 'https:';

  const push = (o) => {
    if (!o || candidates.includes(o)) return;
    candidates.push(o);
  };

  // Prefer origins that match the desktop scheme (Brave forces HTTPS).
  for (const o of fromDev) {
    if (preferHttps && o.startsWith('https:')) push(o);
  }
  for (const o of fromDev) push(o);

  if (stored) {
    try {
      const s = new URL(stored);
      if (preferHttps && s.protocol === 'http:') {
        s.protocol = 'https:';
        push(s.origin);
      } else {
        push(stored);
      }
    } catch {
      push(stored);
    }
  }

  if (!candidates.length) {
    const ip = await discoverLanIpv4();
    if (ip) {
      try {
        const u = new URL(pageOrigin || 'http://localhost');
        u.hostname = ip;
        push(u.origin);
      } catch { /* ignore */ }
    }
  }

  // Prefer non-loopback https first when available
  const ranked = [...candidates].sort((a, b) => {
    const score = (o) => {
      let s = 0;
      try {
        const u = new URL(o);
        if (preferHttps && u.protocol === 'https:') s += 2;
        if (!isLoopbackHost(u.hostname)) s += 1;
      } catch { /* ignore */ }
      return s;
    };
    return score(b) - score(a);
  });

  const origin = ranked[0] || stored || pageOrigin;
  return { origin, editable: true, candidates: ranked.length ? ranked : candidates };
}

/**
 * QR image URL (online pairing — phone + desktop already need Supabase).
 * @param {string} text
 * @param {number} [size]
 */
export function qrImageUrl(text, size = 180) {
  const s = Math.max(80, Math.min(400, Number(size) || 180));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(text)}`;
}

/**
 * Create a scan session row.
 * @param {{ insert: Function }} DB
 * @param {{ eventId: string, mode?: string, ttlMs?: number }} opts
 */
export async function createScanSession(DB, { eventId, mode = SCAN_MODE_PACK, ttlMs = SESSION_TTL_MS }) {
  if (!eventId) throw new Error('eventId required');
  const expiresAt = new Date(Date.now() + (Number(ttlMs) || SESSION_TTL_MS)).toISOString();
  const [row] = await DB.insert('kit_scan_sessions', {
    event_id: eventId,
    mode: normalizeScanMode(mode),
    expires_at: expiresAt,
  });
  return row;
}

/**
 * @param {{ update: Function, _: { enc: Function } }} DB
 */
export async function updateScanSessionMode(DB, sessionId, mode) {
  if (!sessionId) throw new Error('sessionId required');
  await DB.update(
    'kit_scan_sessions',
    'id=eq.' + DB._.enc(sessionId),
    { mode: normalizeScanMode(mode) },
  );
}

/**
 * @param {{ select: Function, _: { enc: Function } }} DB
 */
export async function loadScanSession(DB, sessionId) {
  if (!sessionId) return null;
  const rows = await DB.select(
    'kit_scan_sessions',
    '?id=eq.' + DB._.enc(sessionId) + '&select=id,event_id,mode,expires_at,created_at&limit=1',
  );
  return rows?.[0] || null;
}

export function isSessionExpired(session, now = Date.now()) {
  if (!session?.expires_at) return true;
  return new Date(session.expires_at).getTime() <= now;
}

/**
 * Fetch unconsumed events oldest-first.
 * @param {{ select: Function, _: { enc: Function } }} DB
 */
export async function fetchPendingScanEvents(DB, sessionId) {
  if (!sessionId) return [];
  return DB.select(
    'kit_scan_events',
    '?session_id=eq.' + DB._.enc(sessionId) +
    '&consumed_at=is.null&select=id,session_id,barcode,created_at&order=created_at.asc',
  ) || [];
}

/**
 * @param {{ update: Function, _: { enc: Function } }} DB
 */
export async function markScanEventsConsumed(DB, eventIds, consumedAt = new Date().toISOString()) {
  const ids = (eventIds || []).filter(Boolean);
  if (!ids.length) return;
  // PostgREST `in` filter
  const list = ids.map((id) => DB._.enc(id)).join(',');
  await DB.update(
    'kit_scan_events',
    `id=in.(${list})`,
    { consumed_at: consumedAt },
  );
}

/**
 * Phone posts a barcode into the session.
 * @param {{ insert: Function }} DB
 */
export async function postScanEvent(DB, sessionId, barcode) {
  const code = normalizeBarcode(barcode);
  if (!sessionId) throw new Error('sessionId required');
  if (!code) throw new Error('barcode required');
  const [row] = await DB.insert('kit_scan_events', {
    session_id: sessionId,
    barcode: code,
  });
  return row;
}

/**
 * Start a poll loop. Returns a stop function.
 * @param {{ select: Function, update: Function, _: { enc: Function } }} DB
 * @param {string} sessionId
 * @param {(events: Array<{ id: string, barcode: string }>) => void|Promise<void>} onEvents
 * @param {{ intervalMs?: number, onError?: (err: Error) => void }} [opts]
 */
export function startScanPoll(DB, sessionId, onEvents, opts = {}) {
  const intervalMs = opts.intervalMs ?? POLL_MS;
  let stopped = false;
  let timer = null;
  let inFlight = false;

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const pending = await fetchPendingScanEvents(DB, sessionId);
      if (stopped || !pending.length) return;
      for (const ev of pending) {
        if (stopped) return;
        await onEvents([ev]);
        await markScanEventsConsumed(DB, [ev.id]);
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inFlight = false;
    }
  }

  timer = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}

export { normalizeKitSource, isOwnSource };
