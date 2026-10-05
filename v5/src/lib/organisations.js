/**
 * Organisation (tenant) context for the signed-in user.
 * RLS scopes every query to profiles.active_org_id, so switching
 * organisation is a server-side RPC followed by a full reload.
 */

import { getCachedProfile } from './auth.js';
import { isOrgAdminRole, isSysadminRole } from './permissions.js';
import { getQueueStats } from '../sync-queue.js';

/** @returns {Array<{ id: string, name: string, role: 'sysadmin'|'admin'|'manager'|'user' }>} */
export function listOrganisations() {
  return getCachedProfile()?.organisations || [];
}

export function getActiveOrganisation() {
  const profile = getCachedProfile();
  if (!profile?.active_org_id) return null;
  return listOrganisations().find((o) => o.id === profile.active_org_id) || null;
}

export function isOrgAdmin() {
  return isOrgAdminRole(getActiveOrganisation()?.role);
}

export function isSysadmin() {
  return isSysadminRole(getActiveOrganisation()?.role);
}

/**
 * Pending offline writes belong to the current organisation; switching
 * before they flush would make RLS reject them.
 */
export async function canSwitchOrganisation() {
  try {
    const stats = await getQueueStats();
    return stats.total === 0;
  } catch {
    return true;
  }
}

function clearOrgScopedStorage() {
  try {
    sessionStorage.removeItem('v5-admin-active-event');
  } catch { /* ignore */ }
}

/** @param {string} orgId */
export async function switchOrganisation(orgId) {
  const DB = window.DB;
  await DB.rpc('set_active_org', { p_org: orgId });
  clearOrgScopedStorage();
  window.location.assign('/');
}

/** @param {string} name */
export async function createOrganisation(name) {
  const DB = window.DB;
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Organisation name is required');
  return DB.rpc('create_organisation', { p_name: trimmed });
}
