/**
 * Browser Supabase Auth client + edge session bridge.
 */

import { createClient } from '@supabase/supabase-js';
import { setDisplayName } from './session-identity.js';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;
let clientKey = '';

/** @type {import('@supabase/supabase-js').Session | null} */
let cachedSession = null;

/** @type {null | { id: string, email?: string, display_name?: string, role?: string, status?: string }} */
let cachedProfile = null;

function cloudConfig() {
  try {
    if (typeof window !== 'undefined' && window.__CLOUD_CONFIG__?.url) {
      return {
        url: String(window.__CLOUD_CONFIG__.url).replace(/\/$/, ''),
        key: window.__CLOUD_CONFIG__.key || '',
      };
    }
    const raw = localStorage.getItem('measured_stock_cloud');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.url && parsed?.key) {
        return { url: String(parsed.url).replace(/\/$/, ''), key: parsed.key };
      }
    }
  } catch { /* ignore */ }

  // Match assets/js/db.js builtin (anon key).
  return {
    url: 'https://qqdvzcaukstfdixnfuqq.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZHZ6Y2F1a3N0ZmRpeG5mdXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTg2NzQsImV4cCI6MjA5MjM3NDY3NH0.pEli5ZEliJIwBTsNLb5JW4mFW1nV1TAnUO0f5_1UhGU',
  };
}

export function getAuthClient() {
  const cfg = cloudConfig();
  if (!cfg.url || !cfg.key) return null;
  const key = `${cfg.url}|${cfg.key}`;
  if (client && clientKey === key) return client;
  client = createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  clientKey = key;
  client.auth.onAuthStateChange((_event, session) => {
    cachedSession = session;
    if (typeof window !== 'undefined' && window.DB?.setAccessToken) {
      window.DB.setAccessToken(session?.access_token || null);
    }
  });
  return client;
}

export function getAccessToken() {
  return cachedSession?.access_token || null;
}

export function getCachedProfile() {
  return cachedProfile;
}

/**
 * Ensure Supabase session + edge cookie. Redirects to /login when needed.
 * @param {{ requireAdmin?: boolean, loginPath?: string }} [opts]
 * @returns {Promise<{ session: import('@supabase/supabase-js').Session, profile: object } | null>}
 */
export async function ensureAppAuth(opts = {}) {
  const loginPath = opts.loginPath || '/login';
  const sb = getAuthClient();
  if (!sb) {
    window.location.href = loginPath;
    return null;
  }

  const { data: { session } } = await sb.auth.getSession();
  cachedSession = session;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.href = `${loginPath}?next=${next}`;
    return null;
  }

  if (typeof window !== 'undefined' && window.DB?.setAccessToken) {
    window.DB.setAccessToken(session.access_token);
  }

  let data = null;
  let resOk = false;
  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: session.access_token }),
    });
    data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === 'pending') {
      window.location.href = `${loginPath}?pending=1`;
      return null;
    }
    if (res.status === 403 && data.error === 'disabled') {
      window.location.href = `${loginPath}?error=disabled`;
      return null;
    }
    resOk = res.ok;
  } catch {
    // Local Vite has no /api — fall through to profile read.
    resOk = false;
  }

  if (resOk && data?.profile) {
    cachedProfile = data.profile;
  } else {
    // Fallback: read own profile via PostgREST (works once JWT + RLS are live).
    try {
      const rows = await window.DB.select(
        'profiles',
        `?id=eq.${encodeURIComponent(session.user.id)}&select=*&limit=1`
      );
      const profile = Array.isArray(rows) ? rows[0] : null;
      if (!profile || profile.status === 'pending') {
        window.location.href = `${loginPath}?pending=1`;
        return null;
      }
      if (profile.status !== 'active') {
        window.location.href = `${loginPath}?error=disabled`;
        return null;
      }
      cachedProfile = profile;
    } catch (err) {
      console.error('ensureAppAuth profile', err);
      window.location.href = `${loginPath}?error=session`;
      return null;
    }
  }

  if (cachedProfile?.display_name) {
    setDisplayName(cachedProfile.display_name);
  }

  if (opts.requireAdmin && cachedProfile?.role !== 'admin') {
    window.location.href = '/app/';
    return null;
  }

  return { session, profile: cachedProfile };
}

export async function signOutApp() {
  const sb = getAuthClient();
  try {
    await sb?.auth.signOut();
  } catch { /* ignore */ }
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch { /* ignore */ }
  window.location.href = '/login';
}

/**
 * Authed fetch helper for admin APIs.
 * @param {string} url
 * @param {RequestInit} [init]
 */
export async function authFetch(url, init = {}) {
  const token = getAccessToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...init, headers });
}
