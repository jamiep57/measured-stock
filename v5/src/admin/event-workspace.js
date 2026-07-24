/**
 * Remembered event workspace for admin sidebar chrome.
 * Survives Catalog / home / tools navigation and soft reloads.
 */

const EVENT_STORAGE_KEY = 'v5-admin-active-event';

export function readRememberedEventId() {
  try {
    return sessionStorage.getItem(EVENT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeRememberedEventId(id) {
  try {
    if (id) sessionStorage.setItem(EVENT_STORAGE_KEY, id);
    else sessionStorage.removeItem(EVENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve which event the sidebar workspace should show.
 * URL wins on event routes; otherwise keep the remembered id until
 * the user explicitly leaves via the workspace switcher ("All events").
 */
export function resolveActiveEventId(route, state) {
  if (route?.view === 'event' && route.eventId) return route.eventId;
  return state?.eventId || '';
}
