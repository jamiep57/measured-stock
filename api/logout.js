import { COOKIE_NAME, DISPLAY_NAME_COOKIE } from '../lib/cookie.js';

/** Clears the edge session cookie so the next request hits /login. */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  const secure =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secureFlag = secure ? ' Secure;' : '';
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=0`,
    `${DISPLAY_NAME_COOKIE}=; Path=/;${secureFlag} SameSite=Lax; Max-Age=0`,
  ]);

  if (req.method === 'GET') {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }
  res.status(204).end();
}
