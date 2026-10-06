import { squareConfig } from '../config.js';
import { verifySquareSignature } from '../crypto.js';
import { getConnectionByMerchant, markConnectionError, touchConnection } from '../connection.js';
import { ingestOrderId } from '../ingest.js';
import { readRawBody } from '../session.js';

function notificationUrl(req) {
  const configured = squareConfig().webhookUrl;
  if (configured) return configured;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/square/webhook`;
}

function orderIdFrom(payload) {
  const data = payload?.data || {};
  const object = data.object || {};
  const updated = object.order_updated || object.order_created || {};
  return updated.order_id || object.order?.id || data.id || null;
}

/** Square order.updated. Signature is checked; the login cookie is not. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const cfg = squareConfig();
  if (!cfg.webhookKey) {
    res.status(503).json({ error: 'not_configured' });
    return;
  }
  const raw = await readRawBody(req);
  const signature = req.headers['x-square-hmacsha256-signature'] || '';
  if (!verifySquareSignature({
    signature: String(signature),
    notificationUrl: notificationUrl(req),
    body: raw,
    signatureKey: cfg.webhookKey,
  })) {
    res.status(401).json({ error: 'bad_signature' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  const type = String(payload.type || '');
  if (type !== 'order.updated' && type !== 'order.created') {
    res.status(200).json({ ok: true, ignored: type || 'unknown' });
    return;
  }
  const merchantId = payload.merchant_id;
  const orderId = orderIdFrom(payload);
  if (!merchantId || !orderId) {
    res.status(200).json({ ok: true, ignored: 'missing_ids' });
    return;
  }
  const connection = await getConnectionByMerchant(merchantId);
  if (!connection) {
    res.status(200).json({ ok: true, ignored: 'unknown_merchant' });
    return;
  }
  try {
    const result = await ingestOrderId(connection, orderId);
    await touchConnection(connection.org_id, { last_webhook_at: new Date().toISOString(), last_error: null });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[square] webhook', err);
    await markConnectionError(connection.org_id, err);
    res.status(500).json({ error: 'ingest_failed' });
  }
}
