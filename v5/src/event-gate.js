/**
 * Centered custom event dropdown for Measured mobile.
 */
import { $, escapeHtml } from './lib/util.js';

/**
 * @param {{
 *   events: Array<{ id: string, name?: string, status?: string }>,
 *   selectedId?: string,
 *   dismissible?: boolean,
 *   onSelect: (id: string) => void | Promise<void>,
 *   onDismiss?: () => void,
 * }} opts
 */
export function showEventGate(opts) {
  const root = $('eventGate');
  if (!root) return;

  const events = opts.events || [];
  const selectedId = opts.selectedId || '';
  const dismissible = !!opts.dismissible && !!selectedId;

  document.documentElement.classList.add('event-gate');
  root.hidden = false;
  root.removeAttribute('inert');

  root.innerHTML = `
    <button type="button" class="event-dd-backdrop" data-dismiss
      aria-label="${dismissible ? 'Close' : 'Choose an event'}"></button>
    <div class="event-dd" role="dialog" aria-modal="true" aria-label="Choose event">
      <div class="event-dd-anchor">
        <span class="event-dd-anchor-label">${escapeHtml(
    selectedId
      ? (events.find((e) => e.id === selectedId)?.name || 'Event')
      : 'Select event',
  )}</span>
        <i class="ph ph-caret-up event-dd-anchor-caret" aria-hidden="true"></i>
      </div>
      <div class="event-dd-menu" role="listbox">
        ${events.length ? events.map((ev) => {
    const active = ev.id === selectedId;
    const status = (ev.status || '').trim();
    return `
            <button type="button" class="event-dd-option${active ? ' is-active' : ''}"
              role="option" aria-selected="${active ? 'true' : 'false'}"
              data-event="${escapeHtml(ev.id)}">
              <span class="event-dd-option-copy">
                <strong>${escapeHtml(ev.name || 'Event')}</strong>
                ${status ? `<em>${escapeHtml(status)}</em>` : ''}
              </span>
              ${active ? '<i class="ph-bold ph-check event-dd-check" aria-hidden="true"></i>' : ''}
            </button>`;
  }).join('') : `
          <div class="event-dd-empty">No events found</div>`}
      </div>
    </div>
  `;

  root.querySelector('[data-dismiss]')?.addEventListener('click', () => {
    if (!dismissible) return;
    opts.onDismiss?.();
    hideEventGate();
  });

  root.querySelectorAll('[data-event]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await opts.onSelect(btn.dataset.event);
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
