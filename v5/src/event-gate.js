/**
 * Centered custom event / warehouse dropdown for Measured mobile.
 */
import { $, escapeHtml } from './lib/util.js';

/**
 * @param {{
 *   events: Array<{ id: string, name?: string, status?: string }>,
 *   warehouses?: Array<{ id: string, name?: string, address?: string }>,
 *   selectedId?: string,
 *   selectedKind?: 'event' | 'warehouse',
 *   dismissible?: boolean,
 *   onSelect: (sel: { kind: 'event' | 'warehouse', id: string }) => void | Promise<void>,
 *   onDismiss?: () => void,
 * }} opts
 */
export function showEventGate(opts) {
  const root = $('eventGate');
  if (!root) return;

  const events = opts.events || [];
  const warehouses = opts.warehouses || [];
  const selectedId = opts.selectedId || '';
  const selectedKind = opts.selectedKind === 'warehouse' ? 'warehouse' : 'event';
  const dismissible = !!opts.dismissible && !!selectedId;

  const selectedLabel = (() => {
    if (!selectedId) return 'Select location';
    if (selectedKind === 'warehouse') {
      return warehouses.find((w) => w.id === selectedId)?.name || 'Warehouse';
    }
    return events.find((e) => e.id === selectedId)?.name || 'Event';
  })();

  document.documentElement.classList.add('event-gate');
  root.hidden = false;
  root.removeAttribute('inert');

  const eventOptions = events.length
    ? events.map((ev) => {
      const active = selectedKind === 'event' && ev.id === selectedId;
      const status = (ev.status || '').trim();
      return `
            <button type="button" class="event-dd-option${active ? ' is-active' : ''}"
              role="option" aria-selected="${active ? 'true' : 'false'}"
              data-kind="event" data-id="${escapeHtml(ev.id)}">
              <span class="event-dd-option-copy">
                <strong>${escapeHtml(ev.name || 'Event')}</strong>
                ${status ? `<em>${escapeHtml(status)}</em>` : ''}
              </span>
              ${active ? '<i class="ph-bold ph-check event-dd-check" aria-hidden="true"></i>' : ''}
            </button>`;
    }).join('')
    : '';

  const warehouseOptions = warehouses.length
    ? warehouses.map((wh) => {
      const active = selectedKind === 'warehouse' && wh.id === selectedId;
      const address = (wh.address || '').trim();
      return `
            <button type="button" class="event-dd-option${active ? ' is-active' : ''}"
              role="option" aria-selected="${active ? 'true' : 'false'}"
              data-kind="warehouse" data-id="${escapeHtml(wh.id)}">
              <span class="event-dd-option-copy">
                <strong>${escapeHtml(wh.name || 'Warehouse')}</strong>
                <em>${escapeHtml(address || 'Warehouse')}</em>
              </span>
              ${active ? '<i class="ph-bold ph-check event-dd-check" aria-hidden="true"></i>' : ''}
            </button>`;
    }).join('')
    : '';

  const menuBody = (!events.length && !warehouses.length)
    ? `<div class="event-dd-empty">No events or warehouses found</div>`
    : `
        ${events.length ? `
          <div class="event-dd-section" role="group" aria-label="Events">
            <div class="event-dd-section-label">Events</div>
            ${eventOptions}
          </div>` : ''}
        ${warehouses.length ? `
          <div class="event-dd-section" role="group" aria-label="Warehouses">
            <div class="event-dd-section-label">Warehouses</div>
            ${warehouseOptions}
          </div>` : ''}`;

  root.innerHTML = `
    <button type="button" class="event-dd-backdrop" data-dismiss
      aria-label="${dismissible ? 'Close' : 'Choose a location'}"></button>
    <div class="event-dd" role="dialog" aria-modal="true" aria-label="Choose location">
      <div class="event-dd-anchor">
        <span class="event-dd-anchor-label">${escapeHtml(selectedLabel)}</span>
        <i class="ph ph-caret-up event-dd-anchor-caret" aria-hidden="true"></i>
      </div>
      <div class="event-dd-menu" role="listbox">
        ${menuBody}
      </div>
    </div>
  `;

  root.querySelector('[data-dismiss]')?.addEventListener('click', () => {
    if (!dismissible) return;
    opts.onDismiss?.();
    hideEventGate();
  });

  root.querySelectorAll('[data-kind][data-id]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const kind = btn.dataset.kind === 'warehouse' ? 'warehouse' : 'event';
        await opts.onSelect({ kind, id: btn.dataset.id });
      } finally {
        btn.disabled = false;
      }
    };
  });
}

export function hideEventGate() {
  const root = $('eventGate');
  document.documentElement.classList.remove('event-gate');
  if (!root) return;
  root.hidden = true;
  root.setAttribute('inert', '');
  root.innerHTML = '';
}

export function isEventGateOpen() {
  return document.documentElement.classList.contains('event-gate');
}
