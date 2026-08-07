import { describe, it, expect } from 'vitest';
import { parseRoute, hrefForRoute } from '../admin/router.js';

describe('admin router', () => {
  it('parses home', () => {
    expect(parseRoute('/v5/admin')).toEqual({ view: 'home' });
  });

  it('parses global routes', () => {
    expect(parseRoute('/v5/admin/library')).toEqual({ view: 'library' });
    expect(parseRoute('/v5/admin/kit-library')).toEqual({ view: 'kit-library' });
    expect(parseRoute('/v5/admin/suppliers')).toEqual({ view: 'suppliers' });
    expect(parseRoute('/v5/admin/warehouses')).toEqual({ view: 'warehouses' });
    expect(parseRoute('/v5/admin/volume-pools')).toEqual({ view: 'volume-pools' });
  });

  it('parses workspace settings sections', () => {
    expect(parseRoute('/v5/admin/settings')).toEqual({ view: 'settings', section: 'users' });
    expect(parseRoute('/v5/admin/settings/users')).toEqual({ view: 'settings', section: 'users' });
    expect(parseRoute('/v5/admin/settings/warehouses')).toEqual({ view: 'settings', section: 'warehouses' });
    expect(parseRoute('/v5/admin/settings/categories')).toEqual({ view: 'settings', section: 'categories' });
    expect(parseRoute('/v5/admin/settings/case-sizes')).toEqual({ view: 'settings', section: 'case-sizes' });
  });

  it('rejects unknown settings sections', () => {
    expect(parseRoute('/v5/admin/settings/nope')).toEqual({ view: 'not-found' });
  });

  it('redirects legacy users and case-sizes into workspace settings', () => {
    expect(parseRoute('/v5/admin/users')).toEqual({ view: 'settings', section: 'users' });
    expect(parseRoute('/v5/admin/case-sizes')).toEqual({ view: 'settings', section: 'case-sizes' });
  });

  it('parses dev tools home and nested pages', () => {
    expect(parseRoute('/v5/admin/dev')).toEqual({ view: 'dev' });
    expect(parseRoute('/v5/admin/dev/bugs')).toEqual({ view: 'bugs' });
    expect(parseRoute('/v5/admin/dev/audit')).toEqual({ view: 'audit' });
  });

  it('keeps legacy bugs URL', () => {
    expect(parseRoute('/v5/admin/bugs')).toEqual({ view: 'bugs' });
  });

  it('parses event panel routes', () => {
    expect(parseRoute('/v5/admin/events/abc-123/distribution')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'distribution',
    });
  });

  it('defaults event to dashboard', () => {
    expect(parseRoute('/v5/admin/events/abc-123')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'dashboard',
    });
  });

  it('redirects opening to products', () => {
    expect(parseRoute('/v5/admin/events/abc-123/opening')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'products',
    });
  });

  it('redirects projections to dashboard', () => {
    expect(parseRoute('/v5/admin/events/abc-123/projections')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'dashboard',
    });
  });

  it('redirects stock-levels to dashboard until the panel ships', () => {
    expect(parseRoute('/v5/admin/events/abc-123/stock-levels')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'dashboard',
    });
  });

  it('redirects summary to reports', () => {
    expect(parseRoute('/v5/admin/events/abc-123/summary')).toEqual({
      view: 'event',
      eventId: 'abc-123',
      panel: 'reports',
    });
  });

  it('maps legacy event audit URL onto the dev audit view', () => {
    expect(parseRoute('/v5/admin/events/abc-123/audit')).toEqual({
      view: 'audit',
      eventId: 'abc-123',
    });
  });

  it('keeps known event panels', () => {
    for (const panel of [
      'dashboard', 'setup', 'products', 'distribution', 'deliveries',
      'wastage', 'transfers', 'sales', 'counts', 'kit', 'closing', 'recon', 'reports',
    ]) {
      expect(parseRoute(`/v5/admin/events/abc-123/${panel}`)).toEqual({
        view: 'event',
        eventId: 'abc-123',
        panel,
      });
    }
  });

  it('returns not-found for unknown paths', () => {
    expect(parseRoute('/v5/admin/nope')).toEqual({ view: 'not-found' });
  });

  it('builds hrefs', () => {
    expect(hrefForRoute({ view: 'event', eventId: 'x', panel: 'sales' }))
      .toBe('/v5/admin/events/x/sales');
    expect(hrefForRoute({ view: 'home' })).toBe('/v5/admin');
    expect(hrefForRoute({ view: 'dev' })).toBe('/v5/admin/dev');
    expect(hrefForRoute({ view: 'bugs' })).toBe('/v5/admin/dev/bugs');
    expect(hrefForRoute({ view: 'audit' })).toBe('/v5/admin/dev/audit');
    expect(hrefForRoute({ view: 'settings' })).toBe('/v5/admin/settings/users');
    expect(hrefForRoute({ view: 'settings', section: 'case-sizes' }))
      .toBe('/v5/admin/settings/case-sizes');
  });
});
