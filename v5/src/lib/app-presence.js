/**
 * App-wide admin presence — who’s in this event workspace.
 * Cell carets stay on per-panel collab channels; this only powers the sidebar strip.
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
      focusKey: currentFocusKey,
      at: Date.now(),
      ...patch,
    });
  } catch { /* ignore */ }
}

async function stopChannel() {
  liveReady = false;
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
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
      presence: { key: selfId },
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
      await track();
      refresh();
      if (presenceTimer) clearInterval(presenceTimer);
      presenceTimer = setInterval(() => { track(); }, PRESENCE_HEARTBEAT_MS);
      if (text && (text.textContent === 'Connecting…' || !text.textContent)) {
        text.textContent = 'Just you here';
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      liveReady = false;
      if (text) text.textContent = 'Live sync unavailable';
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
  currentPanel = nextPanel;
  currentFocusKey = null;

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

  await track();
  updateUi(flattenPresenceState(channel?.presenceState() || {}));
}

/** Optional: grid focus so peers can later show where someone is editing. */
export function setAppPresenceFocus(focusKey) {
  currentFocusKey = focusKey || null;
  track();
}

export async function stopAppPresence() {
  currentEventId = '';
  currentPanel = '';
  currentFocusKey = null;
  await stopChannel();
  updateUi([]);
}

registerAppFocusBridge(setAppPresenceFocus);
