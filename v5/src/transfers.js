/**
 * Measured mobile Transfers tab (placeholder list).
 */
import { $ } from './lib/util.js';

/** @type {{ eventId: string, event: object | null } | null} */
let ctx = null;

export function initTransfers(context) {
  ctx = context;
}

export function loadTransfersView() {
  const el = $('view-transfers');
  if (!el) return;

  el.innerHTML = `
    <div class="page-hero page-hero--compact">
      <p class="page-kicker">Stock</p>
      <h1 class="page-title">Transfers</h1>
      <p class="page-sub">Move stock between bars and locations.</p>
    </div>
    <div class="empty empty--panel">
      <span class="empty-icon" aria-hidden="true"><i class="ph ph-arrows-left-right"></i></span>
      <p class="empty-title">No transfers yet</p>
      <p class="empty-copy">${ctx?.eventId
    ? 'Bar-to-bar and location moves for this event will show here.'
    : 'Choose an event to view transfers.'}</p>
    </div>
  `;
}
