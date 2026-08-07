/**
 * Admin — Users & access (Supabase Auth profiles).
 * Invite, edit profile/role, reset passwords, disable, or delete.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { authFetch, getCachedProfile } from '../../lib/auth.js';
import { openSheet, closeSheet } from '../../components/sheet.js';

/** @type {Array<Record<string, unknown>>} */
let cachedProfiles = [];

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
            Invite teammates, manage roles and profiles, reset passwords, or remove access.
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
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="usersInviteSend">Create invite link</button>
        </div>
        <p class="muted" style="margin-top:0.5rem;font-size:0.8rem;">
          Creates an active account and a link where they set their own name and password — nothing is emailed.
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
  actions.push(`<button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-act="edit" data-id="${escapeHtml(p.id)}">${isSelf ? 'Edit' : 'Manage'}</button>`);

  return `
    <tr data-user-id="${escapeHtml(p.id)}">
      <td>${escapeHtml(p.display_name || '—')}${isSelf ? ' <span class="muted">(you)</span>' : ''}</td>
      <td>${escapeHtml(p.email || '—')}</td>
      <td>${escapeHtml(p.role || '—')}</td>
      <td>${statusBadge(p.status)}</td>
      <td class="users-actions">${actions.join(' ')}</td>
    </tr>`;
}

function showSetupResult(data) {
  const box = $('usersSetupResult');
  if (!box) return;
  const link = data.setup_link || '';
  const login = data.login_url || 'https://measured-stock.vercel.app/login';
  box.hidden = false;
  box.innerHTML = `
    <p><strong>Invite ready</strong> — share this link privately (not emailed):</p>
    <div class="users-setup-link-row">
      <input class="admin-input" type="text" readonly id="usersSetupLink" value="${escapeHtml(link)}" />
      <button type="button" class="admin-drawer-btn" id="usersCopyLink">Copy link</button>
    </div>
    <p class="muted" style="margin-top:0.5rem;font-size:0.8rem;">
      They open the link, choose a name and password on the signup form, then land in the app.
      Later they sign in at <a href="${escapeHtml(login)}">${escapeHtml(login)}</a>.
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

function showTempPassword(password, loginUrl) {
  const login = loginUrl || 'https://measured-stock.vercel.app/login';
  openSheet({
    title: 'Temporary password',
    variant: 'admin-full',
    bodyHtml: `
      <div class="admin-drawer-form">
        <p>Share this password privately. They can change it after signing in.</p>
        <div class="admin-field">
          <label class="admin-label" for="usersTempPassword">Password</label>
          <div class="users-setup-link-row">
            <input class="admin-input" type="text" readonly id="usersTempPassword" value="${escapeHtml(password)}" />
            <button type="button" class="admin-drawer-btn" id="usersCopyPassword">Copy</button>
          </div>
        </div>
        <p class="wst-form-hint muted">Sign-in: <a href="${escapeHtml(login)}">${escapeHtml(login)}</a></p>
      </div>`,
    footHtml: `
      <div class="admin-drawer-foot">
        <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="usersTempDone">Done</button>
      </div>`,
  });
  $('usersTempDone').onclick = closeSheet;
  $('usersCopyPassword')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast('Password copied');
    } catch {
      $('usersTempPassword')?.select();
      toast('Select and copy the password', true);
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
  cachedProfiles = data.profiles || [];
  if (!cachedProfiles.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No users yet. Add someone with a setup link.</td></tr>`;
    return;
  }
  tbody.innerHTML = cachedProfiles.map((p) => rowHtml(p, selfId)).join('');
}

async function patchUser(id, patch) {
  const res = await authFetch('/api/auth/users', {
    method: 'PATCH',
    body: JSON.stringify({ id, ...patch }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Update failed');
  return data;
}

async function deleteUser(id) {
  const res = await authFetch('/api/auth/users', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'Delete failed');
  return data;
}

function openUserEditor(userId) {
  const profile = cachedProfiles.find((p) => p.id === userId);
  if (!profile) {
    toast('User not found', true);
    return;
  }
  const selfId = getCachedProfile()?.id;
  const isSelf = profile.id === selfId;

  openSheet({
    title: isSelf ? 'Edit your profile' : 'Manage user',
    variant: 'admin-full',
    bodyHtml: `
      <div class="admin-drawer-form">
        <div class="del-form-err" id="usersEditErr"></div>
        <div class="admin-field">
          <label class="admin-label" for="usersEditName">Display name</label>
          <input class="admin-input" type="text" id="usersEditName" maxlength="40" placeholder="Name shown in the app" />
        </div>
        <div class="admin-field">
          <label class="admin-label" for="usersEditEmail">Email</label>
          <input class="admin-input" type="email" id="usersEditEmail" placeholder="name@company.com" />
        </div>
        <div class="admin-field">
          <label class="admin-label" for="usersEditRole">Role</label>
          <select class="admin-input" id="usersEditRole" ${isSelf ? 'disabled' : ''}>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          ${isSelf ? '<p class="wst-form-hint muted">You cannot change your own role.</p>' : ''}
        </div>
        <div class="admin-field">
          <label class="admin-label" for="usersEditStatus">Status</label>
          <select class="admin-input" id="usersEditStatus" ${isSelf ? 'disabled' : ''}>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
          ${isSelf ? '<p class="wst-form-hint muted">You cannot disable your own account.</p>' : ''}
        </div>
        ${!isSelf ? `
        <div class="users-edit-divider"></div>
        <div class="admin-field">
          <label class="admin-label" for="usersEditPassword">Reset password</label>
          <div class="users-invite-row">
            <input class="admin-input" type="text" id="usersEditPassword" placeholder="Leave blank to auto-generate" autocomplete="new-password" />
            <button type="button" class="admin-drawer-btn" id="usersResetPassword">Reset</button>
          </div>
          <p class="wst-form-hint muted">Sets a temporary password you can copy and share privately.</p>
        </div>` : ''}
      </div>`,
    footHtml: `
      <div class="admin-drawer-foot admin-drawer-foot--split">
        ${!isSelf ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="usersEditDelete">Delete user</button>' : '<span></span>'}
        <div class="admin-drawer-foot-actions">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="usersEditCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="usersEditSave">Save changes</button>
        </div>
      </div>`,
  });

  $('usersEditName').value = profile.display_name || '';
  $('usersEditEmail').value = profile.email || '';
  $('usersEditRole').value = profile.role === 'admin' ? 'admin' : 'staff';
  $('usersEditStatus').value = ['pending', 'active', 'disabled'].includes(profile.status)
    ? profile.status
    : 'active';

  $('usersEditCancel').onclick = closeSheet;

  $('usersEditSave').onclick = async () => {
    const errEl = $('usersEditErr');
    const btn = $('usersEditSave');
    const display_name = $('usersEditName')?.value?.trim() || '';
    const email = $('usersEditEmail')?.value?.trim() || '';
    if (!email || !email.includes('@')) {
      if (errEl) errEl.textContent = 'Enter a valid email.';
      return;
    }
    /** @type {Record<string, unknown>} */
    const patch = { display_name, email };
    if (!isSelf) {
      patch.role = $('usersEditRole')?.value || 'staff';
      patch.status = $('usersEditStatus')?.value || 'active';
    }
    btn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
      await patchUser(profile.id, patch);
      closeSheet();
      toast('User updated');
      await loadUsers();
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Update failed';
    } finally {
      btn.disabled = false;
    }
  };

  $('usersResetPassword')?.addEventListener('click', async () => {
    const errEl = $('usersEditErr');
    const btn = $('usersResetPassword');
    const custom = $('usersEditPassword')?.value?.trim() || '';
    if (custom && custom.length < 8) {
      if (errEl) errEl.textContent = 'Password must be at least 8 characters.';
      return;
    }
    if (!confirm(`Reset password for ${profile.email || 'this user'}?`)) return;
    btn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
      const data = await patchUser(profile.id, {
        reset_password: true,
        ...(custom ? { password: custom } : {}),
      });
      closeSheet();
      toast('Password reset');
      if (data.temporary_password) {
        showTempPassword(data.temporary_password, data.login_url);
      }
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Reset failed';
    } finally {
      btn.disabled = false;
    }
  });

  $('usersEditDelete')?.addEventListener('click', async () => {
    const errEl = $('usersEditErr');
    const label = profile.email || profile.display_name || 'this user';
    if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
    const btn = $('usersEditDelete');
    btn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
      await deleteUser(profile.id);
      closeSheet();
      toast('User deleted');
      await loadUsers();
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Delete failed';
      btn.disabled = false;
    }
  });
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
        body: JSON.stringify({ email, role, mode: 'link' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Create failed');
      toast('Invite link ready');
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
      if (act === 'activate') {
        await patchUser(id, { status: 'active' });
        toast('Activated');
        await loadUsers();
      } else if (act === 'edit') {
        openUserEditor(id);
      }
    } catch (err) {
      toast(err.message || 'Update failed', true);
    }
  });

  loadUsers().catch((err) => toast(err.message || 'Failed to load users', true));
  return () => {};
}
