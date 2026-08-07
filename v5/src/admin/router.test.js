import { describe, expect, it } from 'vitest';
import { parseRoute, hrefForRoute } from '../admin/router.js';

describe('admin router', () => {
  it('parses home', () => {
    expect(parseRoute('/')).toEqual({ view: 'home' });
    expect(parseRoute('')).toEqual({ view: 'home' });
  });

  it('aliases legacy /v5/admin paths onto root routes', () => {
    expect(parseRoute('/v5/admin')).toEqual({ view: 'home' });
    expect(parseRoute('/v5/admin/')).toEqual({ view: 'home' });
    expect(parseRoute('/v5/admin.html')).toEqual({ view: 'home' });
    expect(parseRoute('/v5/admin/library')).toEqual({ view: 'library' });
    expect(parseRoute('/v5/admin/events/abc-123/deliveries')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'deliveries',
    });
    expect(parseRoute('/v5/admin/settings/users')).toEqual({
      view: 'settings',
      section: 'users',
    });
  });

  it('parses global catalog routes', () => {
    expect(parseRoute('/library')).toEqual({ view: 'library' });
    expect(parseRoute('/kit-library')).toEqual({ view: 'kit-library' });
    expect(parseRoute('/suppliers')).toEqual({ view: 'suppliers' });
    expect(parseRoute('/warehouses')).toEqual({ view: 'warehouses' });
    expect(parseRoute('/volume-pools')).toEqual({ view: 'volume-pools' });
  });

  it('parses workspace settings (+ section)', () => {
    expect(parseRoute('/settings')).toEqual({ view: 'settings', section: 'users' });
    expect(parseRoute('/settings/users')).toEqual({ view: 'settings', section: 'users' });
    expect(parseRoute('/settings/warehouses')).toEqual({ view: 'settings', section: 'warehouses' });
    expect(parseRoute('/settings/categories')).toEqual({ view: 'settings', section: 'categories' });
    expect(parseRoute('/settings/case-sizes')).toEqual({ view: 'settings', section: 'case-sizes' });
  });

  it('rejects unknown settings sections', () => {
    expect(parseRoute('/settings/nope')).toEqual({ view: 'not-found' });
  });

  it('aliases legacy users and case-sizes paths into settings', () => {
    expect(parseRoute('/users')).toEqual({ view: 'settings', section: 'users' });
    expect(parseRoute('/case-sizes')).toEqual({ view: 'settings', section: 'case-sizes' });
  });

  it('parses dev tools + nested audit/bugs', () => {
    expect(parseRoute('/dev')).toEqual({ view: 'dev' });
    expect(parseRoute('/dev/bugs')).toEqual({ view: 'bugs' });
    expect(parseRoute('/dev/audit')).toEqual({ view: 'audit' });
  });

  it('aliases legacy /bugs to bugs view', () => {
    expect(parseRoute('/bugs')).toEqual({ view: 'bugs' });
  });

  it('parses event panel routes', () => {
    expect(parseRoute('/events/abc-123/distribution')).toEqual({
      view: 'event', eventId: 'abc-123', panel: 'distribution',
    });
  });

  it('defaults bare event to dashboard', () => {
    expect(parseRoute('/events/abc-123')).toEqual({
      view: 'event', eventId: 'abc-123', panel: 'dashboard',
    });
  });

  it('aliases opening → products', () => {
    expect(parseRoute('/events/abc-123/opening')).toEqual({
      view: 'event', eventId: 'abc-123', panel: 'products',
    });
  });

  it('aliases projections → dashboard', () => {
    expect(parseRoute('/events/abc-123/projections')).toEqual({
      view: 'event', eventId: 'abc-123', panel: 'dashboard',
    });
  });

  it('aliases stock-levels → dashboard', () => {
    expect(parseRoute('/events/abc-123/stock-levels')).toEqual({
      view: 'event', eventId: 'abc-123', panel: 'dashboard',
    });
  });

  it('aliases summary → reports', () => {
    expect(parseRoute('/events/abc-123/summary')).toEqual({
      view: 'event', eventId: 'abc-123', panel: 'reports',
    });
  });

  it('aliases event audit → global audit with eventId', () => {
    expect(parseRoute('/events/abc-123/audit')).toEqual({
      view: 'audit', eventId: 'abc-123',
    });
  });

  it('parses known event panels', () => {
    const panels = [
      'setup', 'products', 'distribution', 'deliveries', 'counts',
      'transfers', 'wastage', 'closing', 'recon', 'sales', 'kit', 'reports',
    ];
    for (const panel of panels) {
      expect(parseRoute(`/events/abc-123/${panel}`)).toEqual({
        view: 'event', eventId: 'abc-123', panel,
      });
    }
  });

  it('returns not-found for unknown paths', () => {
    expect(parseRoute('/nope')).toEqual({ view: 'not-found' });
  });

  it('builds hrefs', () => {
    expect(hrefForRoute({ view: 'event', eventId: 'x', panel: 'sales' })).toBe('/events/x/sales');
    expect(hrefForRoute({ view: 'home' })).toBe('/');
    expect(hrefForRoute({ view: 'dev' })).toBe('/dev');
    expect(hrefForRoute({ view: 'bugs' })).toBe('/dev/bugs');
    expect(hrefForRoute({ view: 'audit' })).toBe('/dev/audit');
    expect(hrefForRoute({ view: 'settings' })).toBe('/settings/users');
    expect(hrefForRoute({ view: 'settings', section: 'case-sizes' })).toBe('/settings/case-sizes');
  });
});
