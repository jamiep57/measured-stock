import { appOrigin } from '../../app-url.js';
import { authorizeUrl } from '../client.js';
import { squareConfig } from '../config.js';
import { signState } from '../crypto.js';
import { requireOrgProfile } from '../session.js';

function redirectUri(req) {
  const cfg = squareConfig();
  if (cfg.redirectUrl) return cfg.redirectUrl;
  return `${appOrigin(req)}/api/square/callback`;
}

/** Start Square OAuth. Returns the authorize URL; the browser navigates to it. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const cfg = squareConfig();
  if (!cfg.appId || !cfg.appSecret || !cfg.tokenKey) {
    res.status(503).json({ error: 'not_configured' });
    return;
  }

  const auth = await requireOrgProfile(req, { admin: true });
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const uri = redirectUri(req);
  const state = signState({ orgId: auth.orgId, redirectUri: uri }, cfg.tokenKey);
  res.status(200).json({
    url: authorizeUrl({ environment: cfg.environment, state, redirectUri: uri }),
    environment: cfg.environment,
  });
}
