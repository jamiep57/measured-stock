/**
 * Preview and push an event's menu to the Square catalogue.
 */

import { escapeHtml, toast } from '../lib/util.js';
import { authFetch } from '../lib/auth.js';
import { closeModal, openModal } from '../components/modal.js';

const money = (minor) => (minor == null ? 'no price' : `£${(minor / 100).toFixed(2)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function whenLabel(iso) {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'never';
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return `today ${time}`;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

function nameList(names, limit = 12) {
  if (!names.length) return '';
  const shown = names.slice(0, limit).map((n) => `<li>${escapeHtml(n)}</li>`).join('');
  const more = names.length > limit ? `<li class="muted">and ${names.length - limit} more</li>` : '';
  return `<ul class="sqm-list">${shown}${more}</ul>`;
}

const BLOCKED = {
  not_connected: { text: 'Square is not connected.', href: '/settings/square', link: 'Open Square settings' },
  needs_reconnect: { text: 'Reconnect Square so the app can update your Square items.', href: '/settings/square', link: 'Open Square settings' },
  no_links: { text: 'Link this event’s bars to Square locations first. Do it in Square & modifiers, under Square live sales setup.' },
  forbidden: { text: 'Only an organisation admin can sync the menu to Square.' },
};

function renderPreview(p) {
  const s = p.summary;
  const chips = [
    s.itemsCreated ? plural(s.itemsCreated, 'new item') : '',
    s.itemsUpdated ? plural(s.itemsUpdated, 'item') + ' updated' : '',
    s.variationsCreated ? plural(s.variationsCreated, 'new serve size') : '',
    s.priceChanges.length ? plural(s.priceChanges.length, 'price change') : '',
    s.categoriesCreated.length ? plural(s.categoriesCreated.length, 'new category') : '',
  ].filter(Boolean);

  const warnings = p.warnings.length ? `
    <details class="sqm-warn">
      <summary>${plural(p.warnings.length, 'thing')} to check before pushing</summary>
      ${nameList(p.warnings, 20)}
    </details>` : '';

  const bars = s.locations.map((loc) => `
    <div class="sqm-bar">
      <div class="sqm-bar-head">
        <strong>${escapeHtml(loc.bar)}</strong>
        <span class="muted">Square location: ${escapeHtml(loc.location)}</span>
        <span class="sqm-delta">${loc.add.length ? `<span class="sqm-add">+${loc.add.length} shown</span>` : ''}${loc.remove.length ? `<span class="sqm-remove">−${loc.remove.length} hidden</span>` : ''}${!loc.add.length && !loc.remove.length ? '<span class="muted">No change</span>' : ''}</span>
      </div>
      ${loc.add.length || loc.remove.length ? `
        <details>
          <summary>Show items</summary>
          ${loc.add.length ? `<p class="sqm-sub">Shown on this till</p>${nameList(loc.add)}` : ''}
          ${loc.remove.length ? `<p class="sqm-sub">Hidden from this till</p>${nameList(loc.remove)}` : ''}
        </details>` : ''}
    </div>`).join('');

  const prices = s.priceChanges.length ? `
    <details>
      <summary>Price changes</summary>
      <ul class="sqm-list">${s.priceChanges.slice(0, 40).map((c) => `<li>${escapeHtml(c.item)} (${escapeHtml(c.variation)}): ${money(c.from)} → ${money(c.to)}</li>`).join('')}</ul>
    </details>` : '';

  return `
    <div class="sqm">
      <p class="muted">${escapeHtml(p.event)} · ${plural(p.itemCount, 'menu item')} · last pushed ${escapeHtml(whenLabel(p.lastPushAt))}</p>
      ${p.changes
    ? `<p>${chips.length ? escapeHtml(chips.join(' · ')) : 'Till availability changes only.'}</p>`
    : '<p><strong>Square already matches this menu.</strong></p>'}
      ${warnings}
      <div class="sqm-bars">${bars}</div>
      ${prices}
      <p class="muted">Each product is one Square item with its serve sizes as options. Items not on a bar’s menu are hidden from that bar’s till only. Nothing is deleted from Square.</p>
      ${p.canWrite ? '' : '<p class="sqm-warn-line">Reconnect Square in <a href="/settings/square">Settings → Square</a> before pushing. The current connection can only read items.</p>'}
    </div>`;
}

async function callCatalog(eventId, apply) {
  const res = await authFetch('/api/square/catalog', {
    method: 'POST',
    body: JSON.stringify({ event_id: eventId, apply }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Square menu sync failed');
    err.code = data.error;
    throw err;
  }
  return data;
}

/** @param {string} eventId */
export async function openSquareMenuSync(eventId) {
  if (!eventId) return;
  const el = openModal({
    title: 'Sync menu to Square',
    bodyHtml: '<p class="muted">Comparing this menu with Square…</p>',
    footHtml: '<div class="admin-modal-confirm-foot"><button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-sqm-close>Close</button></div>',
  });
  el?.querySelector('[data-sqm-close]')?.addEventListener('click', closeModal);
  const body = el?.querySelector('.admin-modal-body');
  const foot = el?.querySelector('.admin-modal-foot');
  if (!body || !foot) return;

  let preview;
  try {
    preview = await callCatalog(eventId, false);
  } catch (err) {
    const blocked = BLOCKED[err.code];
    body.innerHTML = blocked
      ? `<p>${escapeHtml(blocked.text)}</p>${blocked.href ? `<p><a class="admin-drawer-btn admin-drawer-btn--primary" href="${blocked.href}">${escapeHtml(blocked.link)}</a></p>` : ''}`
      : `<p>${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!el.isConnected) return;
  body.innerHTML = renderPreview(preview);
  if (!preview.changes || !preview.canWrite) return;

  foot.innerHTML = `
    <div class="admin-modal-confirm-foot">
      <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-sqm-close>Cancel</button>
      <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-sqm-push>Push to Square</button>
    </div>`;
  foot.querySelector('[data-sqm-close]')?.addEventListener('click', closeModal);
  const push = foot.querySelector('[data-sqm-push]');
  push?.addEventListener('click', async () => {
    push.setAttribute('disabled', '');
    push.textContent = 'Pushing…';
    try {
      const result = await callCatalog(eventId, true);
      toast(`Square menu updated (${plural(result.changes, 'change')})`);
      closeModal();
    } catch (err) {
      toast(err.message || 'Square menu sync failed', true);
      push.removeAttribute('disabled');
      push.textContent = 'Push to Square';
    }
  });
}
