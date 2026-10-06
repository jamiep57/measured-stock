import { appOrigin } from '../../app-url.js';
import sb from '../../supabase-admin.js';
import { exchangeAuthCode, fetchMerchant } from '../client.js';
import { squareConfig } from '../config.js';
import { encryptToken, verifyState } from '../crypto.js';

function redirect(res, req, query) {
  const params = new URLSearchParams(query);
  res.writeHead(302, { Location: `${appOrigin(req)}/settings/square?${params}` });
  res.end();
}

/** Square sends the browser back here with ?code=&state=. */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const cfg = squareConfig();
  const url = new URL(req.url, 'https://square.local');
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const denied = url.searchParams.get('error');
  if (denied) {
    redirect(res, req, { square: 'error', reason: 'denied' });
    return;
  }
  if (!cfg.tokenKey || !cfg.appId || !cfg.appSecret || !code) {
    redirect(res, req, { square: 'error', reason: 'not_configured' });
    return;
  }

  const payload = verifyState(state, cfg.tokenKey);
  if (!payload?.orgId || !payload.redirectUri) {
    redirect(res, req, { square: 'error', reason: 'state' });
    return;
  }

  try {
    const token = await exchangeAuthCode({
      environment: cfg.environment,
      code,
      redirectUri: payload.redirectUri,
    });
    if (!token.access_token || !token.refresh_token || !token.merchant_id) {
      throw new Error('Square did not return a usable token');
    }
    let merchantName = null;
    try {
      const merchant = await fetchMerchant(cfg.environment, token.access_token, token.merchant_id);
      merchantName = merchant?.business_name || merchant?.name || null;
    } catch (err) {
      console.error('[square] merchant profile', err?.message || err);
    }
    await sb.upsert('org_square_connections', [{
      org_id: payload.orgId,
      merchant_id: token.merchant_id,
      environment: cfg.environment,
      merchant_name: merchantName,
      scopes: 'MERCHANT_PROFILE_READ ORDERS_READ ITEMS_READ',
      access_token_enc: encryptToken(token.access_token, cfg.tokenKey),
      refresh_token_enc: encryptToken(token.refresh_token, cfg.tokenKey),
      token_expires_at: token.expires_at || null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    }], { onConflict: 'org_id' });
    redirect(res, req, { square: 'connected' });
  } catch (err) {
    console.error('[square] callback', err);
    const reason = /duplicate|23505|merchant/i.test(String(err?.message || err)) ? 'merchant_taken' : 'exchange';
    redirect(res, req, { square: 'error', reason });
  }
}
