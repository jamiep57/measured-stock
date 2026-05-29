/** @typedef {{ exp: number }} AuthPayload */

export const COOKIE_NAME = 'ms_auth';
const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(bytes) {
  const bin = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes);
  let s = '';
  for (const b of bin) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * @param {string} secret
 * @param {number} [ttlSec]
 */
export async function createAuthToken(secret, ttlSec = DEFAULT_TTL_SEC) {
  /** @type {AuthPayload} */
  const payload = { exp: Math.floor(Date.now() / 1000) + ttlSec };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${TOKEN_VERSION}.${body}.${sig}`;
}

/**
 * @param {string} secret
 * @param {string} token
 */
export async function verifyAuthToken(secret, token) {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;
  const [, body, sig] = parts;
  const expected = await hmac(secret, body);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const json = new TextDecoder().decode(b64urlDecode(body));
    /** @type {AuthPayload} */
    const payload = JSON.parse(json);
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

/** @param {string|undefined} cookieHeader */
export function getAuthCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}
