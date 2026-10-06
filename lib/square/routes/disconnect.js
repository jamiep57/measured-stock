import sb from '../../supabase-admin.js';
import { revokeSquareToken } from '../client.js';
import { squareConfig } from '../config.js';
import { getConnection } from '../connection.js';
import { decryptToken } from '../crypto.js';
import { requireOrgProfile } from '../session.js';

/** Disconnect Square. Stored orders stay so a reconnect can be compared with the CSV. */
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
  const connection = await getConnection(auth.orgId);
  if (connection) {
    const cfg = squareConfig();
    if (cfg.appSecret && cfg.tokenKey) {
      try {
        const access = decryptToken(connection.access_token_enc, cfg.tokenKey);
        await revokeSquareToken(connection.environment, access);
      } catch (err) {
        console.error('[square] revoke', err?.message || err);
      }
    }
    await sb.delete('org_square_connections', `org_id=eq.${encodeURIComponent(auth.orgId)}`);
  }
  res.status(200).json({ ok: true });
}
