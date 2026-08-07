/**
 * PIN unlock retired — redirect to Supabase Auth login.
 * Kept so old bookmarks to /api/unlock do not 404.
 */
/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.writeHead(302, { Location: '/login' });
  res.end();
}
