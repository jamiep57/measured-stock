import {
  createAuthToken,
  COOKIE_NAME,
  DISPLAY_NAME_COOKIE,
  normalizeDisplayName,
} from '../../lib/cookie.js';
import {
  getUserFromAccessToken,
  getProfileById,
} from '../../lib/supabase-auth-admin.js';

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** @param {import('http').IncomingMessage & { body?: unknown }} req */
async function readJsonBody(req) {
  if (req.body != null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return /** @type {Record<string, unknown>} */ (req.body);
    }
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (!raw) return {};
    return JSON.parse(raw);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function secureFlag() {
  const secure =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  return secure ? ' Secure;' : '';
}

/**
 * Exchange a Supabase access token for the edge ms_auth cookie (role gate).
 * Body: { access_token: string, display_name?: string }
 */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const secret = process.env.COOKIE_SECRET?.trim();
  if (!secret) {
    res.status(503).json({ error: 'not_configured' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  const accessToken = String(body.access_token || '').trim();
  const user = await getUserFromAccessToken(accessToken);
  if (!user) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  let profile;
  try {
    profile = await getProfileById(user.id);
  } catch (err) {
    res.status(500).json({ error: 'profile_lookup_failed', message: String(err?.message || err) });
    return;
  }

  if (!profile) {
    res.status(403).json({ error: 'no_profile' });
    return;
  }

  if (profile.status === 'pending') {
    res.status(403).json({
      error: 'pending',
      profile: {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        role: profile.role,
        status: profile.status,
      },
    });
    return;
  }

  if (profile.status !== 'active') {
    res.status(403).json({ error: 'disabled', status: profile.status });
    return;
  }

  const role = profile.role === 'admin' ? 'admin' : 'staff';
  const displayName =
    normalizeDisplayName(body.display_name) ||
    normalizeDisplayName(profile.display_name) ||
    normalizeDisplayName(user.email?.split('@')[0]) ||
    'User';

  const token = await createAuthToken(secret, role);
  const flag = secureFlag();
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${flag} SameSite=Lax; Max-Age=${MAX_AGE}`,
    `${DISPLAY_NAME_COOKIE}=${encodeURIComponent(displayName)}; Path=/;${flag} SameSite=Lax; Max-Age=${MAX_AGE}`,
  ]);

  res.status(200).json({
    ok: true,
    role,
    redirect: role === 'staff' ? '/app/' : '/',
    profile: {
      id: profile.id,
      email: profile.email,
      display_name: displayName,
      role,
      status: profile.status,
    },
  });
}
