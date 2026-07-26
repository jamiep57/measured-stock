/**
 * Measured mobile Wastage tab (placeholder list).
 */
import { $ } from './lib/util.js';

/** @type {{ eventId: string, event: object | null } | null} */
let ctx = null;

export function initWastage(context) {
  ctx = context;
}

export function loadWastageView() {
  const el = $('view-wastage');
  if (!el) return;

  el.innerHTML = `
    <div class="page-hero page-hero--compact">
      <p class="page-kicker">Stock</p>
      <h1 class="page-title">Wastage</h1>
      <p class="page-sub">Log breakage, comps, and unsellable stock.</p>
    </div>
    <div class="empty empty--panel">
      <span class="empty-icon" aria-hidden="true"><i class="ph ph-trash"></i></span>
      <p class="empty-title">No wastage yet</p>
      <p class="empty-copy">${ctx?.eventId
    ? 'Wastage batches for this event will show here.'
    : 'Choose an event to view wastage.'}</p>
    </div>
  `;
}
