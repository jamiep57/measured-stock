import callback from '../../lib/square/routes/callback.js';
import catalog from '../../lib/square/routes/catalog.js';
import connect from '../../lib/square/routes/connect.js';
import cron from '../../lib/square/routes/cron.js';
import disconnect from '../../lib/square/routes/disconnect.js';
import locations from '../../lib/square/routes/locations.js';
import sync from '../../lib/square/routes/sync.js';
import webhook from '../../lib/square/routes/webhook.js';

// One function for every Square route: the Hobby plan caps a deployment at 12 functions.
// The webhook signature is computed over the raw body, so nothing here may pre-parse it.
export const config = { api: { bodyParser: false } };

const ROUTES = { callback, catalog, connect, cron, disconnect, locations, sync, webhook };

export default async function handler(req, res) {
  const action = String(req.query?.action || '');
  const route = Object.hasOwn(ROUTES, action) ? ROUTES[action] : null;
  if (!route) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  await route(req, res);
}
