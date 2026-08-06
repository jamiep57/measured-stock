/**
 * Pure helpers for Closing collaborative sync (testable without DOM).
 */

export const PEER_COLORS = [
  '#2563eb', // blue
  '#db2777', // pink
  '#059669', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#4f46e5', // indigo
];

/** Stable color per client for Google Sheets–style caret. */
export function peerColor(clientId) {
  const s = String(clientId || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

export function cellFocusKey(productId, field) {
  if (!productId || !field) return null;
  return `${productId}::${field}`;
}

/**
 * Merge a remote closing_stock row into the local list (by product_id).
 * @param {object[]} closingRows
 * @param {object} remote
 * @returns {{ rows: object[], created: boolean }}
 */
export function mergeClosingRemoteRow(closingRows, remote) {
  const rows = Array.isArray(closingRows) ? closingRows.slice() : [];
  const pid = remote?.product_id;
  if (!pid) return { rows, created: false };
  const idx = rows.findIndex((r) => r.product_id === pid);
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...remote };
    return { rows, created: false };
  }
  rows.push({ ...remote });
  return { rows, created: true };
}

/**
 * Decide whether a remote patch should update local editable inputs.
 */
export function shouldApplyRemoteClosingEdit({
  productId,
  dirtyPids,
  recentLocalWrites,
  focusedPid = null,
  now = Date.now(),
  localEchoMs = 3000,
} = {}) {
  if (!productId) return { apply: false, reason: 'missing' };
  const dirty = dirtyPids instanceof Set
    ? dirtyPids.has(productId)
    : !!(dirtyPids && Object.prototype.hasOwnProperty.call(dirtyPids, productId));
  if (dirty) return { apply: false, reason: 'dirty' };
  if (focusedPid && focusedPid === productId) return { apply: false, reason: 'focused' };
  let writtenAt = 0;
  if (recentLocalWrites instanceof Map) writtenAt = recentLocalWrites.get(productId) || 0;
  else if (recentLocalWrites) writtenAt = Number(recentLocalWrites[productId]) || 0;
  if (writtenAt && now - writtenAt < localEchoMs) return { apply: false, reason: 'local-echo' };
  return { apply: true, reason: 'ok' };
}

/**
 * Format presence peers for the Closing live bar (excludes self).
 */
export function formatClosingPresence(peers, selfClientId) {
  const others = (peers || []).filter((p) => p && p.clientId && p.clientId !== selfClientId);
  const names = [...new Set(others.map((p) => (p.name || '').trim()).filter(Boolean))];
  if (!names.length) {
    return { text: 'Just you here', names: [], others };
  }
  if (names.length === 1) {
    return { text: `${names[0]} is also here`, names, others };
  }
  if (names.length === 2) {
    return { text: `${names[0]} and ${names[1]} are also here`, names, others };
  }
  return {
    text: `${names[0]}, ${names[1]} +${names.length - 2} also here`,
    names,
    others,
  };
}

/**
 * Map `${productId}::${field}` → first peer currently focused on that cell.
 * @returns {Record<string, { name: string, color: string, clientId: string, productId: string, field: string }>}
 */
export function cellFocusOwners(peers, selfClientId) {
  /** @type {Record<string, { name: string, color: string, clientId: string, productId: string, field: string }>} */
  const map = {};
  for (const p of peers || []) {
    if (!p || p.clientId === selfClientId) continue;
    const productId = p.focusPid;
    const field = p.focusField;
    const name = (p.name || '').trim();
    const key = cellFocusKey(productId, field);
    if (!key || !name || map[key]) continue;
    map[key] = {
      name,
      color: peerColor(p.clientId),
      clientId: p.clientId,
      productId,
      field,
    };
  }
  return map;
}
