/**
 * Workspace settings — organisation profile and database change history.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { getDB } from '../../db.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { getActiveOrganisation, isOrgAdmin } from '../../lib/organisations.js';
import { roleLabel } from '../../lib/permissions.js';
import { describeAuditRow, AUDIT_TABLE_LABELS } from '../../lib/audit-log.js';

const PAGE_SIZE = 100;

export function renderOrganisationSection() {
  const org = getActiveOrganisation();
  const admin = isOrgAdmin();
  return `
    <section class="settings-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Organisation</h2>
          <p class="settings-card-desc muted">Products, events, suppliers, accounts and users are isolated per organisation.</p>
        </div>
      </header>
      <div class="admin-drawer-form settings-org-form">
        <label class="admin-field">
          <span class="admin-label">Name</span>
          <input type="text" class="admin-input" id="settingsOrgName" maxlength="80"
            value="${escapeHtml(org?.name || '')}" ${admin ? '' : 'disabled'} />
        </label>
        <p class="muted settings-org-role">Your role: <strong>${escapeHtml(roleLabel(org?.role))}</strong></p>
        ${admin ? '<div><button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="settingsOrgSave">Save</button></div>' : ''}
      </div>
    </section>`;
}

export function mountOrganisationSection() {
  const btn = $('settingsOrgSave');
  const input = /** @type {HTMLInputElement|null} */ ($('settingsOrgName'));
  const org = getActiveOrganisation();
  if (!btn || !input || !org) return () => {};

  const onSave = async () => {
    const name = input.value.trim();
    if (!name) {
      toast('Name is required', true);
      return;
    }
    btn.setAttribute('disabled', '');
    try {
      await getDB().update('organisations', `id=eq.${encodeURIComponent(org.id)}`, { name, updated_at: new Date().toISOString() });
      org.name = name;
      toast('Organisation renamed');
      document.getElementById('sidebarWorkspaceSub')?.replaceChildren(document.createTextNode(name));
    } catch (err) {
      toast(String(err?.message || err), true);
    } finally {
      btn.removeAttribute('disabled');
    }
  };
  btn.addEventListener('click', onSave);
  return () => btn.removeEventListener('click', onSave);
}

export function renderHistorySection() {
  const tableOpts = Object.entries(AUDIT_TABLE_LABELS)
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join('');
  return `
    <section class="settings-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Change history</h2>
          <p class="settings-card-desc muted">Every change to catalogue, pricing, orders and stock records, written by the database.</p>
        </div>
      </header>
      <div class="settings-card-search settings-history-filters">
        <select class="admin-select" id="settingsHistoryTable" aria-label="Filter by record type">
          <option value="">All records</option>${tableOpts}
        </select>
        <input type="search" class="admin-input" id="settingsHistoryActor" placeholder="Filter by user email…" autocomplete="off" />
      </div>
      <div class="settings-history" id="settingsHistory">${loadingWidget('Loading change history…')}</div>
    </section>`;
}

export function mountHistorySection() {
  const wrap = $('settingsHistory');
  const tableSel = /** @type {HTMLSelectElement|null} */ ($('settingsHistoryTable'));
  const actorInput = /** @type {HTMLInputElement|null} */ ($('settingsHistoryActor'));
  if (!wrap) return () => {};
  if (!isOrgAdmin()) {
    wrap.innerHTML = '<p class="muted">Only organisation admins can view the change history.</p>';
    return () => {};
  }

  let rows = [];
  let offset = 0;
  let done = false;
  let aborted = false;
  let debounce = 0;

  function paint() {
    if (!rows.length) {
      wrap.innerHTML = '<p class="muted settings-list-empty">No changes recorded for these filters.</p>';
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table settings-history-table">
        <thead><tr><th>When</th><th>Who</th><th>Record</th><th>Change</th></tr></thead>
        <tbody>${rows.map((r) => {
          const d = describeAuditRow(r);
          return `<tr>
            <td class="settings-history-when">${escapeHtml(new Date(r.at).toLocaleString())}</td>
            <td>${escapeHtml(r.actor_email || 'System')}</td>
            <td>${escapeHtml(d.record)}</td>
            <td class="settings-history-change">${escapeHtml(d.summary)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      ${done ? '' : '<div class="settings-history-more"><button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-history-more>Load more</button></div>'}`;
  }

  async function load(reset) {
    if (reset) {
      rows = [];
      offset = 0;
      done = false;
      wrap.innerHTML = loadingWidget('Loading change history…');
    }
    const params = [
      'select=id,table_name,row_id,op,old_data,new_data,changed_cols,actor_email,at',
      'order=at.desc',
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
    ];
    if (tableSel?.value) params.push(`table_name=eq.${encodeURIComponent(tableSel.value)}`);
    const actor = actorInput?.value.trim();
    if (actor) params.push(`actor_email=ilike.*${encodeURIComponent(actor)}*`);
    try {
      const page = await getDB().select('audit_log', `?${params.join('&')}`);
      if (aborted) return;
      rows = rows.concat(page || []);
      offset += (page || []).length;
      done = (page || []).length < PAGE_SIZE;
      paint();
    } catch (err) {
      if (aborted) return;
      wrap.innerHTML = errorState({ title: 'Could not load history', copy: err?.message || String(err), variant: 'admin' });
      bindEmptyRetry(wrap, () => load(true));
    }
  }

  const onClick = (e) => {
    if (e.target.closest('[data-history-more]')) load(false);
  };
  const onFilter = () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => load(true), 250);
  };
  wrap.addEventListener('click', onClick);
  tableSel?.addEventListener('change', onFilter);
  actorInput?.addEventListener('input', onFilter);
  load(true);

  return () => {
    aborted = true;
    clearTimeout(debounce);
    wrap.removeEventListener('click', onClick);
    tableSel?.removeEventListener('change', onFilter);
    actorInput?.removeEventListener('input', onFilter);
  };
}
