import { planEventCatalog } from '../catalog.js';
import { markConnectionError } from '../connection.js';
import { readJsonBody, requireOrgProfile } from '../session.js';

const STATUS = { not_connected: 409, needs_reconnect: 409, no_links: 409, not_found: 404 };

/** Preview (apply: false) or push (apply: true) one event's menu to the Square catalogue. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const auth = await requireOrgProfile(req, { admin: true });
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
    const result = await planEventCatalog(auth.orgId, eventId, { apply: body.apply === true });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const status = STATUS[err.code] || 502;
    if (status === 502) {
      console.error('[square] catalog', err);
      if (body.apply === true) await markConnectionError(auth.orgId, err);
    }
    res.status(status).json({
      error: err.code || 'square_failed',
      message: String(err?.message || 'Square menu sync failed').slice(0, 300),
    });
  }
}
