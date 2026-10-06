import { describe, expect, it } from 'vitest';
import { suggestSquareLocation } from './square-locations.js';

const locations = [
  { id: 'a', name: 'Bar 1' },
  { id: 'b', name: 'Main Bar' },
  { id: 'c', name: 'Bar 1' },
];

describe('suggestSquareLocation', () => {
  it('matches one location by name, ignoring punctuation', () => {
    expect(suggestSquareLocation('Main-Bar', locations)).toBe('b');
  });

  it('returns nothing when two locations share the name', () => {
    expect(suggestSquareLocation('Bar 1', locations)).toBeNull();
  });

  it('skips a location already linked to another bar', () => {
    expect(suggestSquareLocation('Bar 1', locations, new Set(['a']))).toBe('c');
  });
});
