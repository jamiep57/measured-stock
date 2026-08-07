/**
 * Admin home — event grid + create event.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { getDB } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { emptyState } from '../../components/empty-state.js';
import { initIcons } from '../../lib/icons.js';
import { navigate } from '../router.js';

export const ADMIN_EVENTS_CHANGED = 'v5-admin-events-changed';

const STATUS_OPTS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'closing', label: 'Closing' },
  { value: 'reconciled', label: 'Reconciled' },
  { value: 'archived', label: 'Archived' },
];

export function renderHomeShell(events) {
  const list = events || [];
  const cards = list.length
    ? `<div class="event-grid">
        ${list.map((e) => `
          <a class="event-card" href="/v5/admin/events/${e.id}/dashboard">
            <div class="event-card-name">${escapeHtml(e.name)}</div>
            <div class="event-card-meta">${escapeHtml(e.status || 'Event')} · Open dashboard →</div>
          </a>`).join('')}
      </div>`
    : emptyState({
      iconHtml: '<i data-lucide="calendar-plus"></i>',
      title: 'No events yet',
      copy: 'Create your first event, then add bars, products, and opening stock.',
      variant: 'admin',
      ctaHtml: `<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="homeEmptyCreate">Create event</button>`,
      className: 'empty--onboarding',
    });

  return `
    <div class="admin-page home-page">
      <div class="home-toolbar">
        <p class="home-lead muted">Pick an event workspace, or create a new one.</p>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="homeNewEvent">
          New event
        </button>
      </div>
      ${cards}
    </div>`;
}

function openCreateEventSheet() {
  openSheet({
    title: 'New event',
    variant: 'admin-full',
    bodyHtml: `
      <div class="admin-drawer-form">
        <div class="del-form-err" id="homeEventErr" hidden></div>
        <div class="admin-field">
          <label class="admin-label" for="homeEventName">Event name</label>
          <input class="admin-input" type="text" id="homeEventName" required placeholder="e.g. Highlights 2026" autocomplete="off">
        </div>
        <div class="admin-field">
          <label class="admin-label" for="homeEventStatus">Status</label>
          <select class="admin-select" id="homeEventStatus">
            ${STATUS_OPTS.map((o) => `<option value="${o.value}"${o.value === 'active' ? ' selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="admin-field">
          <label class="admin-label" for="homeEventStart">Start date on site</label>
          <input class="admin-input" type="date" id="homeEventStart">
        </div>
        <div class="admin-field">
          <label class="admin-label" for="homeEventEnd">End date on site</label>
          <input class="admin-input" type="date" id="homeEventEnd">
        </div>
        <div class="admin-field">
          <label class="admin-label" for="homeEventVenue">Venue address</label>
          <textarea class="admin-textarea" id="homeEventVenue" rows="3" placeholder="Street, building, city…"></textarea>
        </div>
        <div class="admin-field">
          <label class="admin-label" for="homeEventPostcode">Postcode</label>
          <input class="admin-input" type="text" id="homeEventPostcode" placeholder="e.g. CT9 1XJ" autocomplete="postal-code">
        </div>
      </div>`,
    footHtml: `
      <div class="admin-drawer-foot">
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="homeEventCancel">Cancel</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="homeEventSave">Create event</button>
      </div>`,
  });

  const errEl = $('homeEventErr');
  const showErr = (msg) => {
    if (!errEl) return;
    if (!msg) {
      errEl.hidden = true;
      errEl.textContent = '';
      return;
    }
    errEl.hidden = false;
    errEl.textContent = msg;
  };

  $('homeEventCancel').onclick = closeSheet;
  $('homeEventSave').onclick = async () => {
    const name = ($('homeEventName')?.value || '').trim();
    if (!name) {
      showErr('Event name is required.');
      $('homeEventName')?.focus();
      return;
    }
    showErr('');
    const btn = $('homeEventSave');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating…';
    }
    try {
      const created = await getDB().events.create({
        name,
        status: $('homeEventStatus')?.value || 'active',
        start_date: $('homeEventStart')?.value || null,
        end_date: $('homeEventEnd')?.value || null,
        venue: ($('homeEventVenue')?.value || '').trim() || null,
        venue_postcode: ($('homeEventPostcode')?.value || '').trim() || null,
      });
      closeSheet();
      toast('Event created');
      document.dispatchEvent(new CustomEvent(ADMIN_EVENTS_CHANGED, {
        detail: { eventId: created.id, panel: 'setup' },
      }));
      navigate({ view: 'event', eventId: created.id, panel: 'setup' });
    } catch (err) {
      showErr(err.message || 'Could not create event');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create event';
      }
    }
  };

  $('homeEventName')?.focus();
}

export function mountHomePanel() {
  const open = () => openCreateEventSheet();
  $('homeNewEvent')?.addEventListener('click', open);
  $('homeEmptyCreate')?.addEventListener('click', open);
  initIcons(document.querySelector('.home-page'));
  return () => {};
}
