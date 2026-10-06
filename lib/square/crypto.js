import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

function keyBytes(secret) {
  return createHash('sha256').update(String(secret)).digest();
}

/** @param {string} plain @param {string} secret */
export function encryptToken(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

/** @param {string} packed @param {string} secret */
export function decryptToken(packed, secret) {
  const parts = String(packed || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Bad token payload');
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** @param {Record<string, unknown>} payload @param {string} secret @param {number} [ttlMs] */
export function signState(payload, secret, ttlMs = 15 * 60 * 1000) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + ttlMs,
  })).toString('base64url');
  const sig = createHmac('sha256', String(secret)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** @param {string} token @param {string} secret */
export function verifyState(token, secret) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = createHmac('sha256', String(secret)).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Square signs `notificationUrl + rawBody` with the webhook signature key.
 * @param {{ signature: string, notificationUrl: string, body: string, signatureKey: string }} input
 */
export function verifySquareSignature({ signature, notificationUrl, body, signatureKey }) {
  if (!signature || !notificationUrl || !signatureKey) return false;
  const expected = createHmac('sha256', signatureKey)
    .update(notificationUrl + body)
    .digest('base64');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
