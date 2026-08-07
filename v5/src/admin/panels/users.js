/**
 * Admin — Users & access (Supabase Auth profiles).
 * No mail server required: create a copyable setup link or temp password.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { authFetch, getCachedProfile } from '../../lib/auth.js';

function statusBadge(status) {
  const s = String(status || '');
  const cls =
    s === 'active' ? 'users-badge users-badge--active'
      : s === 'pending' ? 'users-badge users-badge--pending'
        : 'users-badge users-badge--disabled';
  return `<span class="${cls}">${escapeHtml(s)}</span>`;
}

/** Inner Users UI for embedding in Workspace settings (no page chrome). */
export function renderUsersSection() {
  return `
    <div class="settings-section users-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Users</h2>
          <p class="settings-card-desc muted">
            Create an account and share a setup link, or activate pending users.
            Email delivery is optional and can be wired later.
          </p>
        </div>
        <div class="settings-card-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="usersInviteBtn">Add user</button>
        </div>
      </header>
      <div id="usersInviteForm" class="users-invite" hidden>
        <label class="admin-label" for="usersInviteEmail">Email</label>
        <div class="users-invite-row">
          <input class="admin-input" type="email" id="usersInviteEmail" placeholder="name@company.com" />
          <select class="admin-input" id="usersInviteRole" style="max-width:8rem;">
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="usersInviteSend">Create account</button>
        </div>
        <p class="muted" style="margin-top:0.5rem;font-size:0.8rem;">
          Creates an active account with a temporary password you can copy — nothing is emailed.
        </p>
        <div id="usersSetupResult" class="users-setup-result" hidden></div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table" id="usersTable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="usersTbody">
            <tr><td colspan="5" class="muted">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function rowHtml(p, selfId) {
  const isSelf = p.id === selfId;
  const actions = [];
  if (p.status === 'pending') {
    actions.push(`<button type="button" class="admin-drawer-btn" data-act="activate" data-id="${escapeHtml(p.id)}">Activate</button>`);
  }
  if (p.status === 'active' && !isSelf) {
    actions.push(`<button type="button" class="admin-drawer-btn" data-act="disable" data-id="${escapeHtml(p.id)}">Disable</button>`);
  }
  if (p.status === 'disabled') {
    actions.push(`<button type="button" class="admin-drawer-btn" data-act="activate" data-id="${escapeHtml(p.id)}">Re-activate</button>`);
  }
  if (p.role === 'staff' && p.status === 'active') {
    actions.push(`<button type="button" class="admin-drawer-btn" data-act="make-admin" data-id="${escapeHtml(p.id)}">Make admin</button>`);
  }
  if (p.role === 'admin' && p.status === 'active' && !isSelf) {
    actions.push(`<button type="button" class="admin-drawer-btn" data-act="make-staff" data-id="${escapeHtml(p.id)}">Make staff</button>`);
  }

  return `
    <tr data-user-id="${escapeHtml(p.id)}">
      <td>${escapeHtml(p.display_name || '—')}</td>
      <td>${escapeHtml(p.email || '—')}</td>
      <td>${escapeHtml(p.role || '—')}</td>
      <td>${statusBadge(p.status)}</td>
      <td class="users-actions">${actions.join(' ')}</td>
    </tr>`;
}

function showSetupResult(data) {
  const box = $('usersSetupResult');
  if (!box) return;
  const login = data.login_url || 'https://measured-stock.vercel.app/login';
  const password = data.temporary_password || '';
  const link = data.setup_link || '';
  box.hidden = false;

  if (password) {
    box.innerHTML = `
      <p><strong>Account created</strong> — share these privately (not emailed):</p>
      <p class="muted" style="margin:0.5rem 0 0.25rem;font-size:0.8rem;">Login</p>
      <div class="users-setup-link-row">
        <input class="admin-input" type="text" readonly id="usersSetupLogin" value="${escapeHtml(login)}" />
        <button type="button" class="admin-drawer-btn" id="usersCopyLogin">Copy</button>
      </div>
      <p class="muted" style="margin:0.75rem 0 0.25rem;font-size:0.8rem;">Temporary password</p>
      <div class="users-setup-link-row">
        <input class="admin-input" type="text" readonly id="usersSetupPassword" value="${escapeHtml(password)}" />
        <button type="button" class="admin-drawer-btn" id="usersCopyPassword">Copy</button>
      </div>
      <p class="muted" style="margin-top:0.5rem;font-size:0.8rem;">
        Email: <strong>${escapeHtml(data.email || '')}</strong>
      </p>
    `;
    const copy = async (id, label) => {
      const input = $(id);
      try {
        await navigator.clipboard.writeText(input?.value || '');
        toast(`${label} copied`);
      } catch {
        input?.select();
        toast('Select and copy', true);
      }
    };
    $('usersCopyLogin')?.addEventListener('click', () => copy('usersSetupLogin', 'Login URL'));
    $('usersCopyPassword')?.addEventListener('click', () => copy('usersSetupPassword', 'Password'));
    return;
  }

  box.innerHTML = `
    <p><strong>Account created</strong> — share this privately (not emailed):</p>
    <div class="users-setup-link-row">
      <input class="admin-input" type="text" readonly id="usersSetupLink" value="${escapeHtml(link)}" />
      <button type="button" class="admin-drawer-btn" id="usersCopyLink">Copy link</button>
    </div>
    <p class="muted" style="margin-top:0.5rem;font-size:0.8rem;">
      After opening the link they can sign in at <a href="${escapeHtml(login)}">${escapeHtml(login)}</a>.
    </p>
  `;
  $('usersCopyLink')?.addEventListener('click', async () => {
    const input = $('usersSetupLink');
    try {
      await navigator.clipboard.writeText(input?.value || link);
      toast('Link copied');
    } catch {
      input?.select();
      toast('Select and copy the link', true);
    }
  });
}

async function loadUsers() {
  const tbody = $('usersTbody');
  if (!tbody) return;
  const res = await authFetch('/api/auth/users');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Failed to load users (${escapeHtml(data.error || String(res.status))})</td></tr>`;
    return;
  }
  const selfId = getCachedProfile()?.id;
  const profiles = data.profiles || [];
  if (!profiles.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No users yet. Add someone with a setup link.</td></tr>`;
    return;
  }
  tbody.innerHTML = profiles.map((p) => rowHtml(p, selfId)).join('');
}

async function patchUser(id, patch) {
  const res = await authFetch('/api/auth/users', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...patch }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Update failed');
  return data.profile;
}

export function mountUsersPanel() {
  const inviteBtn = $('usersInviteBtn');
  const form = $('usersInviteForm');
  inviteBtn?.addEventListener('click', () => {
    if (form) form.hidden = !form.hidden;
  });

  $('usersInviteSend')?.addEventListener('click', async () => {
    const email = $('usersInviteEmail')?.value?.trim();
    const role = $('usersInviteRole')?.value || 'staff';
    if (!email) {
      toast('Enter an email', true);
      return;
    }
    try {
      const res = await authFetch('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({ email, role, mode: 'password' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Create failed');
      toast('Account created');
      showSetupResult(data);
      await loadUsers();
    } catch (err) {
      toast(err.message || 'Create failed', true);
    }
  });

  $('usersTbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    try {
      if (act === 'activate') await patchUser(id, { status: 'active' });
      else if (act === 'disable') await patchUser(id, { status: 'disabled' });
      else if (act === 'make-admin') await patchUser(id, { role: 'admin' });
      else if (act === 'make-staff') await patchUser(id, { role: 'staff' });
      toast('Updated');
      await loadUsers();
    } catch (err) {
      toast(err.message || 'Update failed', true);
    }
  });

  loadUsers().catch((err) => toast(err.message || 'Failed to load users', true));
  return () => {};
}
