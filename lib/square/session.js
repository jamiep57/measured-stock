import { getProfileById, getUserFromAccessToken } from '../supabase-auth-admin.js';
import { isOrgAdminRole } from '../access-model.js';

/** @param {import('http').IncomingMessage} req */
export function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/** @param {import('http').IncomingMessage & { body?: unknown }} req */
export async function readJsonBody(req) {
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

/** @param {import('http').IncomingMessage} req */
export async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.readableEnded && req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Signed-in user with an active organisation.
 * @param {import('http').IncomingMessage} req
 * @param {{ admin?: boolean }} [opts]
 */
export async function requireOrgProfile(req, opts = {}) {
  const user = await getUserFromAccessToken(bearerToken(req));
  if (!user) return { error: 'unauthorized', status: 401 };
  const profile = await getProfileById(user.id);
  if (!profile || profile.status !== 'active' || !profile.active_org_id) {
    return { error: 'forbidden', status: 403 };
  }
  if (opts.admin && !isOrgAdminRole(profile.role)) {
    return { error: 'forbidden', status: 403 };
  }
  return { user, profile, orgId: profile.active_org_id };
}
