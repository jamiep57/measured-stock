// =====================================================================
// supabase-admin.js
// =====================================================================
// Tiny PostgREST client for the SERVER side. Uses the Supabase service
// role key so it bypasses RLS — never bundle this file or its caller
// into anything that runs in the browser.
//
// Reads (in order of precedence):
//   SYNC_SUPABASE_URL          / SYNC_SUPABASE_SERVICE_KEY
//   SUPABASE_URL               / SUPABASE_SERVICE_KEY
//   SUPABASE_URL               / SUPABASE_SERVICE_ROLE_KEY    (Supabase canonical name)
//
// The SYNC_* pair takes precedence so a project that already keeps
// SUPABASE_URL pointed at one project (e.g. production) can target the
// other (e.g. dev for backfill) by setting SYNC_SUPABASE_URL +
// SYNC_SUPABASE_SERVICE_KEY without disturbing the rest of the env.
//
// Usage:
//   import { sb } from '../lib/supabase-admin.js';
//   const rows = await sb.get('stock_events', '?select=*&id=eq.foo');
//   await sb.insert('events', [{ name: 'X' }]);
//   await sb.upsert('events', [{ id: '...', name: 'X' }]);
//   await sb.delete('bars', 'event_id=eq.<uuid>');
// =====================================================================

const URL = (
  process.env.SYNC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const KEY =
  process.env.SYNC_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

function assertEnv() {
  if (!URL || !KEY) {
    throw new Error(
      'supabase-admin: a Supabase URL and service-role key must be set.\n' +
      '  Prefer SYNC_SUPABASE_URL + SYNC_SUPABASE_SERVICE_KEY for local use,\n' +
      '  or SUPABASE_URL + SUPABASE_SERVICE_KEY on Vercel.'
    );
  }
}

function headers(extra) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

/** @param {Response} res */
async function ok(res, label) {
  if (res.ok) return res;
  let body = '';
  try { body = await res.text(); } catch {}
  throw new Error(`${label} ${res.status}: ${body || res.statusText}`);
}

export const sb = {
  url() { return URL; },

  /**
   * GET /rest/v1/<table><query>
   * query starts with "?" (e.g. "?id=eq.foo&select=*")
   */
  async get(table, query = '') {
    assertEnv();
    const res = await fetch(`${URL}/rest/v1/${table}${query}`, {
      method: 'GET',
      headers: headers(),
    });
    await ok(res, `GET ${table}`);
    return res.json();
  },

  /**
   * INSERT rows. Returns the inserted rows (Prefer: return=representation).
   * Pass an array, even for one row.
   */
  async insert(table, rows) {
    assertEnv();
    if (!rows || rows.length === 0) return [];
    const res = await fetch(`${URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(rows),
    });
    await ok(res, `INSERT ${table}`);
    return res.json();
  },

  /**
   * UPSERT rows by their primary key (or by a unique constraint, via
   * the on_conflict query string). Returns the resulting rows.
   *
   *   sb.upsert('categories', [{ name: 'BEER', colour_key: 'beer' }],
   *             { onConflict: 'name' });
   */
  async upsert(table, rows, opts = {}) {
    assertEnv();
    if (!rows || rows.length === 0) return [];
    const params = opts.onConflict
      ? `?on_conflict=${encodeURIComponent(opts.onConflict)}`
      : '';
    const res = await fetch(`${URL}/rest/v1/${table}${params}`, {
      method: 'POST',
      headers: headers({
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(rows),
    });
    await ok(res, `UPSERT ${table}`);
    return res.json();
  },

  /**
   * PATCH (update) rows matching a filter.
   *
   *   sb.update('events', 'id=eq.<uuid>', { synced_at: 'now()' });
   */
  async update(table, filter, patch) {
    assertEnv();
    const res = await fetch(`${URL}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    });
    await ok(res, `UPDATE ${table}`);
    return res.json();
  },

  /**
   * DELETE rows matching a filter.
   *
   *   sb.delete('bars', 'event_id=eq.<uuid>');
   */
  async delete(table, filter) {
    assertEnv();
    const res = await fetch(`${URL}/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      headers: headers(),
    });
    await ok(res, `DELETE ${table}`);
    return true;
  },

  /**
   * Delete expired rows from public.sync_locks (migration 007).
   * Returns the number of rows removed.
   */
  async reapSyncLocks() {
    assertEnv();
    const res = await fetch(`${URL}/rest/v1/rpc/reap_sync_locks`, {
      method: 'POST',
      headers: headers(),
      body: '{}',
    });
    await ok(res, 'RPC reap_sync_locks');
    const n = await res.json();
    return typeof n === 'number' ? n : 0;
  },

  /**
   * Try to acquire a per-scope sync mutex. Returns true if this caller
   * holds the lock, false if another worker is already syncing.
   */
  async tryAcquireSyncLock(scopeKey, opts = {}) {
    assertEnv();
    const ttlSec = opts.ttlSec ?? 90;
    const owner = opts.owner ?? 'sync-event';
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

    await this.reapSyncLocks();

    const res = await fetch(`${URL}/rest/v1/sync_locks`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
      body: JSON.stringify([{
        scope_key:  scopeKey,
        expires_at: expiresAt,
        owner,
      }]),
    });
    await ok(res, 'INSERT sync_locks');
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  },

  /** Release a sync mutex acquired by tryAcquireSyncLock. */
  async releaseSyncLock(scopeKey) {
    const key = encodeURIComponent(String(scopeKey));
    return this.delete('sync_locks', `scope_key=eq.${key}`);
  },
};

export default sb;
