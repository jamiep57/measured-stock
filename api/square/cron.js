import sb from '../../lib/supabase-admin.js';
import { syncActiveEvents } from '../../lib/square/ingest.js';
import { markConnectionError } from '../../lib/square/connection.js';

function isCronRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return auth === `Bearer ${expected}`;
}

/**
 * Backfill active events. Webhooks are the live path; this catches misses.
 * Vercel cron sends GET with the CRON_SECRET bearer.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isCronRequest(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const connections = await sb.get(
    'org_square_connections',
    '?select=org_id,merchant_id,environment,access_token_enc,refresh_token_enc,token_expires_at',
  );
  const results = [];
  for (const connection of connections) {
    try {
      const result = await syncActiveEvents(connection);
      results.push({ org_id: connection.org_id, ...result });
    } catch (err) {
      console.error('[square] cron', connection.org_id, err);
      await markConnectionError(connection.org_id, err);
      results.push({ org_id: connection.org_id, error: String(err?.message || err).slice(0, 300) });
    }
  }
  const errors = results.filter((row) => row.error).length;
  res.status(errors ? 500 : 200).json({
    ok: errors === 0,
    ran_at: new Date().toISOString(),
    merchants: connections.length,
    errors,
    results,
  });
}
