// =====================================================================
// /api/sync-event
// =====================================================================
// Rebuilds the v2 relational rows for ONE event (or for the global
// recipes library) from the latest stock_events blob.
//
// Called by V4 frontend's cloudPush() after a successful blob write
// (fire-and-forget), and by api/sync-catchup.js for any rows whose
// blob updated_at is newer than v2.synced_at.
//
// Auth model: the public PIN-gate middleware already protects this
// endpoint from random internet traffic. The function itself uses
// the service-role key (SUPABASE_SERVICE_KEY) which never leaves the
// server.
//
// Request:
//   POST /api/sync-event
//   Content-Type: application/json
//   Body: { "event_id": "<legacy_id>"  }     -- normal event
//         { "event_id": "__recipes__"  }     -- global recipes sync
//
// Response: 200 { ok: true, ... }
//           500 { ok: false, error: "..." }
// =====================================================================

import { syncEvent, syncRecipes } from '../lib/sync-engine.js';

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(503).json({
      ok: false,
      error: 'Sync function not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)',
    });
    return;
  }

  let body;
  try { body = await readJsonBody(req); }
  catch { body = {}; }

  const eventId = String(body.event_id || '').trim();
  if (!eventId) {
    res.status(400).json({ ok: false, error: 'event_id required' });
    return;
  }

  // Scope guard: by default we only allow syncing the events you've
  // decided to migrate. Override via SYNC_ALL=true if you ever want to
  // sync the whole table.
  const SCOPE_LIST = (process.env.SYNC_SCOPE || 'mo95nl29jb46o,mpbb01nnvy0t7,__recipes__,__bugs__')
    .split(',').map(s => s.trim()).filter(Boolean);
  const SYNC_ALL = process.env.SYNC_ALL === 'true';
  if (!SYNC_ALL && !SCOPE_LIST.includes(eventId)) {
    res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'out of sync scope',
      event_id: eventId,
    });
    return;
  }

  try {
    let result;
    if (eventId === '__recipes__') {
      result = await syncRecipes();
    } else if (eventId === '__bugs__') {
      // Bugs migration is optional and deferred — return ok with note.
      result = { ok: true, skipped: true, reason: '__bugs__ sync not implemented yet' };
    } else {
      result = await syncEvent(eventId);
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('[sync-event]', err);
    res.status(500).json({
      ok:    false,
      event_id: eventId,
      error: String(err?.message || err),
    });
  }
}
