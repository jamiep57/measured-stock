/**
 * Shared Google Sheets–style cell caret collaboration (presence + outline).
 * Panel-specific data sync (postgres_changes, live draft values) stays outside.
 *
 * Presence is reserved for slow “who’s here” state. Cell carets use Broadcast —
 * Supabase allows only ~5 presence track/untrack calls per client per 30s, and
 * exceeding that shuts the whole channel down (Presence + Broadcast + postgres).
 */

import { getClientId, getDisplayName } from './session-identity.js';
import { getRealtimeClient } from './realtime.js';

/** @type {((focusKey: string | null) => void) | null} */
let appFocusBridge = null;

/** Let app-wide sidebar presence mirror grid focus without a circular import. */
export function registerAppFocusBridge(fn) {
  appFocusBridge = typeof fn === 'function' ? fn : null;
}

export const PEER_COLORS = [
  '#2563eb', // blue
  '#db2777', // pink
  '#059669', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#4f46e5', // indigo
];

/**
 * Optional slow keep-alive only. Must stay well under Supabase’s
 * 5 presence calls / 30s / connection (shared across all channels).
 * Prefer Broadcast for anything that changes on focus/typing.
 */
export const PRESENCE_HEARTBEAT_MS = 25_000;
/** Re-announce local caret via Broadcast so peers recover from missed messages. */
export const CARET_ANNOUNCE_MS = 2_000;
/** Drop a peer caret if we haven't heard from them recently. */
export const PEER_CARET_STALE_MS = 8_000;

export const COLLAB_CELL_CLASS = 'collab-cell--peer';
export const COLLAB_TAG_CLASS = 'collab-peer-tag';
export const COLLAB_COLOR_VAR = '--collab-peer-color';

/** Stable color per client for Google Sheets–style caret. */
export function peerColor(clientId) {
  const s = String(clientId || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

/** @param {...unknown} parts */
export function cellFocusKey(...parts) {
  const cleaned = parts.map((p) => String(p ?? '').trim()).filter(Boolean);
  if (cleaned.length < 2) return null;
  return cleaned.join('::');
}

/**
 * Flatten Supabase presenceState() into peer metas.
 * Uses the presence key as clientId when the payload omits it.
 * @param {Record<string, object[]>} state
 */
export function flattenPresenceState(state) {
  const peers = [];
  for (const [key, metas] of Object.entries(state || {})) {
    for (const meta of metas || []) {
      if (!meta || typeof meta !== 'object') continue;
      peers.push({
        ...meta,
        clientId: meta.clientId || key,
        name: (meta.name || '').trim(),
      });
    }
  }
  return peers;
}

/**
 * Format presence peers for a live bar (excludes self).
 */
export function formatCollabPresence(peers, selfClientId) {
  const others = (peers || []).filter((p) => p && p.clientId && p.clientId !== selfClientId);
  const names = [...new Set(others.map((p) => (p.name || '').trim()).filter(Boolean))];
  if (!names.length) {
    return { text: 'Just you here', names: [], others };
  }
  if (names.length === 1) {
    return { text: `${names[0]} is also here`, names, others };
  }
  if (names.length === 2) {
    return { text: `${names[0]} and ${names[1]} are also here`, names, others };
  }
  return {
    text: `${names[0]}, ${names[1]} +${names.length - 2} also here`,
    names,
    others,
  };
}

/** @deprecated use formatCollabPresence */
export const formatClosingPresence = formatCollabPresence;

/**
 * Resolve a peer's current focus key from presence meta.
 * Supports opaque `focusKey` or Closing-style `focusPid` + `focusField`.
 */
export function peerFocusKey(peer) {
  if (!peer) return null;
  const direct = String(peer.focusKey || '').trim();
  if (direct) return direct;
  return cellFocusKey(peer.focusPid, peer.focusField);
}

/**
 * Map cellKey → first peer currently focused on that cell.
 * @returns {Record<string, { name: string, color: string, clientId: string, cellKey: string }>}
 */
export function cellFocusOwners(peers, selfClientId) {
  /** @type {Record<string, { name: string, color: string, clientId: string, cellKey: string }>} */
  const map = {};
  for (const p of peers || []) {
    if (!p || p.clientId === selfClientId) continue;
    const name = (p.name || '').trim();
    const key = peerFocusKey(p);
    if (!key || !name || map[key]) continue;
    map[key] = {
      name,
      color: peerColor(p.clientId),
      clientId: p.clientId,
      cellKey: key,
    };
  }
  return map;
}

/**
 * One caret per peer. Broadcast wins over presence so moving cells doesn't leave
 * a stale outline on the previous cell.
 * @param {object[]} presencePeers
 * @param {Record<string, { name?: string, color?: string, clientId?: string, cellKey?: string, at?: number } | null>} focusBroadcast
 * @param {string} selfClientId
 * @param {{ now?: number, staleMs?: number }} [opts]
 * @returns {Record<string, { name: string, color: string, clientId: string, cellKey: string }>}
 */
export function mergePeerCarets(presencePeers, focusBroadcast, selfClientId, opts = {}) {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? PEER_CARET_STALE_MS;
  /** @type {Record<string, { name: string, color: string, clientId: string, cellKey: string, at?: number }>} */
  const byClient = {};

  for (const p of presencePeers || []) {
    if (!p || !p.clientId || p.clientId === selfClientId) continue;
    // Once we've heard a Broadcast from this peer, Presence focus is ignored
    // (Presence lags and would repaint the old cell after they move).
    if (Object.prototype.hasOwnProperty.call(focusBroadcast || {}, p.clientId)) continue;
    const name = (p.name || '').trim();
    const key = peerFocusKey(p);
    if (!key || !name) continue;
    byClient[p.clientId] = {
      name,
      color: peerColor(p.clientId),
      clientId: p.clientId,
      cellKey: key,
      at: Number(p.at) || 0,
    };
  }

  for (const [clientId, info] of Object.entries(focusBroadcast || {})) {
    if (!clientId || clientId === selfClientId) continue;
    // Explicit clear from peer (empty cellKey broadcast).
    if (!info || !info.cellKey || !info.name) {
      delete byClient[clientId];
      continue;
    }
    const at = Number(info.at) || 0;
    if (at && now - at > staleMs) {
      delete byClient[clientId];
      continue;
    }
    byClient[clientId] = {
      name: info.name,
      color: info.color || peerColor(clientId),
      clientId,
      cellKey: info.cellKey,
      at,
    };
  }

  /** @type {Record<string, { name: string, color: string, clientId: string, cellKey: string }>} */
  const byCell = {};
  Object.values(byClient).forEach((info) => {
    if (!byCell[info.cellKey]) byCell[info.cellKey] = info;
  });
  return byCell;
}

/**
 * Clear + paint peer caret markers under root.
 * @param {ParentNode} root
 * @param {Record<string, { name: string, color?: string, cellKey: string }>} peerCells
 * @param {(cellKey: string, root: ParentNode) => Element | null | undefined} findCellEl
 */
export function paintCollabMarkers(root, peerCells, findCellEl) {
  if (!root) return;
  root.querySelectorAll(`.${COLLAB_CELL_CLASS}`).forEach((cell) => {
    cell.classList.remove(COLLAB_CELL_CLASS);
    cell.style.removeProperty(COLLAB_COLOR_VAR);
    cell.querySelector(`.${COLLAB_TAG_CLASS}`)?.remove();
  });
  Object.values(peerCells || {}).forEach((info) => {
    if (!info?.cellKey || !info.name) return;
    const cell = findCellEl(info.cellKey, root);
    if (!cell) return;
    cell.classList.add(COLLAB_CELL_CLASS);
    cell.style.setProperty(COLLAB_COLOR_VAR, info.color || '#2563eb');
    const tag = document.createElement('span');
    tag.className = COLLAB_TAG_CLASS;
    tag.textContent = info.name;
    cell.appendChild(tag);
  });
}

/**
 * @typedef {object} GridCollabSessionOpts
 * @property {string} channelName
 * @property {ParentNode} root
 * @property {string} inputSelector
 * @property {(input: Element) => string | null} cellKeyFromInput
 * @property {(cellKey: string, root: ParentNode) => Element | null | undefined} findCellEl
 * @property {(channel: import('@supabase/supabase-js').RealtimeChannel) => void} [onChannel]
 * @property {(payload: object) => void} [onRemoteFocus]
 * @property {(focusKey: string | null) => void} [onLocalFocusChange]
 * @property {() => Record<string, unknown>} [extraBroadcastPayload]
 */

/**
 * Create a caret-collaboration session for one spreadsheet-like grid.
 * @param {GridCollabSessionOpts} opts
 */
export function createGridCollabSession(opts) {
  const {
    channelName,
    root,
    inputSelector,
    cellKeyFromInput,
    findCellEl,
    onChannel = null,
    onRemoteFocus = null,
    onLocalFocusChange = null,
    extraBroadcastPayload = null,
  } = opts;

  let channel = null;
  let liveReady = false;
  let destroyed = false;
  let focusKey = null;
  let reconnectTimer = null;
  let caretTimer = null;
  let reconnectAttempt = 0;
  /** @type {object[]} */
  let presencePeers = [];
  /** @type {Record<string, object | null>} */
  let focusBroadcast = {};
  /** @type {Record<string, object>} */
  let peerCells = {};

  function rebuildPeerCells() {
    // Drop stale broadcast entries so Presence isn't permanently suppressed
    // after a peer goes idle, and so outlines disappear when they leave a cell.
    const now = Date.now();
    Object.entries(focusBroadcast).forEach(([clientId, info]) => {
      if (!info) return;
      const at = Number(info.at) || 0;
      if (at && now - at > PEER_CARET_STALE_MS) delete focusBroadcast[clientId];
    });
    peerCells = mergePeerCarets(presencePeers, focusBroadcast, getClientId(), { now });
    paintCollabMarkers(root, peerCells, findCellEl);
  }

  function updatePresenceUi(peers) {
    presencePeers = peers || [];
    rebuildPeerCells();
  }

  function focusPayload(extra = {}) {
    const name = getDisplayName();
    const clientId = getClientId();
    const parts = String(focusKey || '').split('::');
    return {
      name: name || 'Someone',
      clientId,
      cellKey: focusKey,
      // Closing-compat fields for older payloads / draft sync
      productId: parts[0] || null,
      field: parts.length > 1 ? parts.slice(1).join('::') : null,
      color: peerColor(clientId),
      at: Date.now(),
      ...(typeof extraBroadcastPayload === 'function' ? extraBroadcastPayload() : null),
      ...extra,
    };
  }

  async function broadcastFocus(extra = {}) {
    if (!channel || !liveReady || destroyed) return;
    try {
      await channel.send({
        type: 'broadcast',
        event: 'cell-focus',
        payload: focusPayload(extra),
      });
    } catch { /* ignore */ }
  }

  /** Presence: who’s on this grid — not cell caret (that’s Broadcast). */
  async function trackPresence(patch = {}) {
    if (!channel || !liveReady || destroyed) return;
    const name = getDisplayName();
    if (!name) return;
    try {
      await channel.track({
        name,
        clientId: getClientId(),
        at: Date.now(),
        ...patch,
      });
    } catch { /* ignore presence blips */ }
  }

  function setLocalFocus(nextKey) {
    focusKey = nextKey || null;
    try { appFocusBridge?.(focusKey); } catch { /* ignore */ }
    onLocalFocusChange?.(focusKey);
  }

  function handleFocusBroadcast(payload) {
    if (destroyed || !payload) return;
    const clientId = payload.clientId;
    if (!clientId || clientId === getClientId()) return;
    const key = String(payload.cellKey || cellFocusKey(payload.productId, payload.field) || '').trim();
    if (!key) {
      // Keep an explicit null so Presence can't revive a cleared caret.
      focusBroadcast[clientId] = null;
    } else {
      focusBroadcast[clientId] = {
        name: (payload.name || '').trim() || 'Someone',
        clientId,
        cellKey: key,
        color: payload.color || peerColor(clientId),
        at: Number(payload.at) || Date.now(),
      };
    }
    onRemoteFocus?.(payload);
    rebuildPeerCells();
  }

  function onFocusIn(e) {
    const input = e.target?.closest?.(inputSelector);
    if (!input || !root.contains(input)) return;
    setLocalFocus(cellKeyFromInput(input));
    // Broadcast only — track() on every cell would trip the presence rate limit
    // and shut down this channel (killing carets + live row sync).
    broadcastFocus();
  }

  function onFocusOut(e) {
    const input = e.target?.closest?.(inputSelector);
    if (!input || !root.contains(input)) return;
    window.setTimeout(() => {
      if (destroyed) return;
      const active = document.activeElement?.closest?.(inputSelector);
      if (active && root.contains(active)) {
        setLocalFocus(cellKeyFromInput(active));
      } else {
        setLocalFocus(null);
      }
      broadcastFocus();
    }, 0);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearCaretTimer() {
    if (caretTimer) {
      clearInterval(caretTimer);
      caretTimer = null;
    }
  }

  function scheduleReconnect() {
    if (destroyed || reconnectTimer) return;
    const delay = Math.min(15_000, 1_000 * (2 ** Math.min(reconnectAttempt, 3)));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (destroyed || channel) return;
      start();
    }, delay);
  }

  function dropExistingChannel(rt) {
    // supabase-js reuses channels by topic; adding presence after subscribe() throws.
    const topic = `realtime:${channelName}`;
    const existing = (rt.getChannels?.() || []).filter((ch) => {
      const t = ch?.topic || '';
      return t === topic || t === channelName || t.endsWith(`:${channelName}`);
    });
    for (const ch of existing) {
      try { rt.removeChannel(ch); } catch { /* ignore */ }
    }
  }

  function start() {
    if (destroyed || channel) return;
    const rt = getRealtimeClient();
    if (!rt) return;

    dropExistingChannel(rt);

    const selfId = getClientId();
    channel = rt.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: selfId, enabled: true },
      },
    });

    onChannel?.(channel);

    channel.on('broadcast', { event: 'cell-focus' }, ({ payload }) => {
      handleFocusBroadcast(payload);
    });

    const refreshPeers = () => {
      const peers = flattenPresenceState(channel.presenceState() || {});
      updatePresenceUi(peers);
    };

    channel.on('presence', { event: 'sync' }, refreshPeers);
    channel.on('presence', { event: 'join' }, () => {
      refreshPeers();
      // New peer won’t have our caret until we re-announce via Broadcast.
      if (focusKey) broadcastFocus();
    });
    channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      if (key) delete focusBroadcast[key];
      for (const meta of leftPresences || []) {
        const id = meta?.clientId;
        if (id) delete focusBroadcast[id];
      }
      refreshPeers();
    });

    channel.subscribe(async (status) => {
      if (destroyed) return;
      if (status === 'SUBSCRIBED') {
        liveReady = true;
        reconnectAttempt = 0;
        await trackPresence();
        await broadcastFocus();
        refreshPeers();
        clearCaretTimer();
        // Broadcast re-announce only — never Presence track on an interval.
        caretTimer = setInterval(() => {
          if (focusKey) broadcastFocus();
          rebuildPeerCells();
        }, CARET_ANNOUNCE_MS);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        liveReady = false;
        clearCaretTimer();
        const ch = channel;
        channel = null;
        if (ch) {
          try { getRealtimeClient()?.removeChannel(ch); } catch { /* ignore */ }
        }
        if (!destroyed) scheduleReconnect();
      }
    });
  }

  async function destroy() {
    destroyed = true;
    liveReady = false;
    clearReconnectTimer();
    clearCaretTimer();
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    const ch = channel;
    channel = null;
    if (!ch) return;
    try {
      await ch.unsubscribe();
    } catch { /* ignore */ }
    try {
      getRealtimeClient()?.removeChannel(ch);
    } catch { /* ignore */ }
  }

  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  start();

  return {
    getFocusKey: () => focusKey,
    isReady: () => liveReady && !destroyed,
    getChannel: () => channel,
    broadcastFocus,
    trackPresence,
    repaint: () => rebuildPeerCells(),
    destroy,
  };
}
