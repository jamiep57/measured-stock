/**
 * Shared Google Sheets–style cell caret collaboration (presence + outline).
 * Panel-specific data sync (postgres_changes, live draft values) stays outside.
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

export const PRESENCE_HEARTBEAT_MS = 2500;
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
  let presenceTimer = null;
  /** @type {object[]} */
  let presencePeers = [];
  /** @type {Record<string, object>} */
  let focusBroadcast = {};
  /** @type {Record<string, object>} */
  let peerCells = {};

  function rebuildPeerCells() {
    const fromPresence = cellFocusOwners(presencePeers, getClientId());
    /** @type {Record<string, object>} */
    const merged = { ...fromPresence };
    const selfId = getClientId();
    Object.values(focusBroadcast).forEach((info) => {
      if (!info || info.clientId === selfId) return;
      if (!info.cellKey || !info.name) return;
      merged[info.cellKey] = info;
    });
    peerCells = merged;
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

  async function trackPresence(patch = {}) {
    if (!channel || !liveReady || destroyed) return;
    const name = getDisplayName();
    if (!name) return;
    const parts = String(focusKey || '').split('::');
    try {
      await channel.track({
        name,
        clientId: getClientId(),
        focusKey,
        focusPid: parts[0] || null,
        focusField: parts.length > 1 ? parts.slice(1).join('::') : null,
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
      delete focusBroadcast[clientId];
    } else {
      focusBroadcast[clientId] = {
        name: (payload.name || '').trim() || 'Someone',
        clientId,
        cellKey: key,
        color: payload.color || peerColor(clientId),
      };
    }
    onRemoteFocus?.(payload);
    rebuildPeerCells();
  }

  function onFocusIn(e) {
    const input = e.target?.closest?.(inputSelector);
    if (!input || !root.contains(input)) return;
    setLocalFocus(cellKeyFromInput(input));
    trackPresence();
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
      trackPresence();
      broadcastFocus();
    }, 0);
  }

  function start() {
    if (destroyed || channel) return;
    const rt = getRealtimeClient();
    if (!rt) return;

    const selfId = getClientId();
    channel = rt.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: selfId },
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
    channel.on('presence', { event: 'join' }, refreshPeers);
    channel.on('presence', { event: 'leave' }, refreshPeers);

    channel.subscribe(async (status) => {
      if (destroyed) return;
      if (status === 'SUBSCRIBED') {
        liveReady = true;
        await trackPresence();
        await broadcastFocus();
        refreshPeers();
        if (presenceTimer) clearInterval(presenceTimer);
        presenceTimer = setInterval(() => {
          trackPresence();
        }, PRESENCE_HEARTBEAT_MS);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        liveReady = false;
      }
    });
  }

  async function destroy() {
    destroyed = true;
    liveReady = false;
    if (presenceTimer) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
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
