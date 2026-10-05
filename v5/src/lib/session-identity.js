/**
 * Browser identity for collaborative editing (Closing presence, etc.).
 * Display name comes from the PIN unlock cookie; client id is per-tab.
 */

export const DISPLAY_NAME_COOKIE = 'ms_display_name';
export const DISPLAY_NAME_STORAGE_KEY = 'ms_display_name';
export const CLIENT_ID_STORAGE_KEY = 'ms_client_id';
export const DISPLAY_NAME_MAX_LEN = 40;

/** @param {unknown} raw */
export function normalizeDisplayName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > DISPLAY_NAME_MAX_LEN) return null;
  return name;
}

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of String(document.cookie || '').split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return trimmed.slice(prefix.length);
      }
    }
  }
  return null;
}

function writeCookie(name, value, maxAgeSec = 60 * 60 * 24 * 30) {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

/** @returns {string|null} */
export function getDisplayName() {
  const fromCookie = normalizeDisplayName(readCookie(DISPLAY_NAME_COOKIE));
  if (fromCookie) return fromCookie;
  try {
    return normalizeDisplayName(localStorage.getItem(DISPLAY_NAME_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** @param {string} raw */
export function setDisplayName(raw) {
  const name = normalizeDisplayName(raw);
  if (!name) return null;
  writeCookie(DISPLAY_NAME_COOKIE, name);
  try {
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  } catch { /* ignore */ }
  return name;
}

/** Stable per-tab id so two tabs from the same person show as two viewers. */
export function getClientId() {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `c-${Date.now()}`;
  }
}
