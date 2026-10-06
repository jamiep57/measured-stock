import { listLocations } from '../client.js';
import { getConnection, markConnectionError, usableAccessToken } from '../connection.js';
import { requireOrgProfile } from '../session.js';

/** Locations for the connected merchant, plus connection status. */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const auth = await requireOrgProfile(req);
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const connection = await getConnection(auth.orgId);
  if (!connection) {
    res.status(200).json({ connected: false, locations: [] });
    return;
  }
  const status = {
    connected: true,
    environment: connection.environment,
    merchant_id: connection.merchant_id,
    merchant_name: connection.merchant_name,
    connected_at: connection.connected_at,
    last_sync_at: connection.last_sync_at,
    last_webhook_at: connection.last_webhook_at,
    last_error: connection.last_error,
    locations: [],
  };
  try {
    const token = await usableAccessToken(connection);
    status.locations = await listLocations(connection.environment, token);
    res.status(200).json(status);
  } catch (err) {
    console.error('[square] locations', err);
    await markConnectionError(auth.orgId, err);
    status.last_error = String(err?.message || 'Square request failed').slice(0, 300);
    res.status(200).json(status);
  }
}
