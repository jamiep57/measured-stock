/**
 * Closing-specific collaborative sync helpers.
 * Shared caret/presence utilities live in collab-presence.js.
 */

export {
  PEER_COLORS,
  peerColor,
  cellFocusKey,
  flattenPresenceState,
  formatCollabPresence,
  formatClosingPresence,
  cellFocusOwners,
} from './collab-presence.js';

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
