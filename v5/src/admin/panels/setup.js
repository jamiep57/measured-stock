/**
 * Admin event setup — details, bars, and transfer recipients.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadEventFull } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { syncSidebar } from '../sidebar.js';
import { parseRoute } from '../router.js';
import { parseQty } from '../../stock-entry.js';

const STATUS_OPTS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'closing', label: 'Closing' },
  { value: 'reconciled', label: 'Reconciled' },
  { value: 'archived', label: 'Archived' },
];

const EVENT_IMAGE_BUCKET = 'event-images';

function renderShell() {
  return `
    <div class="admin-page setup-panel">
      <div class="setup-stack">
        <section class="setup-section admin-surface">
          <div class="setup-section-head">
            <h2 class="setup-section-title">Event details</h2>
            <p class="setup-section-desc muted">Core information for this event. Changes save automatically.</p>
          </div>
          <div class="setup-fields">
            <div class="setup-field setup-field--full">
              <div class="setup-field-row">
                <label class="admin-label" for="setupImageFile">Event image</label>
                <span class="setup-field-saved" id="setupSaved-image_url"></span>
              </div>
              <div class="setup-image-row">
                <div class="setup-image-preview setup-image-preview--empty" id="setupImagePreview" aria-hidden="true">
                  ${icon('image', { size: 20 })}
                </div>
                <div class="setup-image-actions">
                  <input type="file" id="setupImageFile" accept="image/*" hidden>
                  <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="setupImagePick">
                    ${icon('upload', { size: 14 })} Choose image
                  </button>
                  <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="setupImageClear" hidden>
                    Remove
                  </button>
                  <p class="wst-form-hint muted" style="margin:0">Shown on the left of the event selector in the sidebar.</p>
                </div>
              </div>
            </div>
            <div class="setup-field">
              <div class="setup-field-row">
                <label class="admin-label" for="setupName">Event name</label>
                <span class="setup-field-saved" id="setupSaved-name"></span>
              </div>
              <input class="admin-input" type="text" id="setupName" data-field="name" placeholder="e.g. Highlights 2025">
            </div>
            <div class="setup-field">
              <div class="setup-field-row">
                <label class="admin-label" for="setupStatus">Status</label>
                <span class="setup-field-saved" id="setupSaved-status"></span>
              </div>
              <select class="admin-select" id="setupStatus" data-field="status">
                ${STATUS_OPTS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
              </select>
            </div>
            <div class="setup-field setup-field--full">
              <div class="setup-field-row">
                <label class="admin-label" for="setupVenue">Venue address</label>
                <span class="setup-field-saved" id="setupSaved-venue"></span>
              </div>
              <textarea class="admin-textarea" id="setupVenue" rows="3" data-field="venue" placeholder="Street, building, city…"></textarea>
            </div>
            <div class="setup-field">
              <div class="setup-field-row">
                <label class="admin-label" for="setupPostcode">Postcode</label>
                <span class="setup-field-saved" id="setupSaved-venue_postcode"></span>
              </div>
              <input class="admin-input" type="text" id="setupPostcode" data-field="venue_postcode" placeholder="e.g. CT9 1XJ" autocomplete="postal-code">
            </div>
            <div class="setup-field setup-field--spacer" aria-hidden="true"></div>
            <div class="setup-field">
              <div class="setup-field-row">
                <label class="admin-label" for="setupStart">Start date on site</label>
                <span class="setup-field-saved" id="setupSaved-start_date"></span>
              </div>
              <input class="admin-input" type="date" id="setupStart" data-field="start_date">
            </div>
            <div class="setup-field">
              <div class="setup-field-row">
                <label class="admin-label" for="setupEnd">End date on site</label>
                <span class="setup-field-saved" id="setupSaved-end_date"></span>
              </div>
              <input class="admin-input" type="date" id="setupEnd" data-field="end_date">
            </div>
            <div class="setup-field">
              <div class="setup-field-row">
                <label class="admin-label" for="setupTarget">Target revenue (£)</label>
                <span class="setup-field-saved" id="setupSaved-target_revenue"></span>
              </div>
              <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="setupTarget" data-field="target_revenue" placeholder="e.g. 350000">
              <p class="wst-form-hint muted">Used on Square to project which products may run out before this revenue target.</p>
            </div>
          </div>
        </section>

        <section class="setup-section admin-surface">
          <div class="setup-section-head">
            <h2 class="setup-section-title">Bars</h2>
            <p class="setup-section-desc muted">Bars scoped to this event — used in distribution, counts, and transfers.</p>
          </div>
          <div class="setup-pills" id="setupBars"></div>
        </section>

        <section class="setup-section admin-surface">
          <div class="setup-section-head">
            <h2 class="setup-section-title">Internal transfer recipients</h2>
            <p class="setup-section-desc muted">Crew, artists, production, and other internal destinations for transfers.</p>
          </div>
          <div class="setup-pills" id="setupRecipients"></div>
        </section>
      </div>
    </div>`;
}

function renderBarPills(bars, onOpen) {
  const wrap = $('setupBars');
  if (!wrap) return;
  const sorted = (bars || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  wrap.innerHTML = sorted.map((b) => `
    <button type="button" class="setup-pill" data-bar-id="${escapeHtml(b.id)}">
      ${icon('store', { size: 14 })}
      <span>${escapeHtml(b.name || '—')}</span>
    </button>`).join('') +
    (sorted.length ? '' : '<span class="setup-pills-empty muted">No bars yet.</span>') +
    `<button type="button" class="setup-pill setup-pill--add" id="setupAddBar">
      ${icon('plus', { size: 14 })}<span>Add bar</span>
    </button>`;

  wrap.querySelectorAll('[data-bar-id]').forEach((btn) => {
    btn.onclick = () => onOpen(btn.dataset.barId);
  });
  $('setupAddBar')?.addEventListener('click', () => onOpen(null));
}

function renderRecipientPills(recipients, onOpen) {
  const wrap = $('setupRecipients');
  if (!wrap) return;
  const sorted = (recipients || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  wrap.innerHTML = sorted.map((r) => {
    const sub = r.department ? `<span class="setup-pill-sub">· ${escapeHtml(r.department)}</span>` : '';
    return `
    <button type="button" class="setup-pill" data-recip-id="${escapeHtml(r.id)}">
      ${icon('share-2', { size: 14 })}
      <span>${escapeHtml(r.name || '—')}${sub}</span>
    </button>`;
  }).join('') +
    (sorted.length ? '' : '<span class="setup-pills-empty muted">No recipients yet.</span>') +
    `<button type="button" class="setup-pill setup-pill--add" id="setupAddRecip">
      ${icon('plus', { size: 14 })}<span>Add recipient</span>
    </button>`;

  wrap.querySelectorAll('[data-recip-id]').forEach((btn) => {
    btn.onclick = () => onOpen(btn.dataset.recipId);
  });
  $('setupAddRecip')?.addEventListener('click', () => onOpen(null));
}

function flashSaved(field, isErr, msg) {
  const el = $(`setupSaved-${field}`);
  if (!el) return;
  el.classList.toggle('setup-field-saved--err', !!isErr);
  el.textContent = isErr ? (msg || 'Error') : 'Saved';
  el.classList.add('setup-field-saved--show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('setup-field-saved--show'), isErr ? 4000 : 1600);
}

function paintEventImage(imageUrl) {
  const preview = $('setupImagePreview');
  const clearBtn = $('setupImageClear');
  const pickBtn = $('setupImagePick');
  if (!preview) return;

  if (imageUrl) {
    preview.classList.remove('setup-image-preview--empty');
    preview.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="Event image">`;
    if (clearBtn) clearBtn.hidden = false;
    if (pickBtn) pickBtn.innerHTML = `${icon('upload', { size: 14 })} Change image`;
  } else {
    preview.classList.add('setup-image-preview--empty');
    preview.innerHTML = icon('image', { size: 20 });
    if (clearBtn) clearBtn.hidden = true;
    if (pickBtn) pickBtn.innerHTML = `${icon('upload', { size: 14 })} Choose image`;
  }
}

function paintEventFields(event) {
  $('setupName').value = event.name || '';
  $('setupStatus').value = event.status || 'active';
  $('setupVenue').value = event.venue || '';
  $('setupPostcode').value = event.venue_postcode || '';
  $('setupStart').value = event.start_date || '';
  $('setupEnd').value = event.end_date || '';
  $('setupTarget').value = event.target_revenue != null ? String(event.target_revenue) : '';
  paintEventImage(event.image_url || null);
}

function imageExt(file) {
  const fromName = (file.name || '').split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const type = (file.type || '').split('/')[1];
  if (type === 'jpeg') return 'jpg';
  if (type && /^[a-z0-9]+$/.test(type)) return type;
  return 'jpg';
}

export function renderSetupShell() {
  return renderShell();
}

export function mountSetupPanel(route, state = { events: [] }) {
  const eventId = route.eventId;
  if (!eventId) return () => {};

  let event = null;

  function patchStateEvent(patch) {
    const row = state.events?.find((e) => e.id === eventId);
    if (row) Object.assign(row, patch);
    syncSidebar(parseRoute(), state);
  }

  async function refresh() {
    event = await loadEventFull(eventId);
    if (!event) throw new Error('Event not found');
    paintEventFields(event);
    renderBarPills(event.bars || [], openBarForm);
    renderRecipientPills(event.recipients || [], openRecipientForm);
    patchStateEvent({
      name: event.name,
      status: event.status,
      image_url: event.image_url || null,
    });
  }

  async function saveEventField(field, rawValue) {
    if (!event?.id) return;
    let value = rawValue;
    if (typeof value === 'string') {
      value = value.trim();
      if (value === '') value = null;
    }
    if (field === 'target_revenue') {
      if (rawValue === '' || rawValue == null) value = null;
      else {
        value = parseQty(rawValue);
        if (!Number.isFinite(value)) value = null;
      }
    }
    try {
      await getDB().events.update(event.id, { [field]: value });
      event[field] = value;
      flashSaved(field, false);
      if (field === 'name') {
        const title = $('pageTitle');
        if (title) title.textContent = `Event setup · ${value || event.name || 'Event'}`;
        patchStateEvent({ name: value });
      }
      if (field === 'status') patchStateEvent({ status: value });
    } catch (err) {
      flashSaved(field, true, (err.message || 'Failed').slice(0, 48));
    }
  }

  async function saveEventImage(file) {
    if (!event?.id || !file) return;
    const pickBtn = $('setupImagePick');
    const prevLabel = pickBtn?.innerHTML;
    if (pickBtn) {
      pickBtn.disabled = true;
      pickBtn.textContent = 'Uploading…';
    }
    try {
      const path = `events/${event.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${imageExt(file)}`;
      const url = await getDB().uploadImage(EVENT_IMAGE_BUCKET, path, file);
      await getDB().events.update(event.id, { image_url: url });
      event.image_url = url;
      paintEventImage(url);
      patchStateEvent({ image_url: url });
      flashSaved('image_url', false);
      toast('Event image saved');
    } catch (err) {
      flashSaved('image_url', true, (err.message || 'Upload failed').slice(0, 48));
      toast(err.message || 'Image upload failed', true);
    } finally {
      if (pickBtn) {
        pickBtn.disabled = false;
        pickBtn.innerHTML = prevLabel || `${icon('upload', { size: 14 })} Change image`;
        paintEventImage(event?.image_url || null);
      }
    }
  }

  async function clearEventImage() {
    if (!event?.id) return;
    try {
      await getDB().events.update(event.id, { image_url: null });
      event.image_url = null;
      paintEventImage(null);
      const fileInput = $('setupImageFile');
      if (fileInput) fileInput.value = '';
      patchStateEvent({ image_url: null });
      flashSaved('image_url', false);
      toast('Event image removed');
    } catch (err) {
      flashSaved('image_url', true, (err.message || 'Failed').slice(0, 48));
      toast(err.message || 'Could not remove image', true);
    }
  }

  function wireAutosave() {
    document.querySelectorAll('.setup-panel [data-field]').forEach((node) => {
      const field = node.dataset.field;
      const ev = (node.tagName === 'SELECT' || node.type === 'date') ? 'change' : 'blur';
      node.addEventListener(ev, () => saveEventField(field, node.value));
    });
  }

  function wireEventImage() {
    const fileInput = $('setupImageFile');
    $('setupImagePick')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) saveEventImage(file);
    });
    $('setupImageClear')?.addEventListener('click', () => clearEventImage());
  }

  function openBarForm(barId) {
    const bar = barId ? (event.bars || []).find((b) => b.id === barId) : null;
    openSheet({
      title: bar ? 'Edit bar' : 'Add bar',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="setupBarErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="setupBarName">Bar name</label>
            <input class="admin-input" type="text" id="setupBarName" required placeholder="e.g. Main bar">
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${bar ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="setupBarDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="setupBarCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="setupBarSave">${bar ? 'Update bar' : 'Save bar'}</button>
          </div>
        </div>`,
    });
    if (bar) $('setupBarName').value = bar.name || '';
    $('setupBarCancel').onclick = closeSheet;
    $('setupBarSave').onclick = async () => {
      const name = ($('setupBarName')?.value || '').trim();
      if (!name) {
        $('setupBarErr').textContent = 'Bar name is required.';
        return;
      }
      const btn = $('setupBarSave');
      btn.disabled = true;
      try {
        const DB = getDB();
        if (bar) await DB.bars.update(bar.id, { name });
        else await DB.bars.create({ event_id: event.id, name });
        closeSheet();
        await refresh();
        toast(bar ? 'Bar updated' : 'Bar added');
      } catch (err) {
        $('setupBarErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };
    if (bar) {
      $('setupBarDelete').onclick = async () => {
        if (!confirm(`Delete “${bar.name}” from this event?`)) return;
        try {
          await getDB().bars.remove(bar.id);
          closeSheet();
          await refresh();
          toast('Bar deleted');
        } catch (err) {
          toast(err.message || 'Delete failed', true);
        }
      };
    }
  }

  function openRecipientForm(recipId) {
    const r = recipId ? (event.recipients || []).find((x) => x.id === recipId) : null;
    openSheet({
      title: r ? 'Edit recipient' : 'Add recipient',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="setupRecipErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="setupRecipName">Name</label>
            <input class="admin-input" type="text" id="setupRecipName" required placeholder="e.g. Artist liaison">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="setupRecipDept">Department</label>
              <input class="admin-input" type="text" id="setupRecipDept" placeholder="e.g. Production">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="setupRecipEmail">Email</label>
              <input class="admin-input" type="email" id="setupRecipEmail" placeholder="Optional">
            </div>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${r ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="setupRecipDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="setupRecipCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="setupRecipSave">${r ? 'Update recipient' : 'Save recipient'}</button>
          </div>
        </div>`,
    });
    if (r) {
      $('setupRecipName').value = r.name || '';
      $('setupRecipDept').value = r.department || '';
      $('setupRecipEmail').value = r.email || '';
    }
    $('setupRecipCancel').onclick = closeSheet;
    $('setupRecipSave').onclick = async () => {
      const name = ($('setupRecipName')?.value || '').trim();
      if (!name) {
        $('setupRecipErr').textContent = 'Name is required.';
        return;
      }
      const patch = {
        name,
        department: ($('setupRecipDept')?.value || '').trim() || null,
        email: ($('setupRecipEmail')?.value || '').trim() || null,
      };
      const btn = $('setupRecipSave');
      btn.disabled = true;
      try {
        const DB = getDB();
        if (r) await DB.recipients.update(r.id, patch);
        else await DB.recipients.create({ event_id: event.id, ...patch });
        closeSheet();
        await refresh();
        toast(r ? 'Recipient updated' : 'Recipient added');
      } catch (err) {
        $('setupRecipErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };
    if (r) {
      $('setupRecipDelete').onclick = async () => {
        if (!confirm(`Delete “${r.name}” from this event?`)) return;
        try {
          await getDB().recipients.remove(r.id);
          closeSheet();
          await refresh();
          toast('Recipient deleted');
        } catch (err) {
          toast(err.message || 'Delete failed', true);
        }
      };
    }
  }

  wireAutosave();
  wireEventImage();

  refresh().catch((err) => {
    toast(err.message || 'Failed to load event setup', true);
  });

  return () => {};
}
