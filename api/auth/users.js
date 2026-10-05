import {
  getUserFromAccessToken,
  getProfileById,
  updateProfile,
  createUserWithPassword,
  findUserByEmail,
  ensureProfile,
  adminUpdateUser,
  adminDeleteUser,
  countActiveOrgAdmins,
  countActiveOrgSysadmins,
  listOrgProfiles,
  listMembershipsForProfile,
  upsertMembership,
  removeMembership,
} from '../../lib/supabase-auth-admin.js';
import {
  isOrgAdminRole,
  isSysadminRole,
  normalizeRole,
} from '../../lib/access-model.js';
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
  // profiles.role mirrors the role in the active organisation.
  if (!profile || profile.status !== 'active' || !isOrgAdminRole(profile.role) || !profile.active_org_id) {
    return { error: 'forbidden', status: 403 };
  }
  return { user, profile, orgId: profile.active_org_id };
}

function callerIsSysadmin(auth) {
  return isSysadminRole(auth?.profile?.role);
}

/** Admins get a not-found for sysadmin accounts so the role stays hidden. */
function hiddenSysadmin(auth, memberRole) {
  return memberRole === 'sysadmin' && !callerIsSysadmin(auth);
}

/**
 * Resolve a target profile's relationship to the admin's organisation.
 * @returns {Promise<{ member: { role: string } | null, otherOrgs: number, unassigned: boolean }>}
 */
async function orgRelation(orgId, profileId) {
  const memberships = await listMembershipsForProfile(profileId);
  const member = memberships.find((m) => m.org_id === orgId) || null;
  return {
    member,
    otherOrgs: memberships.filter((m) => m.org_id !== orgId).length,
    unassigned: memberships.length === 0,
  };
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function assertNotLastAdmin(orgId, target, memberRole, nextRole, nextStatus) {
  const role = nextRole != null ? normalizeRole(nextRole) : memberRole;
  const status = nextStatus != null ? nextStatus : target.status;

  const wasActiveAdmin = memberRole === 'admin' && target.status === 'active';
  const stillActiveAdmin = role === 'admin' && status === 'active';
  if (wasActiveAdmin && !stillActiveAdmin) {
    const admins = await countActiveOrgAdmins(orgId);
    if (admins <= 1) {
      const sysadmins = await countActiveOrgSysadmins(orgId);
      if (sysadmins < 1) {
        return { error: 'last_admin', message: 'Cannot remove or demote the last active admin', status: 400 };
      }
    }
  }

  const wasActiveSysadmin = memberRole === 'sysadmin' && target.status === 'active';
  const stillActiveSysadmin = role === 'sysadmin' && status === 'active';
  if (wasActiveSysadmin && !stillActiveSysadmin) {
    const sysadmins = await countActiveOrgSysadmins(orgId);
    if (sysadmins <= 1) {
      return { error: 'last_sysadmin', message: 'Cannot remove the last sysadmin', status: 400 };
    }
  }
  return null;
}

/**
 * Ensure auth user + active profile, return app-owned onboard link.
 */
async function createAppInvite({ orgId, email, role, meta, secret, onboardUrl }) {
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
    role: normalizeRole(role),
    status: 'active',
  });
  await updateProfile(userId, { status: 'active', email });
  await upsertMembership(orgId, userId, normalizeRole(role));

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
      let profiles = await listOrgProfiles(auth.orgId);
      if (!callerIsSysadmin(auth)) {
        profiles = profiles.filter((profile) => profile.role !== 'sysadmin');
      }
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
      const rel = await orgRelation(auth.orgId, id);
      if (!rel.member && !rel.unassigned) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (hiddenSysadmin(auth, rel.member?.role)) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      // Identity-level changes (password, email, account status) affect every
      // organisation the user belongs to, so only allow them for single-org users.
      const sharedIdentity = rel.otherOrgs > 0;

      // Password reset: set (or generate) a temporary password via Auth Admin.
      if (body.reset_password === true || body.password != null) {
        if (id === auth.user.id) {
          res.status(400).json({
            error: 'cannot_reset_self',
            message: 'Use account settings to change your own password',
          });
          return;
        }
        if (sharedIdentity) {
          res.status(409).json({
            error: 'shared_identity',
            message: 'This user belongs to other organisations; they must reset their own password',
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
      /** @type {string|undefined} */
      let nextRole;
      if (body.status != null) {
        const status = String(body.status);
        if (!['pending', 'active', 'disabled'].includes(status)) {
          res.status(400).json({ error: 'invalid_status' });
          return;
        }
        patch.status = status;
      }
      if (body.role != null) {
        const role = normalizeRole(body.role);
        if (!['sysadmin', 'admin', 'manager', 'user'].includes(String(body.role)) && String(body.role) !== 'staff') {
          res.status(400).json({ error: 'invalid_role' });
          return;
        }
        if (role === 'sysadmin' && !callerIsSysadmin(auth)) {
          res.status(400).json({ error: 'invalid_role' });
          return;
        }
        nextRole = role;
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

      if (!Object.keys(patch).length && !nextRole) {
        res.status(400).json({ error: 'empty_patch' });
        return;
      }

      if (sharedIdentity && (patch.status != null || patch.email != null)) {
        res.status(409).json({
          error: 'shared_identity',
          message: 'This user belongs to other organisations; remove them from this organisation instead',
        });
        return;
      }

      if (id === auth.user.id) {
        if ((nextRole && nextRole !== normalizeRole(auth.profile.role)) || (patch.status && patch.status !== 'active')) {
          res.status(400).json({
            error: 'cannot_demote_self',
            message: 'You cannot demote or disable your own account',
          });
          return;
        }
      }

      const guard = await assertNotLastAdmin(
        auth.orgId,
        before,
        rel.member?.role,
        nextRole,
        /** @type {string|undefined} */ (patch.status),
      );
      if (guard) {
        res.status(guard.status).json({ error: guard.error, message: guard.message });
        return;
      }

      // Approving an unassigned signup adds them to this organisation.
      const memberRole = nextRole || normalizeRole(rel.member?.role || 'user');
      if (nextRole || (!rel.member && patch.status === 'active')) {
        await upsertMembership(auth.orgId, id, memberRole);
      }

      if (nextEmail && nextEmail !== String(before.email || '').toLowerCase()) {
        const existing = await findUserByEmail(nextEmail);
        if (existing && existing.id !== id) {
          res.status(409).json({ error: 'email_taken', message: 'Another account already uses that email' });
          return;
        }
        await adminUpdateUser(id, { email: nextEmail, email_confirm: true });
      }

      const updated = Object.keys(patch).length
        ? await updateProfile(id, patch)
        : await getProfileById(id);
      if (!updated) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (rel.member || patch.status === 'active') updated.role = memberRole;

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

      const rel = await orgRelation(auth.orgId, id);
      if (!rel.member && !rel.unassigned) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (hiddenSysadmin(auth, rel.member?.role)) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      const guard = await assertNotLastAdmin(auth.orgId, before, rel.member?.role, 'user', 'disabled');
      if (guard) {
        res.status(guard.status).json({ error: guard.error, message: guard.message });
        return;
      }

      if (rel.otherOrgs > 0) {
        await removeMembership(auth.orgId, id);
        res.status(200).json({ ok: true, deleted: false, removed_from_org: true, id });
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
      const requested = body.role == null ? 'user' : String(body.role);
      if (!['sysadmin', 'admin', 'manager', 'user', 'staff'].includes(requested)) {
        res.status(400).json({ error: 'invalid_role' });
        return;
      }
      const role = normalizeRole(requested);
      if (role === 'sysadmin' && !callerIsSysadmin(auth)) {
        res.status(400).json({ error: 'invalid_role' });
        return;
      }
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
          await updateProfile(userId, { status: 'active', email });
          await upsertMembership(auth.orgId, userId, role);
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
        orgId: auth.orgId,
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
