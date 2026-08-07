import {
  getUserFromAccessToken,
  getProfileById,
  listProfiles,
  updateProfile,
  createUserWithPassword,
  findUserByEmail,
  ensureProfile,
  adminUpdateUser,
  adminDeleteUser,
  countActiveAdmins,
} from '../../lib/supabase-auth-admin.js';
import { sendAccountApprovedEmail } from '../../lib/postmark.js';
import { appLoginUrl, appOnboardUrl } from '../../lib/app-url.js';
import { createInviteToken } from '../../lib/invite-token.js';

/** @param {import('http').IncomingMessage} req */
function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

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

async function requireAdmin(req) {
  const token = bearerToken(req);
  const user = await getUserFromAccessToken(token);
  if (!user) return { error: 'unauthorized', status: 401 };
  const profile = await getProfileById(user.id);
  if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
    return { error: 'forbidden', status: 403 };
  }
  return { user, profile };
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function assertNotLastAdmin(target, nextRole, nextStatus) {
  const wasActiveAdmin = target.role === 'admin' && target.status === 'active';
  if (!wasActiveAdmin) return null;

  const role = nextRole != null ? nextRole : target.role;
  const status = nextStatus != null ? nextStatus : target.status;
  const stillActiveAdmin = role === 'admin' && status === 'active';
  if (stillActiveAdmin) return null;

  const admins = await countActiveAdmins();
  if (admins <= 1) {
    return { error: 'last_admin', message: 'Cannot remove or demote the last active admin', status: 400 };
  }
  return null;
}

/**
 * Ensure auth user + active profile, return app-owned onboard link.
 */
async function createAppInvite({ email, role, meta, secret, onboardUrl }) {
  let userId = null;
  try {
    const created = await createUserWithPassword(email, randomPassword(), { data: meta || {} });
    userId = created?.id || created?.user?.id || null;
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/already|exists|registered/i.test(msg)) throw err;
    const existing = await findUserByEmail(email);
    userId = existing?.id || null;
    if (!userId) throw err;
  }
  if (!userId) throw new Error('create_failed');

  await ensureProfile(userId, {
    email,
    display_name: email.split('@')[0],
    role: role === 'admin' ? 'admin' : 'staff',
    status: 'active',
  });
  await updateProfile(userId, {
    role: role === 'admin' ? 'admin' : 'staff',
    status: 'active',
    email,
  });

  const token = await createInviteToken(secret, { userId, email, role });
  return {
    userId,
    email,
    setup_link: `${onboardUrl}?invite=${encodeURIComponent(token)}`,
  };
}

/**
 * Admin user management (no Supabase verify URLs).
 * GET / PATCH / POST / DELETE
 */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const auth = await requireAdmin(req);
  if (auth.error) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    if (req.method === 'GET') {
      const profiles = await listProfiles();
      res.status(200).json({ profiles });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const id = String(body.id || '').trim();
      if (!id) {
        res.status(400).json({ error: 'id_required' });
        return;
      }

      const before = await getProfileById(id);
      if (!before) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      // Password reset: set (or generate) a temporary password via Auth Admin.
      if (body.reset_password === true || body.password != null) {
        if (id === auth.user.id) {
          res.status(400).json({
            error: 'cannot_reset_self',
            message: 'Use account settings to change your own password',
          });
          return;
        }
        const password = String(body.password || '').trim() || randomPassword().slice(0, 16);
        if (password.length < 8) {
          res.status(400).json({ error: 'password_too_short' });
          return;
        }
        await adminUpdateUser(id, { password });
        res.status(200).json({
          ok: true,
          profile: before,
          temporary_password: password,
          login_url: appLoginUrl(req),
        });
        return;
      }

      /** @type {Record<string, unknown>} */
      const patch = {};
      if (body.status != null) {
        const status = String(body.status);
        if (!['pending', 'active', 'disabled'].includes(status)) {
          res.status(400).json({ error: 'invalid_status' });
          return;
        }
        patch.status = status;
      }
      if (body.role != null) {
        const role = String(body.role);
        if (!['admin', 'staff'].includes(role)) {
          res.status(400).json({ error: 'invalid_role' });
          return;
        }
        patch.role = role;
      }
      if (body.display_name != null) {
        patch.display_name = String(body.display_name).trim().slice(0, 40) || null;
      }

      let nextEmail = null;
      if (body.email != null) {
        nextEmail = String(body.email).trim().toLowerCase();
        if (!nextEmail || !nextEmail.includes('@')) {
          res.status(400).json({ error: 'invalid_email' });
          return;
        }
        patch.email = nextEmail;
      }

      if (!Object.keys(patch).length) {
        res.status(400).json({ error: 'empty_patch' });
        return;
      }

      if (id === auth.user.id) {
        if (patch.role === 'staff' || (patch.status && patch.status !== 'active')) {
          res.status(400).json({
            error: 'cannot_demote_self',
            message: 'You cannot demote or disable your own account',
          });
          return;
        }
      }

      const guard = await assertNotLastAdmin(
        before,
        /** @type {string|undefined} */ (patch.role),
        /** @type {string|undefined} */ (patch.status),
      );
      if (guard) {
        res.status(guard.status).json({ error: guard.error, message: guard.message });
        return;
      }

      if (nextEmail && nextEmail !== String(before.email || '').toLowerCase()) {
        const existing = await findUserByEmail(nextEmail);
        if (existing && existing.id !== id) {
          res.status(409).json({ error: 'email_taken', message: 'Another account already uses that email' });
          return;
        }
        await adminUpdateUser(id, { email: nextEmail, email_confirm: true });
      }

      const updated = await updateProfile(id, patch);
      if (!updated) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (
        before?.status !== 'active' &&
        updated.status === 'active' &&
        updated.email &&
        process.env.POSTMARK_SERVER_TOKEN
      ) {
        try {
          await sendAccountApprovedEmail({
            to: updated.email,
            displayName: updated.display_name,
            loginUrl: appLoginUrl(req),
          });
        } catch (err) {
          console.error('postmark account-approved failed', err);
        }
      }

      res.status(200).json({
        profile: updated,
        login_url: appLoginUrl(req),
      });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readJsonBody(req).catch(() => ({}));
      const urlId = (() => {
        try {
          const u = new URL(req.url || '', 'http://localhost');
          return String(u.searchParams.get('id') || '').trim();
        } catch {
          return '';
        }
      })();
      const id = String(body.id || urlId || '').trim();
      if (!id) {
        res.status(400).json({ error: 'id_required' });
        return;
      }
      if (id === auth.user.id) {
        res.status(400).json({
          error: 'cannot_delete_self',
          message: 'You cannot delete your own account',
        });
        return;
      }

      const before = await getProfileById(id);
      if (!before) {
        // Still try auth delete in case profile is missing
        await adminDeleteUser(id);
        res.status(200).json({ ok: true, deleted: true });
        return;
      }

      const guard = await assertNotLastAdmin(before, 'staff', 'disabled');
      if (guard) {
        res.status(guard.status).json({ error: guard.error, message: guard.message });
        return;
      }

      await adminDeleteUser(id);
      res.status(200).json({ ok: true, deleted: true, id });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'invalid_email' });
        return;
      }
      const role = body.role === 'admin' ? 'admin' : 'staff';
      const mode = body.mode === 'password' ? 'password' : 'link';
      const loginUrl = appLoginUrl(req);
      const onboardUrl = appOnboardUrl(req);
      const meta = { invited_by: auth.profile.email || auth.user.id };
      const secret = process.env.COOKIE_SECRET?.trim();

      if (mode === 'password') {
        const password = String(body.password || '').trim() || randomPassword().slice(0, 24);
        if (password.length < 8) {
          res.status(400).json({ error: 'password_too_short' });
          return;
        }
        const created = await createUserWithPassword(email, password, { data: meta });
        const userId = created?.id || created?.user?.id;
        if (userId) {
          await updateProfile(userId, { role, status: 'active', email });
        }
        res.status(200).json({
          ok: true,
          mode: 'password',
          user: created,
          email,
          temporary_password: password,
          login_url: loginUrl,
        });
        return;
      }

      if (!secret) {
        res.status(503).json({ error: 'not_configured', message: 'COOKIE_SECRET required for invites' });
        return;
      }

      const invited = await createAppInvite({
        email,
        role,
        meta,
        secret,
        onboardUrl,
      });

      res.status(200).json({
        ok: true,
        mode: 'link',
        email: invited.email,
        setup_link: invited.setup_link,
        onboard_url: onboardUrl,
        login_url: loginUrl,
        hint: 'Share this Measured Stock link. They set their own password — no Supabase URL.',
      });
      return;
    }

    res.setHeader('Allow', 'GET, PATCH, POST, DELETE');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('api/auth/users', err);
    res.status(500).json({ error: 'server_error', message: String(err?.message || err) });
  }
}
