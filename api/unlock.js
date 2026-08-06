import {
  createAuthToken,
  COOKIE_NAME,
  DISPLAY_NAME_COOKIE,
  normalizeDisplayName,
} from '../lib/cookie.js';
import { timingSafeEqual } from 'crypto';

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** @param {import('http').IncomingMessage & { body?: unknown }} req */
async function readFormBody(req) {
  if (req.body != null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return /** @type {Record<string, string>} */ (req.body);
    }
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (!raw) return {};
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end();
    return;
  }

  const adminPin = process.env.STOCK_PIN?.trim();
  const staffPin = process.env.STOCK_PIN_STAFF?.trim();
  const secret = process.env.COOKIE_SECRET?.trim();
  if (!adminPin || !secret) {
    res.status(503).end('Not configured');
    return;
  }

  let body;
  try {
    body = await readFormBody(req);
  } catch {
    res.writeHead(302, { Location: '/?error=invalid' });
    res.end();
    return;
  }

  const displayName = normalizeDisplayName(body.name);
  if (!displayName) {
    res.writeHead(302, { Location: '/?error=name' });
    res.end();
    return;
  }

  const submitted = String(body.pin || '').trim();
  if (!/^\d{4}$/.test(submitted)) {
    res.writeHead(302, { Location: '/?error=invalid' });
    res.end();
    return;
  }

  const matches = (pin) => {
    if (!pin) return false;
    const a = Buffer.from(submitted);
    const b = Buffer.from(pin);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  /** @type {'admin' | 'staff' | null} */
  let role = null;
  if (matches(adminPin)) role = 'admin';
  else if (matches(staffPin)) role = 'staff';

  if (!role) {
    res.writeHead(302, { Location: '/?error=invalid' });
    res.end();
    return;
  }

  const token = await createAuthToken(secret, role);
  const secure =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secureFlag = secure ? ' Secure;' : '';
  const nameCookie = `${DISPLAY_NAME_COOKIE}=${encodeURIComponent(displayName)}; Path=/;${secureFlag} SameSite=Lax; Max-Age=${MAX_AGE}`;
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=${MAX_AGE}`,
    nameCookie,
  ]);
  // Staff land on V5 mobile; admins on V5 admin (not legacy V2).
  res.writeHead(302, { Location: role === 'staff' ? '/v5/' : '/v5/admin' });
  res.end();
}
