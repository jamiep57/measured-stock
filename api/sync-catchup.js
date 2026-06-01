// =====================================================================
// /api/sync-catchup
// =====================================================================
// Safety net for sync-event failures. Walks every in-scope stock_events
// row, compares blob updated_at against events.source_updated_at, and
// re-syncs any row that's stale or has never been synced.
//
// Runs on a schedule (see vercel.json crons section), OR can be called
// manually any time:
//
//   curl -X POST https://your-app.vercel.app/api/sync-catchup
//
// Auth:
//   - Vercel cron requests include `Authorization: Bearer ${CRON_SECRET}`
//     if you set the CRON_SECRET env var. We accept those.
//   - Non-cron requests are otherwise gated by the PIN-middleware
//     (the catch-up endpoint is matched by the middleware's catch-all).
// =====================================================================

import { syncEvent, syncRecipes } from '../lib/sync-engine.js';
import sb from '../lib/supabase-admin.js';

const DEFAULT_SCOPE = 'mo95nl29jb46o,mpbb01nnvy0t7,__recipes__,__bugs__';

function getScope() {
  return (process.env.SYNC_SCOPE || DEFAULT_SCOPE)
    .split(',').map(s => s.trim()).filter(Boolean);
}

function enc(v) { return encodeURIComponent(String(v)); }

/** Reads a Date safely from a value that may be string/Date/null. */
function ts(v) { return v ? new Date(v).getTime() : 0; }

function isCronRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return false;
  const expected = process.env.CRON_SECRET;
  return expected ? auth === `Bearer ${expected}` : true;
}

export default async function handler(req, res) {
  // Allow GET (Vercel cron uses GET) and POST (manual triggers).
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(503).json({
      ok: false,
      error: 'Sync function not configured',
    });
    return;
  }

  // If a CRON_SECRET is set, prefer it. Otherwise rely on PIN middleware.
  if (process.env.CRON_SECRET && !isCronRequest(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const scope = getScope();
  const results = [];

  // Pull blob updated_at for in-scope rows
  const blobRows = await sb.get(
    'stock_events',
    `?id=in.(${scope.map(enc).join(',')})&select=id,updated_at`
  );
  const blobByLegacy = {};
  for (const r of blobRows) blobByLegacy[r.id] = r.updated_at;

  // Pull v2 events bookkeeping
  const v2Events = await sb.get(
    'events',
    `?legacy_id=in.(${scope.filter(s => !s.startsWith('__')).map(enc).join(',')})&select=legacy_id,source_updated_at,synced_at`
  );
  const v2ByLegacy = {};
  for (const r of v2Events) v2ByLegacy[r.legacy_id] = r;

  // Pull global syncs state
  const sysState = await sb.get(
    'system_sync_state',
    `?key=in.(__recipes__,__bugs__)&select=key,source_updated_at,synced_at`
  );
  const sysByKey = {};
  for (const r of sysState) sysByKey[r.key] = r;

  for (const legacyId of scope) {
    const blobTs = ts(blobByLegacy[legacyId]);
    if (!blobTs) {
      results.push({ legacyId, action: 'skip', reason: 'blob row not present' });
      continue;
    }

    let v2Ts;
    if (legacyId === '__recipes__' || legacyId === '__bugs__') {
      v2Ts = ts(sysByKey[legacyId]?.source_updated_at);
    } else {
      v2Ts = ts(v2ByLegacy[legacyId]?.source_updated_at);
    }

    if (v2Ts >= blobTs && v2Ts !== 0) {
      results.push({ legacyId, action: 'skip', reason: 'up-to-date' });
      continue;
    }

    try {
      let r;
      if (legacyId === '__recipes__')      r = await syncRecipes();
      else if (legacyId === '__bugs__')    r = { ok: true, skipped: true, reason: 'bugs sync not implemented' };
      else                                  r = await syncEvent(legacyId);
      results.push({ legacyId, action: 'synced', result: r });
    } catch (err) {
      console.error('[sync-catchup]', legacyId, err);
      results.push({ legacyId, action: 'error', error: String(err?.message || err) });
    }
  }

  const summary = {
    ok:       true,
    ran_at:   new Date().toISOString(),
    scope,
    synced:   results.filter(r => r.action === 'synced').length,
    skipped:  results.filter(r => r.action === 'skip').length,
    errors:   results.filter(r => r.action === 'error').length,
    results,
  };

  // 207-ish: surface partial errors via HTTP status if any
  res.status(summary.errors ? 500 : 200).json(summary);
}
