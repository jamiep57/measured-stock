import sb from '../supabase-admin.js';
import { squareConfig } from './config.js';
import { decryptToken, encryptToken } from './crypto.js';
import { refreshSquareToken } from './client.js';

function enc(value) {
  return encodeURIComponent(String(value));
}

export async function getConnection(orgId) {
  const rows = await sb.get('org_square_connections', `?org_id=eq.${enc(orgId)}&select=*`);
  return rows[0] || null;
}

export async function getConnectionByMerchant(merchantId) {
  const rows = await sb.get(
    'org_square_connections',
    `?merchant_id=eq.${enc(merchantId)}&select=*`,
  );
  return rows[0] || null;
}

function clipError(err) {
  const text = String(err?.message || err || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 300) || 'Square request failed';
}

/** Decrypts the access token, refreshing it when it is close to expiry. */
export async function usableAccessToken(connection) {
  const cfg = squareConfig();
  if (!cfg.tokenKey) throw new Error('Square token key is not configured');
  const expires = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  const refreshSoon = !expires || expires - Date.now() < 5 * 60 * 1000;
  if (!refreshSoon) return decryptToken(connection.access_token_enc, cfg.tokenKey);

  const currentRefresh = decryptToken(connection.refresh_token_enc, cfg.tokenKey);
  const refreshed = await refreshSquareToken(connection.environment, currentRefresh);
  const nextRefresh = refreshed.refresh_token || currentRefresh;
  await sb.update('org_square_connections', `org_id=eq.${enc(connection.org_id)}`, {
    access_token_enc: encryptToken(refreshed.access_token, cfg.tokenKey),
    refresh_token_enc: encryptToken(nextRefresh, cfg.tokenKey),
    token_expires_at: refreshed.expires_at || null,
    updated_at: new Date().toISOString(),
    last_error: null,
  });
  connection.access_token_enc = encryptToken(refreshed.access_token, cfg.tokenKey);
  connection.refresh_token_enc = encryptToken(nextRefresh, cfg.tokenKey);
  connection.token_expires_at = refreshed.expires_at || null;
  return refreshed.access_token;
}

export async function markConnectionError(orgId, err) {
  try {
    await sb.update('org_square_connections', `org_id=eq.${enc(orgId)}`, {
      last_error: clipError(err),
      updated_at: new Date().toISOString(),
    });
  } catch (updateErr) {
    console.error('[square] could not store last_error', updateErr);
  }
}

export async function touchConnection(orgId, patch) {
  await sb.update('org_square_connections', `org_id=eq.${enc(orgId)}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}
