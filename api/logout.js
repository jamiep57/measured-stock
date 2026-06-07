import { COOKIE_NAME } from '../lib/cookie.js';

/** Clears the auth cookie so the next request hits the PIN gate again. */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  const secure =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secureFlag = secure ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly;${secureFlag} SameSite=Lax; Max-Age=0`
  );

  if (req.method === 'GET') {
    res.writeHead(302, { Location: '/mobile' });
    res.end();
    return;
  }
  res.status(204).end();
}
