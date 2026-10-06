import { syncEventOrders } from '../../lib/square/ingest.js';
import { readJsonBody, requireOrgProfile } from '../../lib/square/session.js';

/** Pull completed orders for one event. Does not touch the CSV import. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const auth = await requireOrgProfile(req);
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  const eventId = String(body.event_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    res.status(400).json({ error: 'event_id' });
    return;
  }
  try {
    const result = await syncEventOrders(auth.orgId, eventId);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = err.code === 'not_connected' ? 409 : err.code === 'not_found' ? 404 : 502;
    console.error('[square] sync', err);
    res.status(status).json({
      error: err.code || 'square_failed',
      message: String(err?.message || 'Square sync failed').slice(0, 300),
    });
  }
}
