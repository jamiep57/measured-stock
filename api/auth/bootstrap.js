import {
  needsBootstrap,
  createUserWithPassword,
  promoteToFirstAdmin,
  authAdminConfigured,
} from '../../lib/supabase-auth-admin.js';
import {
  createAuthToken,
  COOKIE_NAME,
  DISPLAY_NAME_COOKIE,
  normalizeDisplayName,
} from '../../lib/cookie.js';

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

const MAX_AGE = 60 * 60 * 24 * 30;

/**
 * First-admin bootstrap (only when zero active admins exist).
 * GET  → { needed: boolean }
 * POST → { email, password, display_name } creates admin + sets edge cookie
 */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (!authAdminConfigured()) {
    res.status(503).json({ error: 'not_configured', needed: false });
    return;
  }

  try {
    if (req.method === 'GET') {
      const needed = await needsBootstrap();
      res.status(200).json({ needed });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const needed = await needsBootstrap();
    if (!needed) {
      res.status(403).json({
        error: 'bootstrap_closed',
        message: 'An admin already exists. Use /login or ask an admin for a setup link.',
      });
      return;
    }

    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName =
      normalizeDisplayName(body.display_name) ||
      normalizeDisplayName(email.split('@')[0]) ||
      'Admin';

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({
        error: 'password_too_short',
        message: 'Password must be at least 8 characters.',
      });
      return;
    }

    const created = await createUserWithPassword(email, password, {
      data: { full_name: displayName, bootstrap: true },
    });
    const userId = created?.id || created?.user?.id;
    if (!userId) {
      res.status(500).json({ error: 'create_failed' });
      return;
    }

    // Auth trigger creates a pending staff profile — promote to active admin.
    await new Promise((r) => setTimeout(r, 200));
    const profile = await promoteToFirstAdmin(userId, {
      email,
      display_name: displayName,
    });

    if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
      res.status(500).json({ error: 'promote_failed' });
      return;
    }

    const secret = process.env.COOKIE_SECRET?.trim();
    if (secret) {
      const token = await createAuthToken(secret, 'admin');
      const flag = secureFlag();
      res.setHeader('Set-Cookie', [
        `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${flag} SameSite=Lax; Max-Age=${MAX_AGE}`,
        `${DISPLAY_NAME_COOKIE}=${encodeURIComponent(displayName)}; Path=/;${flag} SameSite=Lax; Max-Age=${MAX_AGE}`,
      ]);
    }

    res.status(200).json({
      ok: true,
      email,
      display_name: displayName,
      redirect: '/',
      hint: 'Your admin account is ready. Sign in with this email and password if asked.',
    });
  } catch (err) {
    console.error('api/auth/bootstrap', err);
    const msg = String(err?.message || err);
    if (/already|exists|registered/i.test(msg)) {
      res.status(409).json({
        error: 'user_exists',
        message:
          'That email already has an account. Try /login. If you are stuck pending, run promote_profile_admin in SQL.',
      });
      return;
    }
    res.status(500).json({ error: 'server_error', message: msg });
  }
}
