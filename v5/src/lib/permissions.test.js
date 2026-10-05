import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_LOCKED_ON,
  FEATURE_GROUPS,
  allFeatureKeys,
  assignableRoles,
  canEditGrant,
  defaultEnabled,
  fallbackRoute,
  featureForRoute,
  needsDesktopShell,
  normalizeRole,
  routeAllowed,
} from '../../../lib/access-model.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function canFor(role) {
  return (feature) => defaultEnabled(role, feature);
}

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
    const can = canFor('manager');
    expect(routeAllowed({ view: 'event', eventId: 'e', panel: 'reports' }, can)).toBe(false);
    expect(routeAllowed({ view: 'event', eventId: 'e', panel: 'deliveries' }, can)).toBe(true);
    expect(fallbackRoute({ view: 'event', eventId: 'e', panel: 'reports' }, can).panel).toBe('dashboard');
  });

  it('sends each role to a page they are allowed to open', () => {
    const manager = canFor('manager');
    const user = canFor('user');
    const admin = canFor('admin');

    expect(fallbackRoute({ view: 'settings', section: 'access' }, manager)).toEqual({
      view: 'settings',
      section: 'warehouses',
    });
    expect(fallbackRoute({ view: 'settings', section: 'access' }, user)).toEqual({ view: 'home' });
    expect(fallbackRoute({ view: 'event', eventId: 'e', panel: 'planning' }, user)).toEqual({
      view: 'event',
      eventId: 'e',
      panel: 'deliveries',
    });
    expect(routeAllowed({ view: 'dev' }, admin)).toBe(false);
    expect(fallbackRoute({ view: 'dev' }, admin).view).toBe('library');
    expect(routeAllowed({ view: 'settings', section: 'access' }, admin)).toBe(true);
    expect(routeAllowed({ view: 'settings', section: 'users' }, manager)).toBe(false);
  });

  it('only lets an org admin edit the grid, and keeps admin Users and Access locked', () => {
    expect(canEditGrant('user', 'user', 'stock.deliveries')).toBe(false);
    expect(canEditGrant('manager', 'user', 'stock.deliveries')).toBe(false);
    expect(canEditGrant('admin', 'user', 'stock.deliveries')).toBe(true);
    expect(canEditGrant('admin', 'sysadmin', 'home.dashboard')).toBe(false);
    expect(canEditGrant('sysadmin', 'sysadmin', 'home.dashboard')).toBe(false);
    expect(canEditGrant('admin', 'admin', 'workspace.users')).toBe(false);
    expect(canEditGrant('sysadmin', 'admin', 'workspace.access')).toBe(false);
    expect(canEditGrant('admin', 'manager', 'dev.bugs')).toBe(false);
    expect(canEditGrant('sysadmin', 'manager', 'dev.bugs')).toBe(true);
    expect(canEditGrant('admin', 'admin', 'finance.reports')).toBe(true);
  });

  it('gives every nav feature a route check and a default for each role', () => {
    const adminHtml = readFileSync(resolve(repoRoot, 'v5/admin.html'), 'utf8');
    const navFeatures = [...adminHtml.matchAll(/data-feature="([^"]+)"/g)].map((match) => match[1]);
    const keys = new Set(allFeatureKeys());
    expect(navFeatures.length).toBeGreaterThan(10);
    for (const feature of navFeatures) expect(keys.has(feature)).toBe(true);

    for (const feature of allFeatureKeys()) {
      expect(typeof defaultEnabled('user', feature)).toBe('boolean');
      expect(typeof defaultEnabled('manager', feature)).toBe('boolean');
      expect(defaultEnabled('admin', feature)).toBe(!feature.startsWith('dev.'));
      expect(defaultEnabled('sysadmin', feature)).toBe(true);
    }

    const adminCss = readFileSync(resolve(repoRoot, 'v5/src/styles/admin.css'), 'utf8');
    const fieldCss = readFileSync(resolve(repoRoot, 'v5/src/styles/v5.css'), 'utf8');
    expect(adminCss).toMatch(/\.nav-link\[hidden\][\s\S]*?display:\s*none\s*!important/);
    expect(adminCss).toMatch(/\.topbar-menu-item\[hidden\][\s\S]*?display:\s*none\s*!important/);
    expect(fieldCss).toMatch(/\.navbtn\[hidden\][\s\S]*?display:\s*none\s*!important/);
    expect(fieldCss).toMatch(/\.compose-fab-item\[hidden\][\s\S]*?display:\s*none\s*!important/);

    expect(featureForRoute({ view: 'settings', section: 'access' })).toBe('workspace.access');
    expect(featureForRoute({ view: 'event', panel: 'counts' })).toBe('stock.counts');
    expect(FEATURE_GROUPS.some((group) => group.features.some((feature) => feature.key === 'stock.products_edit'))).toBe(true);
  });
});
