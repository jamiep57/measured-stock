import {
  adminUpdateUser,
  updateProfile,
  ensureProfile,
} from '../../lib/supabase-auth-admin.js';
import { verifyInviteToken } from '../../lib/invite-token.js';
import { normalizeDisplayName } from '../../lib/cookie.js';
import { appLoginUrl } from '../../lib/app-url.js';

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

/**
 * App-owned invite accept (no Supabase verify URL).
 * GET  ?invite=… → { email, role }
 * POST { invite, password, display_name } → sets password; client then signs in
 */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.COOKIE_SECRET?.trim();
  if (!secret) {
    res.status(503).json({ error: 'not_configured' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const invite = url.searchParams.get('invite') || '';
      const payload = await verifyInviteToken(secret, invite);
      if (!payload) {
        res.status(400).json({ error: 'invalid_invite' });
        return;
      }
      res.status(200).json({
        email: payload.email,
        role: payload.role,
        login_url: appLoginUrl(req),
      });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const body = await readJsonBody(req);
    const invite = String(body.invite || '').trim();
    const password = String(body.password || '');
    const displayName = normalizeDisplayName(body.display_name);

    const payload = await verifyInviteToken(secret, invite);
    if (!payload) {
      res.status(400).json({
        error: 'invalid_invite',
        message: 'Invite link is invalid or expired.',
      });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'password_too_short' });
      return;
    }
    if (!displayName) {
      res.status(400).json({ error: 'name_required' });
      return;
    }

    await adminUpdateUser(payload.userId, {
      password,
      email_confirm: true,
      user_metadata: {
        full_name: displayName,
        name: displayName,
      },
    });

    await ensureProfile(payload.userId, {
      email: payload.email,
      display_name: displayName,
      role: payload.role,
      status: 'active',
    });
    await updateProfile(payload.userId, {
      display_name: displayName,
      status: 'active',
      role: payload.role,
      email: payload.email,
    });

    res.status(200).json({
      ok: true,
      email: payload.email,
      display_name: displayName,
      login_url: appLoginUrl(req),
    });
  } catch (err) {
    console.error('api/auth/accept-invite', err);
    res.status(500).json({ error: 'server_error', message: String(err?.message || err) });
  }
}
