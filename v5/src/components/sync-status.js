/**
 * Shared offline / sync-queue status UI.
 * Quiet when healthy — only surfaces pending/failed syncs and offline.
 */

import { $ } from '../lib/util.js';
import {
  getQueueStats,
  setSyncStatusListener,
} from '../sync-queue.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.bannerId]
 * @param {string} [opts.badgeId]
 * @param {string} [opts.lastSyncId] — always kept hidden (legacy “Synced … ago”)
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
    if (lastEl) {
      lastEl.hidden = true;
      lastEl.textContent = '';
    }

    try {
      const stats = await getQueueStats();

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
        } else {
          badge.hidden = true;
          badge.textContent = '';
          badge.classList.remove('sync-badge--failed', 'sync-badge--pending');
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
