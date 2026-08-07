/**
 * Signed invite tokens for /onboard?invite=… (app-owned, not Supabase verify URLs).
 */

const VERSION = 'inv1';
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

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
 * @param {{ userId: string, email: string, role?: string }} payload
 * @param {number} [ttlSec]
 */
export async function createInviteToken(secret, payload, ttlSec = DEFAULT_TTL_SEC) {
  if (!secret) throw new Error('invite-token: secret required');
  const body = b64urlEncode(JSON.stringify({
    uid: payload.userId,
    email: String(payload.email || '').trim().toLowerCase(),
    role: payload.role === 'admin' ? 'admin' : 'staff',
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  }));
  const sig = await hmac(secret, body);
  return `${VERSION}.${body}.${sig}`;
}

/**
 * @param {string} secret
 * @param {string} token
 * @returns {Promise<{ userId: string, email: string, role: 'admin'|'staff' } | null>}
 */
export async function verifyInviteToken(secret, token) {
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, sig] = parts;
  const expected = await hmac(secret, body);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = new TextDecoder().decode(b64urlDecode(body));
    const payload = JSON.parse(json);
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.uid || !payload.email) return null;
    return {
      userId: String(payload.uid),
      email: String(payload.email).toLowerCase(),
      role: payload.role === 'admin' ? 'admin' : 'staff',
    };
  } catch {
    return null;
  }
}
