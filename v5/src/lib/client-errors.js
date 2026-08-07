/**
 * Lightweight client error reporting for production.
 * Stores recent errors in sessionStorage and optionally POSTs to /api if configured.
 */

import { toast } from './util.js';

const STORE_KEY = 'v5_client_errors';
const MAX_STORED = 30;

/** @type {Array<{ at: string, message: string, stack?: string, url?: string, source?: string }>} */
let buffer = [];

function loadStored() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(buffer.slice(-MAX_STORED)));
  } catch { /* quota / private mode */ }
}

/**
 * @param {object} entry
 * @param {string} entry.message
 * @param {string} [entry.stack]
 * @param {string} [entry.source]
 */
export function reportClientError(entry) {
  const row = {
    at: new Date().toISOString(),
    message: String(entry?.message || 'Unknown error'),
    stack: entry?.stack ? String(entry.stack).slice(0, 2000) : undefined,
    url: typeof location !== 'undefined' ? location.href : undefined,
    source: entry?.source || 'client',
  };
  buffer.push(row);
  if (buffer.length > MAX_STORED) buffer = buffer.slice(-MAX_STORED);
  persist();

  // Optional beacon endpoint — no-op if missing / fails.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const body = JSON.stringify(row);
      navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    } catch { /* ignore */ }
  }

  return row;
}

/**
 * User-facing error: toast + buffer/beacon for ops.
 * @param {unknown} err
 * @param {{ userMessage?: string, source?: string, silent?: boolean }} [opts]
 */
export function reportError(err, opts = {}) {
  const message = (err && typeof err === 'object' && 'message' in err && err.message)
    ? String(err.message)
    : String(err || 'Something went wrong');
  const userMessage = opts.userMessage || message;
  reportClientError({
    message,
    stack: err && typeof err === 'object' && 'stack' in err ? String(err.stack || '') : undefined,
    source: opts.source || 'reportError',
  });
  if (!opts.silent) toast(userMessage, true);
  return userMessage;
}

export function getRecentClientErrors() {
  return buffer.length ? [...buffer] : loadStored();
}

/** Install window error + unhandledrejection listeners once. */
export function initClientErrorReporting() {
  if (typeof window === 'undefined') return () => {};
  if (window.__V5_CLIENT_ERRORS__) return () => {};
  window.__V5_CLIENT_ERRORS__ = true;

  buffer = loadStored();

  const onError = (event) => {
    reportClientError({
      message: event?.message || String(event?.error || 'window.error'),
      stack: event?.error?.stack,
      source: 'window.error',
    });
  };

  const onRejection = (event) => {
    const reason = event?.reason;
    reportClientError({
      message: reason?.message || String(reason || 'unhandledrejection'),
      stack: reason?.stack,
      source: 'unhandledrejection',
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    delete window.__V5_CLIENT_ERRORS__;
  };
}
