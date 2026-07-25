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
    expect(parseRoute('/v5/admin/bugs')).toEqual({ view: 'bugs' });
    expect(parseRoute('/v5/admin/settings')).toEqual({ view: 'settings' });
  });

  it('redirects legacy case-sizes to workspace settings', () => {
    expect(parseRoute('/v5/admin/case-sizes')).toEqual({ view: 'settings' });
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

  it('builds hrefs', () => {
    expect(hrefForRoute({ view: 'event', eventId: 'x', panel: 'sales' }))
      .toBe('/v5/admin/events/x/sales');
  });
});
