// =====================================================================
// supabase-auth-admin.js — Auth Admin API (service role)
// =====================================================================
// Server-only helpers for verifying access tokens and inviting users.
// =====================================================================

const URL = (
  process.env.SYNC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const KEY =
  process.env.SYNC_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

function assertEnv() {
  if (!URL || !KEY) {
    throw new Error(
      'supabase-auth-admin: SUPABASE_URL and service-role key must be set'
    );
  }
}

function serviceHeaders(extra) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

/**
 * Validate a user access token via Auth API.
 * @param {string} accessToken
 * @returns {Promise<{ id: string, email?: string, user_metadata?: Record<string, unknown> } | null>}
 */
export async function getUserFromAccessToken(accessToken) {
  assertEnv();
  const token = String(accessToken || '').trim();
  if (!token) return null;

  const res = await fetch(`${URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: ANON || KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id) return null;
  return user;
}

/**
 * Load a profiles row by user id (service role; bypasses RLS).
 * @param {string} userId
 */
export async function getProfileById(userId) {
  assertEnv();
  const id = encodeURIComponent(String(userId));
  const res = await fetch(
    `${URL}/rest/v1/profiles?id=eq.${id}&select=*&limit=1`,
    { method: 'GET', headers: serviceHeaders() }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`getProfileById ${res.status}: ${body}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * @param {string} userId
 * @param {Record<string, unknown>} patch
 */
export async function updateProfile(userId, patch) {
  assertEnv();
  const id = encodeURIComponent(String(userId));
  const res = await fetch(`${URL}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: serviceHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`updateProfile ${res.status}: ${body}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * List all profiles (admin).
 */
export async function listProfiles() {
  assertEnv();
  const res = await fetch(
    `${URL}/rest/v1/profiles?select=*&order=created_at.desc`,
    { method: 'GET', headers: serviceHeaders() }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`listProfiles ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * True when no active admin exists — first-run setup wizard may run.
 */
export async function needsBootstrap() {
  assertEnv();
  const res = await fetch(
    `${URL}/rest/v1/profiles?select=id&role=eq.admin&status=eq.active&limit=1`,
    { method: 'GET', headers: serviceHeaders({ Prefer: 'count=exact' }) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`needsBootstrap ${res.status}: ${body}`);
  }
  const range = res.headers.get('content-range');
  // content-range: 0-0/1 or */0
  if (range && /\/(\d+)\s*$/.test(range)) {
    const total = Number(RegExp.$1);
    return total === 0;
  }
  const rows = await res.json().catch(() => []);
  return !Array.isArray(rows) || rows.length === 0;
}

/**
 * Promote an existing profile to active admin (service role).
 * Creates the profile row if the auth trigger has not run yet.
 * @param {string} userId
 * @param {{ email?: string, display_name?: string }} [extra]
 */
/**
 * Insert profile if missing (auth trigger race), otherwise return existing.
 * @param {string} userId
 * @param {{ email?: string, display_name?: string, role?: string, status?: string }} [fields]
 */
export async function ensureProfile(userId, fields = {}) {
  assertEnv();
  const existing = await getProfileById(userId);
  if (existing) return existing;
  const role = fields.role === 'admin' ? 'admin' : 'staff';
  const status = ['pending', 'active', 'disabled'].includes(fields.status)
    ? fields.status
    : 'pending';
  const res = await fetch(`${URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify([{
      id: userId,
      email: fields.email || null,
      display_name: fields.display_name ? String(fields.display_name).slice(0, 40) : null,
      role,
      status,
    }]),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Concurrent trigger insert — re-read
    if (res.status === 409 || /duplicate|unique/i.test(body)) {
      return getProfileById(userId);
    }
    throw new Error(`ensureProfile insert ${res.status}: ${body}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : getProfileById(userId);
}

/**
 * Promote an existing profile to active admin (service role).
 * Creates the profile row if the auth trigger has not run yet.
 * @param {string} userId
 * @param {{ email?: string, display_name?: string }} [extra]
 */
export async function promoteToFirstAdmin(userId, extra = {}) {
  assertEnv();
  const existing = await ensureProfile(userId, {
    email: extra.email,
    display_name: extra.display_name,
    role: 'admin',
    status: 'active',
  });
  if (existing?.role === 'admin' && existing?.status === 'active') {
    return updateProfile(userId, {
      ...(extra.email ? { email: extra.email } : {}),
      ...(extra.display_name ? { display_name: String(extra.display_name).slice(0, 40) } : {}),
    }) || existing;
  }
  return updateProfile(userId, {
    role: 'admin',
    status: 'active',
    ...(extra.email ? { email: extra.email } : {}),
    ...(extra.display_name ? { display_name: String(extra.display_name).slice(0, 40) } : {}),
  });
}

/**
 * Invite a user by email (Supabase Auth invite — sends email if SMTP configured).
 * Prefer generateSetupLink when mail is not set up.
 * @param {string} email
 * @param {{ redirectTo?: string, data?: Record<string, unknown> }} [opts]
 */
export async function inviteUserByEmail(email, opts = {}) {
  assertEnv();
  const res = await fetch(`${URL}/auth/v1/invite`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email: String(email).trim(),
      data: opts.data || {},
      redirect_to: opts.redirectTo || undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.msg || body?.error_description || body?.message || `invite ${res.status}`);
  }
  return body;
}

/**
 * Create (or reuse) a user and return an action link WITHOUT sending email.
 * Uses Auth Admin generate_link (type=invite).
 * @param {string} email
 * @param {{ redirectTo?: string, data?: Record<string, unknown> }} [opts]
 * @returns {Promise<{ user: object, setup_link: string, action_link: string }>}
 */
export async function generateSetupLink(email, opts = {}) {
  assertEnv();
  // GoTrue expects redirect_to at the top level (not only under options).
  // If omitted, Supabase falls back to the project Site URL (often localhost).
  const redirectTo = opts.redirectTo || undefined;
  const res = await fetch(`${URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      type: 'invite',
      email: String(email).trim().toLowerCase(),
      redirect_to: redirectTo,
      data: opts.data || {},
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      body?.msg || body?.error_description || body?.message || `generate_link ${res.status}`
    );
  }
  const actionLink = body.action_link || body.properties?.action_link || '';
  const user = body.user || body;
  if (!actionLink) {
    throw new Error('generate_link returned no action_link');
  }
  return { user, setup_link: actionLink, action_link: actionLink, raw: body };
}

/**
 * Create a confirmed user with a password (no email). For hand-off when mail is offline.
 * @param {string} email
 * @param {string} password
 * @param {{ data?: Record<string, unknown> }} [opts]
 */
export async function createUserWithPassword(email, password, opts = {}) {
  assertEnv();
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
      user_metadata: opts.data || {},
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.msg || body?.error_description || body?.message || `createUser ${res.status}`);
  }
  return body;
}

/**
 * Find auth user by email (admin list filter).
 * @param {string} email
 */
export async function findUserByEmail(email) {
  assertEnv();
  const q = encodeURIComponent(`email:${String(email).trim().toLowerCase()}`);
  const res = await fetch(`${URL}/auth/v1/admin/users?page=1&per_page=1&email=${encodeURIComponent(String(email).trim().toLowerCase())}`, {
    method: 'GET',
    headers: serviceHeaders(),
  });
  // Fallback: some projects only support list + filter via query
  if (!res.ok) {
    const res2 = await fetch(`${URL}/auth/v1/admin/users?page=1&per_page=200`, {
      method: 'GET',
      headers: serviceHeaders(),
    });
    if (!res2.ok) return null;
    const data2 = await res2.json().catch(() => ({}));
    const users2 = data2.users || data2 || [];
    const want = String(email).trim().toLowerCase();
    return (Array.isArray(users2) ? users2 : []).find((u) => String(u.email || '').toLowerCase() === want) || null;
  }
  const data = await res.json().catch(() => ({}));
  const users = data.users || [];
  const want = String(email).trim().toLowerCase();
  if (Array.isArray(users) && users.length) {
    const exact = users.find((u) => String(u.email || '').toLowerCase() === want);
    return exact || users[0];
  }
  void q;
  return null;
}

/**
 * Set password + metadata for an existing user (admin).
 * @param {string} userId
 * @param {{ password?: string, email?: string, data?: Record<string, unknown>, email_confirm?: boolean, ban_duration?: string }} patch
 */
export async function adminUpdateUser(userId, patch) {
  assertEnv();
  const res = await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: serviceHeaders(),
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.msg || body?.error_description || body?.message || `updateUser ${res.status}`);
  }
  return body;
}

/**
 * Permanently delete an auth user (cascades to public.profiles).
 * @param {string} userId
 */
export async function adminDeleteUser(userId) {
  assertEnv();
  const res = await fetch(`${URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  });
  if (res.status === 404) return { deleted: false, not_found: true };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.msg || body?.error_description || body?.message || `deleteUser ${res.status}`);
  }
  return { deleted: true };
}

/**
 * Count active admin profiles (for last-admin guards).
 */
export async function countActiveAdmins() {
  assertEnv();
  const res = await fetch(
    `${URL}/rest/v1/profiles?select=id&role=eq.admin&status=eq.active`,
    { method: 'GET', headers: serviceHeaders({ Prefer: 'count=exact' }) }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`countActiveAdmins ${res.status}: ${body}`);
  }
  const range = res.headers.get('content-range');
  if (range && /\/(\d+)\s*$/.test(range)) {
    return Number(RegExp.$1);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

export function authAdminConfigured() {
  return !!(URL && KEY);
}

export { URL as SUPABASE_URL, ANON as SUPABASE_ANON_KEY };
