/**
 * Measured mobile Home tab.
 */
import { $, escapeHtml } from './lib/util.js';
import { loadStoredDestination, DEST_EVENT, DEST_WAREHOUSE } from './lib/kit-count-dest.js';

/**
 * @param {{
 *   eventId: string,
 *   event: object | null,
 *   onNavigate: (tab: string) => void,
 * }} opts
 */
export function loadHomeView(opts) {
  const el = $('view-home');
  if (!el) return;

  const eventName = opts.event?.name || '';
  const hasEvent = !!opts.eventId;
  const kitDest = loadStoredDestination();
  let kitMeta = 'Event or warehouse';
  if (kitDest?.type === DEST_EVENT && kitDest.eventName) {
    kitMeta = kitDest.eventName;
  } else if (kitDest?.type === DEST_WAREHOUSE && kitDest.warehouseName) {
    kitMeta = kitDest.warehouseName;
  }

  el.innerHTML = `
    <div class="page-hero">
      <p class="page-kicker">Today</p>
      <h1 class="page-title">What are you doing?</h1>
      ${hasEvent
    ? `<div class="event-pill" title="${escapeHtml(eventName)}">
          <i class="ph ph-calendar-blank"></i>
          <span>${escapeHtml(eventName)}</span>
        </div>`
    : `<p class="page-sub">Pick an event in the bar above for stock counts and deliveries. Kit works with events or warehouses.</p>`}
    </div>

    <div class="action-list" role="list">
      <button type="button" class="action-row${hasEvent ? '' : ' is-soft'}" data-go="counts" role="listitem">
        <span class="action-icon" aria-hidden="true"><i class="ph ph-clipboard-text"></i></span>
        <span class="action-copy">
          <strong>Stock count</strong>
          <em>${hasEvent ? 'Bar stock sessions for this event' : 'Needs an event selected'}</em>
        </span>
        <i class="ph ph-caret-right action-chevron" aria-hidden="true"></i>
      </button>

      <button type="button" class="action-row" data-go="kit" role="listitem">
        <span class="action-icon action-icon--accent" aria-hidden="true"><i class="ph ph-package"></i></span>
        <span class="action-copy">
          <strong>Kit</strong>
          <em>Boxes, pallets &amp; loose items · ${escapeHtml(kitMeta)}</em>
        </span>
        <i class="ph ph-caret-right action-chevron" aria-hidden="true"></i>
      </button>

      <button type="button" class="action-row${hasEvent ? '' : ' is-soft'}" data-go="deliveries" role="listitem">
        <span class="action-icon" aria-hidden="true"><i class="ph ph-shipping-container"></i></span>
        <span class="action-copy">
          <strong>Deliveries</strong>
          <em>${hasEvent ? 'Log supplier deliveries' : 'Needs an event selected'}</em>
        </span>
        <i class="ph ph-caret-right action-chevron" aria-hidden="true"></i>
      </button>
    </div>
  `;

  el.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = () => opts.onNavigate(btn.dataset.go);
  });
}
