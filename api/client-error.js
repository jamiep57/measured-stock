/**
 * Accepts client error beacons from the V5 apps.
 * Stores nothing durable yet — logs for Vercel log drains / monitoring.
 */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = { raw: String(body).slice(0, 2000) };
    }
  }

  const entry = {
    at: new Date().toISOString(),
    message: String(body?.message || 'client error').slice(0, 500),
    source: String(body?.source || 'client').slice(0, 80),
    url: body?.url ? String(body.url).slice(0, 500) : undefined,
    stack: body?.stack ? String(body.stack).slice(0, 2000) : undefined,
  };

  console.warn('[client-error]', JSON.stringify(entry));
  res.status(204).end();
}
