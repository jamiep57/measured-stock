import { describe, expect, it } from 'vitest';
import { mergeServeSize, portionForSize, serveSizeChoices } from './serve-sizes.js';

describe('serve sizes', () => {
  const sizes = [
    { label: 'Pint', sort_order: 110 },
    { label: '200ml', sort_order: 50 },
    { label: '330ml', sort_order: 70 },
    { label: 'Half', sort_order: 100 },
  ];

  it('lists the shared sizes in catalogue order', () => {
    expect(serveSizeChoices(sizes).map((row) => row.label)).toEqual(['200ml', '330ml', 'Half', 'Pint']);
  });

  it('keeps a size that is not in the catalogue yet', () => {
    const choices = serveSizeChoices(sizes, 'Schooner');
    expect(choices[0]).toEqual({ label: 'Schooner', current: true });
    expect(choices.map((row) => row.label)).toContain('330ml');
  });

  it('marks the current size without adding a duplicate', () => {
    const choices = serveSizeChoices(sizes, 'pint');
    expect(choices.filter((row) => row.label.toLowerCase() === 'pint')).toHaveLength(1);
    expect(choices.find((row) => row.label === 'Pint').current).toBe(true);
  });

  it('treats a half as half a serve and a double as two', () => {
    expect(portionForSize('Half')).toBe(0.5);
    expect(portionForSize('double')).toBe(2);
    expect(portionForSize('330ml')).toBe(1);
    expect(portionForSize('Pint')).toBe(1);
  });

  it('adds a new size once', () => {
    const next = mergeServeSize(sizes, { id: 's1', label: '500ml', sort_order: 90 });
    expect(next).toHaveLength(sizes.length + 1);
    expect(mergeServeSize(next, { id: 's1', label: '500ml', sort_order: 90 })).toHaveLength(next.length);
  });
});
