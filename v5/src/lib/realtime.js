/**
 * Thin Supabase Realtime client for collaborative panels.
 * Writes stay on PostgREST (window.DB); this is subscribe-only.
 */

import { createClient } from '@supabase/supabase-js';
import { getDB } from '../db.js';
import { getAccessToken, getAuthClient } from './auth.js';

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;
let clientKey = '';

function cloudConfig() {
  try {
    const cfg = getDB().config;
    if (cfg?.url && cfg?.key) return { url: cfg.url, key: cfg.key };
  } catch { /* DB not loaded yet */ }
  return null;
}

/** @returns {import('@supabase/supabase-js').SupabaseClient | null} */
export function getRealtimeClient() {
  // Prefer the shared auth client so Realtime uses the user JWT.
  const authClient = getAuthClient();
  if (authClient) return authClient;

  const cfg = cloudConfig();
  if (!cfg) return null;
  const token = getAccessToken();
  const key = `${cfg.url}|${cfg.key}|${token || ''}`;
  if (client && clientKey === key) return client;
  client = createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
    realtime: {
      params: { eventsPerSecond: 40 },
    },
  });
  clientKey = key;
  return client;
}
