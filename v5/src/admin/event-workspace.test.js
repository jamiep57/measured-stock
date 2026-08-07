import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveActiveEventId,
  readRememberedEventId,
  writeRememberedEventId,
} from './event-workspace.js';

function mockSessionStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

describe('resolveActiveEventId', () => {
  it('uses the event id from the URL on event routes', () => {
    expect(resolveActiveEventId(
      { view: 'event', eventId: 'evt-1', panel: 'dashboard' },
      { eventId: 'evt-old' },
    )).toBe('evt-1');
  });

  it('keeps the remembered event on catalog pages', () => {
    expect(resolveActiveEventId(
      { view: 'library' },
      { eventId: 'evt-1' },
    )).toBe('evt-1');
  });

  it('keeps the remembered event on home and tools pages', () => {
    expect(resolveActiveEventId({ view: 'home' }, { eventId: 'evt-1' })).toBe('evt-1');
    expect(resolveActiveEventId({ view: 'bugs' }, { eventId: 'evt-1' })).toBe('evt-1');
    expect(resolveActiveEventId({ view: 'dev' }, { eventId: 'evt-1' })).toBe('evt-1');
  });

  it('uses the event id from the URL on audit routes', () => {
    expect(resolveActiveEventId(
      { view: 'audit', eventId: 'evt-1' },
      { eventId: 'evt-old' },
    )).toBe('evt-1');
  });

  it('returns empty when the workspace was cleared', () => {
    expect(resolveActiveEventId({ view: 'library' }, { eventId: '' })).toBe('');
    expect(resolveActiveEventId({ view: 'home' }, { eventId: '' })).toBe('');
  });
});

describe('remembered event storage', () => {
  beforeEach(() => {
    mockSessionStorage();
  });

  afterEach(() => {
    delete globalThis.sessionStorage;
  });

  it('round-trips the active event id', () => {
    writeRememberedEventId('evt-42');
    expect(readRememberedEventId()).toBe('evt-42');
  });

  it('clears storage when leaving the workspace', () => {
    writeRememberedEventId('evt-42');
    writeRememberedEventId('');
    expect(readRememberedEventId()).toBe('');
  });
});
