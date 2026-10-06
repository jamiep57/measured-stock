import { missingSquareConfig, squareApiBase, squareConfig } from './config.js';

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function squareError(res, json, label) {
  const detail = Array.isArray(json?.errors)
    ? json.errors.map((err) => err.detail || err.code).filter(Boolean).join('; ')
    : '';
  const error = new Error(detail || `${label} ${res.status}`);
  error.status = res.status;
  error.body = json;
  return error;
}

/** @param {'sandbox'|'production'} environment @param {string} token @param {string} path @param {{ method?: string, body?: object }} [opts] */
export async function squareFetch(environment, token, path, opts = {}) {
  const cfg = squareConfig();
  const res = await fetch(`${squareApiBase(environment)}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': cfg.version,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await readJson(res);
  if (!res.ok) throw squareError(res, json, path);
  return json || {};
}

async function oauthToken(environment, body) {
  const cfg = squareConfig();
  const res = await fetch(`${squareApiBase(environment)}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Square-Version': cfg.version,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) throw squareError(res, json, 'oauth2/token');
  return json || {};
}

export function authorizeUrl({ environment, state, redirectUri }) {
  const cfg = squareConfig();
  const params = new URLSearchParams({
    client_id: cfg.appId,
    scope: 'MERCHANT_PROFILE_READ ORDERS_READ ITEMS_READ',
    session: 'false',
    state,
    redirect_uri: redirectUri,
  });
  return `${squareApiBase(environment)}/oauth2/authorize?${params}`;
}

export function exchangeAuthCode({ environment, code, redirectUri }) {
  const cfg = squareConfig();
  return oauthToken(environment, {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
}

export function refreshSquareToken(environment, refreshToken) {
  const cfg = squareConfig();
  return oauthToken(environment, {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

export function revokeSquareToken(environment, accessToken) {
  const cfg = squareConfig();
  return fetch(`${squareApiBase(environment)}/oauth2/revoke`, {
    method: 'POST',
    headers: {
      'Square-Version': cfg.version,
      'Content-Type': 'application/json',
      Authorization: `Client ${cfg.appSecret}`,
    },
    body: JSON.stringify({
      client_id: cfg.appId,
      access_token: accessToken,
    }),
  });
}

export async function fetchMerchant(environment, token, merchantId) {
  const json = await squareFetch(environment, token, `/v2/merchants/${encodeURIComponent(merchantId)}`);
  return json.merchant || null;
}

export async function listLocations(environment, token) {
  const json = await squareFetch(environment, token, '/v2/locations');
  return (json.locations || []).map((location) => ({
    id: location.id,
    name: location.name || location.id,
    status: location.status || '',
  }));
}

export async function retrieveOrder(environment, token, orderId) {
  const json = await squareFetch(environment, token, `/v2/orders/${encodeURIComponent(orderId)}`);
  return json.order || null;
}

/**
 * Completed and canceled orders whose close time falls in the window.
 * location_ids are sent in batches of 10, which is Square's limit.
 */
export async function searchOrders(environment, token, { locationIds, startAt, endAt }) {
  const ids = [...new Set((locationIds || []).filter(Boolean))];
  const orders = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    let cursor = '';
    for (let page = 0; page < 20; page += 1) {
      /** @type {Record<string, unknown>} */
      const body = {
        location_ids: batch,
        limit: 500,
        query: {
          filter: {
            state_filter: { states: ['COMPLETED', 'CANCELED'] },
            date_time_filter: { closed_at: { start_at: startAt, end_at: endAt } },
          },
          sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
        },
      };
      if (cursor) body.cursor = cursor;
      const json = await squareFetch(environment, token, '/v2/orders/search', { method: 'POST', body });
      orders.push(...(json.orders || []));
      cursor = json.cursor || '';
      if (!cursor) break;
    }
  }
  return orders;
}

/** Modifier catalog id → modifier list name. */
export async function modifierSetNames(environment, token, catalogIds) {
  const ids = [...new Set((catalogIds || []).filter(Boolean))];
  const names = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const json = await squareFetch(environment, token, '/v2/catalog/batch-retrieve', {
      method: 'POST',
      body: { object_ids: chunk, include_related_objects: true },
    });
    const related = new Map((json.related_objects || []).map((obj) => [obj.id, obj]));
    for (const obj of json.objects || []) {
      if (obj.type !== 'MODIFIER') continue;
      const listId = obj.modifier_data?.modifier_list_id;
      const listName = related.get(listId)?.modifier_list_data?.name || '';
      if (listName) names.set(obj.id, listName);
    }
  }
  return names;
}

export function assertSquareAppConfigured() {
  const missing = missingSquareConfig();
  if (missing.length) {
    const error = new Error(`Square is not configured (${missing.join(', ')})`);
    error.code = 'not_configured';
    throw error;
  }
}
