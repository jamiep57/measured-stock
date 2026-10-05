import { describe, expect, it } from 'vitest';
import {
  ADMIN_LOCKED_ON,
  allFeatureKeys,
  assignableRoles,
  defaultEnabled,
  fallbackRoute,
  needsDesktopShell,
  normalizeRole,
  routeAllowed,
} from '../../../lib/access-model.js';

describe('access roles', () => {
  it('maps the old staff role onto user', () => {
    expect(normalizeRole('staff')).toBe('user');
    expect(normalizeRole('sysadmin')).toBe('sysadmin');
    expect(normalizeRole('nope')).toBe('user');
  });

  it('hides sysadmin from the roles an admin can assign', () => {
    expect(assignableRoles('admin').map((role) => role.value)).toEqual(['user', 'manager', 'admin']);
    expect(assignableRoles('sysadmin').map((role) => role.value)).toContain('sysadmin');
  });

  it('keeps developer tools off for admin and financials off for manager', () => {
    for (const feature of allFeatureKeys()) {
      expect(defaultEnabled('sysadmin', feature)).toBe(true);
      if (feature.startsWith('dev.')) expect(defaultEnabled('admin', feature)).toBe(false);
      else expect(defaultEnabled('admin', feature)).toBe(true);
    }
    expect(defaultEnabled('manager', 'stock.products_edit')).toBe(true);
    expect(defaultEnabled('manager', 'stock.deliveries')).toBe(true);
    expect(defaultEnabled('manager', 'planning.menu_gp')).toBe(false);
    expect(defaultEnabled('manager', 'finance.reports')).toBe(false);
    expect(defaultEnabled('manager', 'finance.recon')).toBe(false);
    expect(defaultEnabled('user', 'stock.deliveries')).toBe(true);
    expect(defaultEnabled('user', 'stock.counts')).toBe(true);
    expect(defaultEnabled('user', 'stock.products_edit')).toBe(false);
    expect(defaultEnabled('user', 'stock.transfers')).toBe(false);
  });

  it('locks the admin users and access pages on', () => {
    expect(ADMIN_LOCKED_ON.has('workspace.users')).toBe(true);
    expect(ADMIN_LOCKED_ON.has('workspace.access')).toBe(true);
  });

  it('sends a base user to the field app and a user with library access to the desktop', () => {
    expect(needsDesktopShell('user', [])).toBe(false);
    expect(needsDesktopShell('manager', [])).toBe(true);
    expect(needsDesktopShell('user', [{ role: 'user', feature: 'home.library', enabled: true }])).toBe(true);
  });

  it('blocks a direct financial URL for a manager default', () => {
    const can = (feature) => defaultEnabled('manager', feature);
    expect(routeAllowed({ view: 'event', eventId: 'e', panel: 'reports' }, can)).toBe(false);
    expect(routeAllowed({ view: 'event', eventId: 'e', panel: 'deliveries' }, can)).toBe(true);
    expect(fallbackRoute({ view: 'event', eventId: 'e', panel: 'reports' }, can).panel).toBe('dashboard');
  });
});
