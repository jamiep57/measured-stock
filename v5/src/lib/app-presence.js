/**
 * App-wide admin presence — who’s in this event workspace.
 * Cell carets stay on per-panel Broadcast channels; this only powers the sidebar strip.
 *
 * Presence updates are rare (join / panel change / slow heartbeat). High-frequency
 * cell focus must NOT call track() — Supabase caps ~5 presence calls / 30s / client
 * and shuts the channel when exceeded.
 */

import { getClientId, getDisplayName } from './session-identity.js';
import { getRealtimeClient } from './realtime.js';
import {
  PRESENCE_HEARTBEAT_MS,
  flattenPresenceState,
  formatCollabPresence,
  registerAppFocusBridge,
} from './collab-presence.js';

/** @type {import('@supabase/supabase-js').RealtimeChannel | null} */
let channel = null;
/** @type {string} */
let channelKey = '';
let liveReady = false;
let presenceTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
/** @type {string} */
let currentEventId = '';
/** @type {string} */
let currentPanel = '';
/** @type {string | null} */
let currentFocusKey = null;

function liveEls() {
  return {
    bar: document.getElementById('sidebarPresence'),
    text: document.getElementById('sidebarPresenceText'),
  };
}

function updateUi(peers) {
  const { bar, text } = liveEls();
  if (!bar || !text) return;
  if (!currentEventId) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  if (!channel) {
    text.textContent = 'Live sync unavailable';
    return;
  }
  text.textContent = formatCollabPresence(peers || [], getClientId()).text;
}

async function track(patch = {}) {
  if (!channel || !liveReady) return;
  const name = getDisplayName();
  if (!name) return;
  try {
    await channel.track({
      name,
      clientId: getClientId(),
      eventId: currentEventId,
      panel: currentPanel || null,
      // focusKey is informational / slow — cell carets use Broadcast on the grid channel
      focusKey: currentFocusKey,
      at: Date.now(),
      ...patch,
    });
  } catch { /* ignore */ }
}

function clearPresenceTimer() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

async function stopChannel() {
  liveReady = false;
  clearPresenceTimer();
  clearReconnectTimer();
  const ch = channel;
  channel = null;
  channelKey = '';
  if (!ch) return;
  try {
    await ch.unsubscribe();
  } catch { /* ignore */ }
  try {
    getRealtimeClient()?.removeChannel(ch);
  } catch { /* ignore */ }
}

function scheduleReconnect(eventId) {
  if (!eventId || reconnectTimer) return;
  const delay = Math.min(15_000, 1_000 * (2 ** Math.min(reconnectAttempt, 3)));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentEventId !== eventId || channel) return;
    startChannel(eventId);
  }, delay);
}

function startChannel(eventId) {
  const rt = getRealtimeClient();
  const { bar, text } = liveEls();
  if (!rt || !eventId) {
    if (bar) bar.hidden = true;
    return;
  }
  if (bar) bar.hidden = false;
  if (text) text.textContent = 'Connecting…';

  const key = `collab:admin:${eventId}`;
  channelKey = key;
  const selfId = getClientId();
  channel = rt.channel(key, {
    config: {
      presence: { key: selfId, enabled: true },
    },
  });

  const refresh = () => {
    updateUi(flattenPresenceState(channel?.presenceState() || {}));
  };

  channel.on('presence', { event: 'sync' }, refresh);
  channel.on('presence', { event: 'join' }, refresh);
  channel.on('presence', { event: 'leave' }, refresh);

  channel.subscribe(async (status) => {
    if (channelKey !== key) return;
    if (status === 'SUBSCRIBED') {
      liveReady = true;
      reconnectAttempt = 0;
      await track();
      refresh();
      clearPresenceTimer();
      presenceTimer = setInterval(() => { track(); }, PRESENCE_HEARTBEAT_MS);
      if (text && (text.textContent === 'Connecting…' || !text.textContent)) {
        text.textContent = 'Just you here';
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      liveReady = false;
      clearPresenceTimer();
      const ch = channel;
      channel = null;
      channelKey = '';
      if (ch) {
        try { getRealtimeClient()?.removeChannel(ch); } catch { /* ignore */ }
      }
      if (text) text.textContent = 'Live sync unavailable';
      if (currentEventId === eventId) scheduleReconnect(eventId);
    }
  });
}

/**
 * Keep sidebar presence subscribed to the active event workspace.
 * @param {{ eventId?: string, panel?: string }} opts
 */
export async function syncAppPresence({ eventId = '', panel = '' } = {}) {
  const nextEvent = String(eventId || '').trim();
  const nextPanel = String(panel || '').trim();
  const panelChanged = nextPanel !== currentPanel;
  currentPanel = nextPanel;
  // Don't clear focus on every route tick — only when leaving the event.
  if (!nextEvent) currentFocusKey = null;

  if (!nextEvent) {
    currentEventId = '';
    await stopChannel();
    updateUi([]);
    return;
  }

  if (nextEvent !== currentEventId || !channel) {
    currentEventId = nextEvent;
    await stopChannel();
    startChannel(nextEvent);
    return;
  }

  // Panel changes are rare enough for a presence refresh.
  if (panelChanged) await track();
  updateUi(flattenPresenceState(channel?.presenceState() || {}));
}

/**
 * Remember grid focus for optional sidebar metadata.
 * Does NOT call track() — cell carets use Broadcast; presence stays rate-limit safe.
 */
export function setAppPresenceFocus(focusKey) {
  currentFocusKey = focusKey || null;
}

export async function stopAppPresence() {
  currentEventId = '';
  currentPanel = '';
  currentFocusKey = null;
  await stopChannel();
  updateUi([]);
}

registerAppFocusBridge(setAppPresenceFocus);
