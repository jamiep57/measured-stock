/**
 * Signed-in feature access. Defaults live in lib/access-model.js;
 * organisation_role_permissions overrides them per role.
 */

import { getDB } from '../db.js';
import {
  normalizeRole,
  defaultEnabled,
  isSysadminRole,
  needsDesktopShell,
  featureForRoute,
  routeAllowed as routeAllowedWith,
  fallbackRoute as fallbackRouteWith,
  firstSettingsSection as firstSettingsSectionWith,
} from '../../../lib/access-model.js';

export {
  FEATURE_GROUPS,
  ROLE_LABELS,
  SETTINGS_FEATURES,
  assignableRoles,
  roleLabel,
  isOrgAdminRole,
  isSysadminRole,
  canEditGrant,
  defaultEnabled,
  needsDesktopShell,
  normalizeRole,
} from '../../../lib/access-model.js';

/** @type {string} */
let currentRole = 'user';

/** @type {Map<string, boolean>} */
let grants = new Map();

function grantKey(role, feature) {
  return `${role}:${feature}`;
}

/** @param {{ role?: string, permissions?: Array<{ role?: string, feature?: string, enabled?: boolean }> } | null | undefined} profile */
export function hydratePermissions(profile) {
  currentRole = normalizeRole(profile?.role);
  grants = new Map();
  for (const row of profile?.permissions || []) {
    if (!row?.role || !row.feature) continue;
    grants.set(grantKey(row.role, row.feature), !!row.enabled);
  }
}

/** @param {string} feature */
export function can(feature) {
  if (isSysadminRole(currentRole)) return true;
  const key = grantKey(currentRole, feature);
  if (grants.has(key)) return grants.get(key) === true;
  return defaultEnabled(currentRole, feature);
}

/** @param {string} role @param {string} feature @param {boolean} enabled */
export function setGrant(role, feature, enabled) {
  grants.set(grantKey(role, feature), !!enabled);
}

/** Reload the active organisation's grants. Missing table falls back to defaults. */
export async function loadPermissions(orgId) {
  if (!orgId) return;
  try {
    const rows = await getDB().select(
      'organisation_role_permissions',
      `?org_id=eq.${encodeURIComponent(orgId)}&select=role,feature,enabled`,
    );
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row?.role || !row.feature) continue;
      grants.set(grantKey(row.role, row.feature), !!row.enabled);
    }
  } catch (err) {
    console.warn('loadPermissions', err);
  }
}

/** @param {{ view?: string, panel?: string, section?: string }} route */
export function routeAllowed(route) {
  return routeAllowedWith(route, can);
}

/** @param {{ view?: string, eventId?: string }} route */
export function fallbackRoute(route) {
  return fallbackRouteWith(route, can);
}

export function firstSettingsSection() {
  return firstSettingsSectionWith(can);
}

export function canOpenSettings() {
  return !!firstSettingsSection();
}

export function canOpenDev() {
  return can('dev.bugs') || can('dev.audit') || can('dev.backup');
}

/** @param {unknown} role @param {Array<{ role?: string, feature?: string, enabled?: boolean }>} [permissionRows] */
export function profileNeedsDesktop(role, permissionRows) {
  return needsDesktopShell(role, permissionRows);
}

export function featureFor(route) {
  return featureForRoute(route);
}
