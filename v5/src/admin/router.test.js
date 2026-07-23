import { describe, it, expect } from 'vitest';
import { parseRoute, hrefForRoute } from '../admin/router.js';

describe('admin router', () => {
  it('parses home', () => {
    expect(parseRoute('/v5/admin')).toEqual({ view: 'home' });
  });

  it('parses global routes', () => {
    expect(parseRoute('/v5/admin/library')).toEqual({ view: 'library' });
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

  it('builds hrefs', () => {
    expect(hrefForRoute({ view: 'event', eventId: 'x', panel: 'sales' }))
      .toBe('/v5/admin/events/x/sales');
  });
});
