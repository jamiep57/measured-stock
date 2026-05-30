import { createAuthToken, COOKIE_NAME } from '../lib/cookie.js';
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

  const pin = process.env.STOCK_PIN?.trim();
  const secret = process.env.COOKIE_SECRET?.trim();
  if (!pin || !secret) {
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

  const submitted = String(body.pin || '').trim();
  if (!/^\d{4}$/.test(submitted)) {
    res.writeHead(302, { Location: '/?error=invalid' });
    res.end();
    return;
  }

  const a = Buffer.from(submitted);
  const b = Buffer.from(pin);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.writeHead(302, { Location: '/?error=invalid' });
    res.end();
    return;
  }

  const token = await createAuthToken(secret);
  const secure =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secureFlag = secure ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=${MAX_AGE}`
  );
  res.writeHead(302, { Location: '/' });
  res.end();
}
