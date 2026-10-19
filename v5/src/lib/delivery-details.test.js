import { describe, expect, it } from 'vitest';
import { deliveryTimeLabel, factSheetKind, formatWhat3Words } from './delivery-details.js';

describe('delivery details', () => {
  it('keeps a what3words address and adds the slashes when missing', () => {
    expect(formatWhat3Words('')).toBe('');
    expect(formatWhat3Words('///filled.count.soap')).toBe('///filled.count.soap');
    expect(formatWhat3Words('filled.count.soap')).toBe('///filled.count.soap');
    expect(formatWhat3Words('/filled.count.soap')).toBe('///filled.count.soap');
  });

  it('labels only AM and PM delivery times', () => {
    expect(deliveryTimeLabel('am')).toBe('AM');
    expect(deliveryTimeLabel('PM')).toBe('PM');
    expect(deliveryTimeLabel('')).toBe('');
    expect(deliveryTimeLabel('morning')).toBe('');
  });

  it('tells a fact sheet PDF from an image', () => {
    expect(factSheetKind('gate.pdf', '')).toBe('pdf');
    expect(factSheetKind('file', 'application/pdf')).toBe('pdf');
    expect(factSheetKind('map.png', '')).toBe('image');
    expect(factSheetKind('map', 'image/jpeg')).toBe('image');
    expect(factSheetKind('notes.txt', 'text/plain')).toBe('');
  });
});
