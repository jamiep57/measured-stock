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
  let kitStatus = 'Choose event or warehouse when you open Kit';
  if (kitDest?.type === DEST_EVENT && kitDest.eventName) {
    kitStatus = `Last kit destination: ${kitDest.eventName}`;
  } else if (kitDest?.type === DEST_WAREHOUSE && kitDest.warehouseName) {
    kitStatus = `Last kit destination: ${kitDest.warehouseName}`;
  }

  el.innerHTML = `
    <div class="home-hero">
      <h1>Measured</h1>
      <p>${hasEvent
    ? `Working on <strong>${escapeHtml(eventName || 'event')}</strong>`
    : 'Select an event above for stock counts and deliveries.'}</p>
    </div>
    <div class="home-tiles">
      <button type="button" class="home-tile" data-go="counts">
        <i class="ph ph-clipboard-text"></i>
        <strong>Stock count</strong>
        <em>${hasEvent ? 'Open count sessions for this event' : 'Pick an event first, then count bar stock'}</em>
      </button>
      <button type="button" class="home-tile" data-go="kit">
        <i class="ph ph-package"></i>
        <strong>Kit</strong>
        <em>Count boxes, pallets, and loose kit into events or warehouses</em>
      </button>
      <button type="button" class="home-tile" data-go="deliveries">
        <i class="ph ph-shipping-container"></i>
        <strong>Deliveries</strong>
        <em>${hasEvent ? 'Log supplier deliveries for this event' : 'Pick an event first, then log deliveries'}</em>
      </button>
    </div>
    <div class="home-status">${escapeHtml(kitStatus)}</div>
  `;

  el.querySelectorAll('[data-go]').forEach((btn) => {
    btn.onclick = () => opts.onNavigate(btn.dataset.go);
  });
}
