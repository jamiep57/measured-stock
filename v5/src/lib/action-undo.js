/**
 * Toast + undo window for reversible destructive actions.
 * Caller supplies commit (runs after delay) and optional undo (cancel before commit).
 */

import { toast } from './util.js';

/** @type {ReturnType<typeof setTimeout> | null} */
let pendingTimer = null;
/** @type {(() => void) | null} */
let pendingCancel = null;

function clearPending() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingCancel = null;
}

/**
 * Schedule a destructive action. Undo within `delayMs` cancels commit.
 * If another action is scheduled, the previous one commits immediately.
 *
 * @param {object} opts
 * @param {string} opts.message
 * @param {() => void | Promise<void>} opts.commit
 * @param {() => void | Promise<void>} [opts.onUndo]
 * @param {number} [opts.delayMs]
 * @param {string} [opts.undoLabel]
 */
export function scheduleDestructive(opts) {
  const {
    message,
    commit,
    onUndo,
    delayMs = 6000,
    undoLabel = 'Undo',
  } = opts;

  if (typeof commit !== 'function') return;

  // Flush any prior pending commit so we don't lose it.
  if (pendingTimer && pendingCancel === null) {
    /* no-op */
  }
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  let cancelled = false;

  pendingCancel = () => {
    cancelled = true;
    clearPending();
    try { onUndo?.(); } catch { /* ignore */ }
    toast('Cancelled');
  };

  toast(message, false, {
    action: {
      label: undoLabel,
      onClick: () => pendingCancel?.(),
    },
    duration: delayMs,
  });

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    pendingCancel = null;
    if (cancelled) return;
    Promise.resolve()
      .then(() => commit())
      .catch((err) => {
        console.warn('scheduleDestructive commit', err);
        toast(err?.message || 'Action failed', true);
      });
  }, delayMs);
}

/** Cancel a pending scheduled destroy without toast (e.g. route change). */
export function cancelPendingDestructive() {
  if (!pendingTimer) return false;
  clearPending();
  return true;
}
