/**
 * Shared offline / sync-queue / last-synced status UI.
 */

import { $ } from '../lib/util.js';
import {
  getQueueStats,
  getLastSyncedAt,
  setSyncStatusListener,
} from '../sync-queue.js';

function fmtRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 15) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * @param {object} [opts]
 * @param {string} [opts.bannerId]
 * @param {string} [opts.badgeId]
 * @param {string} [opts.lastSyncId]
 * @param {() => void | Promise<void>} [opts.onOnline]
 */
export function initSyncStatus(opts = {}) {
  const bannerId = opts.bannerId || 'offlineBanner';
  const badgeId = opts.badgeId || 'syncBadge';
  const lastSyncId = opts.lastSyncId || 'lastSyncLabel';

  function syncOfflineBanner() {
    const banner = $(bannerId);
    if (!banner) return;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    banner.hidden = !offline;
    if (offline) {
      banner.textContent = 'You’re offline — changes will sync when you’re back online.';
    }
  }

  async function refresh() {
    syncOfflineBanner();
    const badge = $(badgeId);
    const lastEl = $(lastSyncId);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

    try {
      const stats = await getQueueStats();
      const last = getLastSyncedAt();

      if (badge) {
        if (stats.total > 0) {
          badge.hidden = false;
          badge.classList.toggle('sync-badge--failed', stats.failed > 0);
          badge.classList.toggle('sync-badge--pending', stats.pending > 0 && !stats.failed);
          if (stats.failed > 0) {
            badge.textContent = stats.failed === 1
              ? '1 sync failed'
              : `${stats.failed} syncs failed`;
          } else {
            badge.textContent = stats.pending === 1
              ? '1 pending sync'
              : `${stats.pending} pending syncs`;
          }
        } else if (offline) {
          badge.hidden = true;
        } else {
          badge.hidden = true;
          badge.textContent = '';
          badge.classList.remove('sync-badge--failed', 'sync-badge--pending');
        }
      }

      if (lastEl) {
        if (stats.total > 0) {
          lastEl.hidden = true;
        } else if (last) {
          lastEl.hidden = false;
          lastEl.textContent = `Synced ${fmtRelative(last)}`;
        } else {
          lastEl.hidden = true;
          lastEl.textContent = '';
        }
      }
    } catch {
      if (badge) badge.hidden = true;
    }
  }

  syncOfflineBanner();
  setSyncStatusListener(() => {
    refresh().catch(() => {});
  });
  refresh().catch(() => {});

  window.addEventListener('online', () => {
    syncOfflineBanner();
    Promise.resolve(opts.onOnline?.()).finally(() => refresh());
  });
  window.addEventListener('offline', syncOfflineBanner);

  const tick = setInterval(() => {
    refresh().catch(() => {});
  }, 30000);

  return {
    refresh,
    destroy() {
      clearInterval(tick);
    },
  };
}
