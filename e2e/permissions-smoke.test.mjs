/**
 * Live permission smoke test against the dev preview and its Supabase project.
 *
 * Creates (or reuses) three accounts in the signed-in admin's organisation:
 *   perm-smoke-user@measured.events
 *   perm-smoke-manager@measured.events
 *   perm-smoke-admin@measured.events
 *
 * Run from the repo root:
 *   PERM_SMOKE=1 node --test e2e/permissions-smoke.test.mjs
 *
 * Reads e2e/.env (E2E_EMAIL, E2E_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY).
 * Writes the latest passwords to e2e/.perm-smoke.json (gitignored).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allFeatureKeys, defaultEnabled, needsDesktopShell } from '../lib/access-model.js';

function loadDotEnv(file) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv(new URL('./.env', import.meta.url));

const BASE = (process.env.PERM_BASE_URL || 'https://measured-stock-git-dev-measuredevents.vercel.app').replace(/\/$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || '';
const LIVE = process.env.PERM_SMOKE === '1' && process.env.E2E_EMAIL && process.env.E2E_PASSWORD && SUPABASE_URL && ANON;

const ACCOUNTS = [
  { role: 'user', email: 'perm-smoke-user@measured.events', name: 'Perm user' },
  { role: 'manager', email: 'perm-smoke-manager@measured.events', name: 'Perm manager' },
  { role: 'admin', email: 'perm-smoke-admin@measured.events', name: 'Perm admin' },
];

function password() {
  return `Perm-${randomBytes(9).toString('base64url')}`;
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function cookieHeader(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function signIn(email, secret) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: secret }),
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(`sign-in ${email} ${res.status}: ${data.error_description || data.msg || data.message || data.error || ''}`);
  }
  return data.access_token;
}

async function openSession(token) {
  const res = await fetch(`${BASE}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token }),
  });
  const data = await readJson(res);
  return { status: res.status, data, cookie: cookieHeader(res) };
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await readJson(res);
  return { status: res.status, data };
}

function restHeaders(token, extra = {}) {
  return {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function hasFeature(token, feature) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_feature`, {
    method: 'POST',
    headers: restHeaders(token),
    body: JSON.stringify({ p_feature: feature }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(`has_feature ${feature} ${res.status}: ${JSON.stringify(data)}`);
  return data === true;
}

async function rest(token, method, path, body, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: restHeaders(token, prefer ? { Prefer: prefer } : {}),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await readJson(res);
  return { status: res.status, ok: res.ok, data };
}

function assertDenied(result, label) {
  assert.ok(
    result.status === 401 || result.status === 403,
    `${label} should be denied, got ${result.status}: ${JSON.stringify(result.data)}`,
  );
}

async function ensureAccount(adminToken, account, secret) {
  const listed = await api(adminToken, 'GET', '/api/auth/users');
  assert.equal(listed.status, 200, JSON.stringify(listed.data));
  const existing = (listed.data.profiles || []).find(
    (profile) => String(profile.email || '').toLowerCase() === account.email,
  );
  if (!existing) {
    const created = await api(adminToken, 'POST', '/api/auth/users', {
      email: account.email,
      role: account.role,
      mode: 'password',
      password: secret,
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = created.data.user?.id || created.data.user?.user?.id;
    assert.ok(id, `create ${account.email} returned no id`);
    const named = await api(adminToken, 'PATCH', '/api/auth/users', {
      id,
      display_name: account.name,
      role: account.role,
      status: 'active',
    });
    assert.equal(named.status, 200, JSON.stringify(named.data));
    return id;
  }
  const named = await api(adminToken, 'PATCH', '/api/auth/users', {
    id: existing.id,
    display_name: account.name,
    role: account.role,
    status: 'active',
  });
  assert.equal(named.status, 200, JSON.stringify(named.data));
  const reset = await api(adminToken, 'PATCH', '/api/auth/users', {
    id: existing.id,
    password: secret,
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  return existing.id;
}

describe('live access permissions', { skip: !LIVE, timeout: 180000 }, () => {
  /** @type {Map<string, { token: string, session: any, cookie: string, password: string, id: string }>} */
  const actors = new Map();
  let orgId = '';

  test('creates a user, manager, and admin and signs them in', async () => {
    const adminPassword = process.env.E2E_PASSWORD;
    const ownerToken = await signIn(process.env.E2E_EMAIL, adminPassword);
    const ownerSession = await openSession(ownerToken);
    assert.equal(ownerSession.status, 200, JSON.stringify(ownerSession.data));
    orgId = ownerSession.data.profile?.active_org_id || '';
    assert.ok(orgId, 'owner has no active organisation');
    actors.set('sysadmin', {
      token: ownerToken,
      session: ownerSession.data,
      cookie: ownerSession.cookie,
      password: adminPassword,
      id: ownerSession.data.profile.id,
    });

    const secrets = {};
    for (const account of ACCOUNTS) {
      const secret = password();
      secrets[account.email] = secret;
      const id = await ensureAccount(ownerToken, account, secret);
      const token = await signIn(account.email, secret);
      const session = await openSession(token);
      assert.equal(session.status, 200, `${account.role} session ${JSON.stringify(session.data)}`);
      assert.equal(session.data.role, account.role);
      assert.equal(session.data.profile.role, account.role);
      assert.equal(session.data.profile.active_org_id, orgId);
      actors.set(account.role, {
        token,
        session: session.data,
        cookie: session.cookie,
        password: secret,
        id,
      });
    }

    writeFileSync(new URL('./.perm-smoke.json', import.meta.url), JSON.stringify({
      base: BASE,
      orgId,
      accounts: ACCOUNTS.map((account) => ({
        ...account,
        password: secrets[account.email],
        id: actors.get(account.role).id,
      })),
    }, null, 2));
  });

  test('session grants and has_feature match the default grid', async () => {
    const features = allFeatureKeys();
    for (const role of ['user', 'manager', 'admin']) {
      const actor = actors.get(role);
      const own = (actor.session.profile.permissions || []).filter((row) => row.role === role);
      assert.equal(own.length, features.length, `${role} session is missing grants`);
      for (const feature of features) {
        const row = own.find((grant) => grant.feature === feature);
        const expected = defaultEnabled(role, feature);
        assert.equal(!!row.enabled, expected, `${role} ${feature} session grant`);
        const live = await hasFeature(actor.token, feature);
        assert.equal(live, expected, `${role} ${feature} has_feature`);
      }
      const shell = needsDesktopShell(role, own) ? 'desktop' : 'field';
      assert.equal(actor.session.redirect, shell === 'field' ? '/app/' : '/');
    }

    const adminGrants = actors.get('admin').session.profile.permissions || [];
    assert.ok(adminGrants.some((row) => row.role === 'manager'));
    assert.ok(adminGrants.some((row) => row.role === 'user'));
    const userGrants = actors.get('user').session.profile.permissions || [];
    assert.equal(userGrants.some((row) => row.role !== 'user'), false);
  });

  test('middleware keeps a field user out of the desktop and lets managers in', async () => {
    async function probe(role, path) {
      const res = await fetch(`${BASE}${path}`, {
        redirect: 'manual',
        headers: { cookie: actors.get(role).cookie },
      });
      return { status: res.status, location: res.headers.get('location') || '' };
    }

    const userHome = await probe('user', '/');
    assert.equal(userHome.status, 302);
    assert.match(userHome.location, /\/app\/?$/);

    const userAccess = await probe('user', '/settings/access');
    assert.equal(userAccess.status, 302);
    assert.match(userAccess.location, /\/app\/?$/);

    const managerAccess = await probe('manager', '/settings/access');
    assert.equal(managerAccess.status, 200);

    const adminAccess = await probe('admin', '/settings/access');
    assert.equal(adminAccess.status, 200);

    const anon = await fetch(`${BASE}/settings/access`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.match(anon.headers.get('location') || '', /\/login/);
  });

  test('user management follows the role', async () => {
    const userCall = await api(actors.get('user').token, 'GET', '/api/auth/users');
    assertDenied(userCall, 'user list');
    const managerCall = await api(actors.get('manager').token, 'GET', '/api/auth/users');
    assertDenied(managerCall, 'manager list');

    const adminList = await api(actors.get('admin').token, 'GET', '/api/auth/users');
    assert.equal(adminList.status, 200, JSON.stringify(adminList.data));
    const emails = (adminList.data.profiles || []).map((profile) => String(profile.email || '').toLowerCase());
    assert.equal(emails.includes('charlie@measured.events'), false);
    assert.equal(emails.includes('perm-smoke-user@measured.events'), true);
    assert.equal((adminList.data.profiles || []).some((profile) => profile.role === 'sysadmin'), false);

    const promote = await api(actors.get('admin').token, 'POST', '/api/auth/users', {
      email: 'perm-smoke-sysadmin@measured.events',
      role: 'sysadmin',
      mode: 'password',
      password: password(),
    });
    assert.equal(promote.status, 400, JSON.stringify(promote.data));
    assert.equal(promote.data.error, 'invalid_role');
  });

  test('grant writes follow the grid, including the admin lock', async () => {
    const userWrite = await rest(
      actors.get('user').token,
      'POST',
      'organisation_role_permissions?on_conflict=org_id,role,feature',
      [{ org_id: orgId, role: 'user', feature: 'stock.transfers', enabled: true }],
      'resolution=merge-duplicates,return=representation',
    );
    assertDenied(userWrite, 'user grant write');

    const managerWrite = await rest(
      actors.get('manager').token,
      'POST',
      'organisation_role_permissions?on_conflict=org_id,role,feature',
      [{ org_id: orgId, role: 'user', feature: 'stock.transfers', enabled: true }],
      'resolution=merge-duplicates,return=representation',
    );
    assertDenied(managerWrite, 'manager grant write');

    const devWrite = await rest(
      actors.get('admin').token,
      'POST',
      'organisation_role_permissions?on_conflict=org_id,role,feature',
      [{ org_id: orgId, role: 'manager', feature: 'dev.bugs', enabled: true }],
      'resolution=merge-duplicates,return=representation',
    );
    assertDenied(devWrite, 'admin developer grant');

    const lockedFeatures = ['workspace.users', 'workspace.access'];
    const restoreLock = async () => {
      for (const feature of lockedFeatures) {
        await rest(
          actors.get('sysadmin').token,
          'POST',
          'organisation_role_permissions?on_conflict=org_id,role,feature',
          [{ org_id: orgId, role: 'admin', feature, enabled: true }],
          'resolution=merge-duplicates,return=representation',
        );
      }
    };
    try {
      for (const feature of lockedFeatures) {
        const locked = await rest(
          actors.get('admin').token,
          'POST',
          'organisation_role_permissions?on_conflict=org_id,role,feature',
          [{ org_id: orgId, role: 'admin', feature, enabled: false }],
          'resolution=merge-duplicates,return=representation',
        );
        assertDenied(locked, `admin lock ${feature}`);
        assert.equal(await hasFeature(actors.get('admin').token, feature), true);
      }
    } finally {
      await restoreLock();
    }

    const userGrants = await rest(
      actors.get('user').token,
      'GET',
      'organisation_role_permissions?role=eq.manager&select=role,feature,enabled',
    );
    assert.equal(userGrants.ok, true, JSON.stringify(userGrants.data));
    assert.deepEqual(userGrants.data, []);
  });

  test('turning Library on moves a user to the desktop, then back', async () => {
    const feature = 'home.library';
    const adminToken = actors.get('admin').token;
    try {
      const on = await rest(
        adminToken,
        'POST',
        'organisation_role_permissions?on_conflict=org_id,role,feature',
        [{ org_id: orgId, role: 'user', feature, enabled: true }],
        'resolution=merge-duplicates,return=representation',
      );
      assert.equal(on.ok, true, JSON.stringify(on.data));
      assert.equal(await hasFeature(actors.get('user').token, feature), true);

      const desktop = await openSession(actors.get('user').token);
      assert.equal(desktop.status, 200);
      assert.equal(desktop.data.redirect, '/');
      const home = await fetch(`${BASE}/`, {
        redirect: 'manual',
        headers: { cookie: desktop.cookie },
      });
      assert.equal(home.status, 200);
    } finally {
      const off = await rest(
        adminToken,
        'POST',
        'organisation_role_permissions?on_conflict=org_id,role,feature',
        [{ org_id: orgId, role: 'user', feature, enabled: false }],
        'resolution=merge-duplicates,return=representation',
      );
      assert.equal(off.ok, true, JSON.stringify(off.data));
      assert.equal(await hasFeature(actors.get('user').token, feature), false);
      const field = await openSession(actors.get('user').token);
      assert.equal(field.data.redirect, '/app/');
    }
  });

  test('catalogue writes follow Products, Categories, and Case sizes', async () => {
    const stamp = Date.now();
    const cases = [
      {
        role: 'user',
        table: 'products',
        body: { name: `[PERM] product ${stamp}`, org_id: orgId },
        allow: false,
      },
      {
        role: 'manager',
        table: 'products',
        body: { name: `[PERM] product ${stamp}`, org_id: orgId },
        allow: true,
      },
      {
        role: 'manager',
        table: 'categories',
        body: { name: `[PERM] category ${stamp}`, org_id: orgId },
        allow: false,
      },
      {
        role: 'admin',
        table: 'categories',
        body: { name: `[PERM] category ${stamp}`, org_id: orgId },
        allow: true,
      },
      {
        role: 'manager',
        table: 'case_sizes',
        body: { label: `[PERM] case ${stamp}`, org_id: orgId },
        allow: false,
      },
      {
        role: 'admin',
        table: 'case_sizes',
        body: { label: `[PERM] case ${stamp}`, org_id: orgId },
        allow: true,
      },
    ];

    for (const item of cases) {
      const inserted = await rest(
        actors.get(item.role).token,
        'POST',
        item.table,
        [item.body],
        'return=representation',
      );
      if (!item.allow) {
        assertDenied(inserted, `${item.role} insert ${item.table}`);
        continue;
      }
      assert.equal(inserted.ok, true, `${item.role} insert ${item.table}: ${JSON.stringify(inserted.data)}`);
      const id = inserted.data?.[0]?.id;
      assert.ok(id, `${item.table} insert returned no id`);
      const removed = await rest(
        actors.get(item.role).token,
        'DELETE',
        `${item.table}?id=eq.${id}`,
      );
      assert.equal(removed.ok, true, `delete ${item.table}: ${JSON.stringify(removed.data)}`);
    }
  });
});
