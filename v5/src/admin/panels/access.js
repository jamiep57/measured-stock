/**
 * Workspace settings — turn features on or off for each role.
 * Sysadmin is always on and is only shown to a sysadmin.
 * Developer rows are only shown to a sysadmin.
 */

import { escapeHtml, toast } from '../../lib/util.js';
import { getDB } from '../../db.js';
import { getCachedProfile } from '../../lib/auth.js';
import { isSysadmin } from '../../lib/organisations.js';
import { applyNavPermissions } from '../sidebar.js';
import {
  FEATURE_GROUPS,
  ROLE_LABELS,
  canEditGrant,
  defaultEnabled,
  setGrant,
} from '../../lib/permissions.js';

const COLUMN_ROLES = ['user', 'manager', 'admin'];

function columns() {
  const roles = [...COLUMN_ROLES];
  if (isSysadmin()) roles.push('sysadmin');
  return roles;
}

function cellChecked(role, feature, stored) {
  if (role === 'sysadmin') return true;
  const key = `${role}:${feature}`;
  if (stored.has(key)) return stored.get(key);
  return defaultEnabled(role, feature);
}

export function renderAccessSection() {
  const viewer = getCachedProfile()?.role;
  const sysadmin = isSysadmin();
  const roles = columns();
  const groups = FEATURE_GROUPS.filter((group) => !group.developer || sysadmin);
  const lead = sysadmin
    ? 'Choose what each role can open. Sysadmin stays fully on. Users and Access stay on for Admin so the organisation cannot be locked out.'
    : 'Choose what each role can open. Users and Access stay on for Admin so the organisation cannot be locked out.';

  const head = roles.map((role) => `<th scope="col">${escapeHtml(ROLE_LABELS[role])}</th>`).join('');
  const body = groups.map((group) => {
    const groupRow = `<tr class="access-group"><td colspan="${roles.length + 1}">${escapeHtml(group.label)}</td></tr>`;
    const rows = group.features.map((feature) => {
      const cells = roles.map((role) => {
        const locked = !canEditGrant(viewer, role, feature.key);
        return `<td>
          <button type="button" class="access-switch${locked ? ' is-locked' : ''}"
            role="switch"
            aria-checked="false"
            aria-label="${escapeHtml(`${feature.label} for ${ROLE_LABELS[role]}`)}"
            data-access-role="${escapeHtml(role)}"
            data-access-feature="${escapeHtml(feature.key)}"
            ${locked ? 'disabled' : ''}>
            <span class="access-switch-knob"></span>
          </button>
        </td>`;
      }).join('');
      return `<tr><th scope="row">${escapeHtml(feature.label)}</th>${cells}</tr>`;
    }).join('');
    return groupRow + rows;
  }).join('');

  return `
    <section class="settings-section access-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Access</h2>
          <p class="settings-card-desc muted">${escapeHtml(lead)}</p>
        </div>
      </header>
      <div class="access-scroll" id="accessScroll">
        <table class="access-table">
          <thead><tr><th scope="col">Feature</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

function paintSwitches(stored) {
  document.querySelectorAll('[data-access-feature]').forEach((button) => {
    const role = button.dataset.accessRole;
    const feature = button.dataset.accessFeature;
    const on = cellChecked(role, feature, stored);
    button.setAttribute('aria-checked', on ? 'true' : 'false');
    button.classList.toggle('is-on', on);
  });
}

export function mountAccessSection() {
  const stored = new Map();
  const orgId = getCachedProfile()?.active_org_id;
  let saving = false;

  async function refresh() {
    if (orgId) {
      try {
        const rows = await getDB().select(
          'organisation_role_permissions',
          `?org_id=eq.${encodeURIComponent(orgId)}&select=role,feature,enabled`,
        );
        stored.clear();
        for (const row of Array.isArray(rows) ? rows : []) {
          stored.set(`${row.role}:${row.feature}`, !!row.enabled);
          setGrant(row.role, row.feature, !!row.enabled);
        }
      } catch (err) {
        console.warn('access grants', err);
      }
    }
    paintSwitches(stored);
  }

  document.querySelectorAll('[data-access-feature]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled || saving) return;
      const role = button.dataset.accessRole;
      const feature = button.dataset.accessFeature;
      if (!canEditGrant(getCachedProfile()?.role, role, feature)) return;
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', next ? 'true' : 'false');
      button.classList.toggle('is-on', next);
      saving = true;
      try {
        await getDB().upsert('organisation_role_permissions', [{
          org_id: orgId,
          role,
          feature,
          enabled: next,
        }], { onConflict: 'org_id,role,feature' });
        stored.set(`${role}:${feature}`, next);
        setGrant(role, feature, next);
        applyNavPermissions();
      } catch (err) {
        button.setAttribute('aria-checked', next ? 'false' : 'true');
        button.classList.toggle('is-on', !next);
        toast(err.message || 'Could not save access', true);
      } finally {
        saving = false;
      }
    });
  });

  refresh();

  return () => {};
}
