import { describe, it, expect } from 'vitest';
import { buildKitImageQuery } from './kit-image-search.js';

describe('kit-image-search', () => {
  it('builds query from name and category', () => {
    expect(buildKitImageQuery('Pump Truck', 'Tools')).toBe('Pump Truck Tools');
    expect(buildKitImageQuery('Tools trolley', 'Tools')).toBe('Tools trolley');
    expect(buildKitImageQuery('Bitter Ale stands/wedges', 'Ale Dispense'))
      .toBe('Bitter Ale stands wedges');
    expect(buildKitImageQuery('', 'Tools')).toBe('Tools');
    expect(buildKitImageQuery('  ', '')).toBe('');
  });
});
