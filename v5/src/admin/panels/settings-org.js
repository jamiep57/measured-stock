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
import { authFetch } from '../../lib/auth.js';

const PAGE_SIZE = 100;

export function renderOrganisationSection() {
  const org = getActiveOrganisation();
  const admin = isOrgAdmin();
  return `
    <section class="settings-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Organisation</h2>
          <p class="settings-card-desc muted">Products, events, suppliers and users are isolated per organisation.</p>
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

export function renderSquareSection() {
  return `
    <section class="settings-section" id="settingsSquare">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Square</h2>
          <p class="settings-card-desc muted">Connect Square to pull till sales into an event. Uploaded sales files stay available until you switch that event over.</p>
        </div>
      </header>
      <div class="admin-drawer-form settings-org-form" id="settingsSquareBody"><p class="muted">Loading Square…</p></div>
    </section>`;
}

const SQUARE_STATUS = 'org_id,merchant_id,environment,merchant_name,connected_at,last_sync_at,last_webhook_at,last_error';

function squareReason(code) {
  const reasons = {
    denied: 'Square connection was cancelled.',
    not_configured: 'Square app keys are not set on the server yet.',
    state: 'That connection link expired. Try again.',
    exchange: 'Square did not accept the connection.',
    merchant_taken: 'That Square account is already connected to another organisation.',
  };
  return reasons[code] || 'Square could not be connected.';
}

function paintSquareStatus(body, row) {
  const admin = isOrgAdmin();
  if (!row) {
    body.innerHTML = `
      <p class="muted">Not connected.</p>
      ${admin ? '<div class="settings-square-actions"><button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="settingsSquareConnect">Connect Square</button></div>' : '<p class="muted">An organisation admin can connect Square.</p>'}`;
    return;
  }
  const when = row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : 'not yet';
  body.innerHTML = `
    <p>Connected to <strong>${escapeHtml(row.merchant_name || row.merchant_id)}</strong> <span class="muted">(${escapeHtml(row.environment)})</span></p>
    <p class="muted">Last sales sync: ${escapeHtml(when)}</p>
    ${row.last_error ? `<p class="muted">${escapeHtml(row.last_error)}</p>` : ''}
    ${admin ? '<div class="settings-square-actions"><button type="button" class="admin-drawer-btn" id="settingsSquareDisconnect">Disconnect</button></div>' : ''}`;
}

export function mountSquareSection() {
  const org = getActiveOrganisation();
  const body = $('settingsSquareBody');
  if (!body || !org) return () => {};
  let disposed = false;

  const params = new URLSearchParams(window.location.search);
  const flag = params.get('square');
  if (flag) {
    if (flag === 'connected') toast('Square connected');
    else toast(squareReason(params.get('reason')), true);
    params.delete('square');
    params.delete('reason');
    const next = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (next ? `?${next}` : ''));
  }

  async function load() {
    try {
      const rows = await getDB().select(
        'org_square_connections',
        `?org_id=eq.${encodeURIComponent(org.id)}&select=${SQUARE_STATUS}`,
      );
      if (disposed) return;
      paintSquareStatus(body, rows?.[0] || null);
    } catch (err) {
      if (disposed) return;
      const missing = /org_square_connections|PGRST205|42P01/i.test(String(err?.message || err));
      if (missing) {
        paintSquareStatus(body, null);
        body.insertAdjacentHTML('afterbegin', '<p class="muted">The Square tables are not in this database yet (migration 084).</p>');
        return;
      }
      body.innerHTML = `<p class="muted">${escapeHtml(err?.message || 'Could not load Square')}</p>`;
    }
  }

  const onClick = async (event) => {
    const connect = event.target.closest?.('#settingsSquareConnect');
    const disconnect = event.target.closest?.('#settingsSquareDisconnect');
    if (!connect && !disconnect) return;
    const button = connect || disconnect;
    button.setAttribute('disabled', '');
    try {
      if (connect) {
        const res = await authFetch('/api/square/connect', { method: 'POST', body: '{}' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          throw new Error(data.error === 'not_configured'
            ? 'Square app keys are not set on the server yet.'
            : (data.message || 'Could not start the Square connection'));
        }
        window.location.assign(data.url);
        return;
      }
      const res = await authFetch('/api/square/disconnect', { method: 'POST', body: '{}' });
      if (!res.ok) throw new Error('Could not disconnect Square');
      toast('Square disconnected');
      await load();
    } catch (err) {
      toast(String(err?.message || err), true);
      button.removeAttribute('disabled');
    }
  };
  body.addEventListener('click', onClick);
  load();
  return () => {
    disposed = true;
    body.removeEventListener('click', onClick);
  };
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
