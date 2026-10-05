import { describe, it, expect } from 'vitest';
import { buildMenuExport } from './menu-exports.js';
import { composeMenuEntry } from './menu-export-pdf.js';

const lines = [
  { productId: 'p1', name: 'Camden Hells 50L', menuName: 'Camden Hells', category: 'Draught', included: true, serveLabel: 'Pint', abv: 4.6, caseSize: '50L Keg', menuPrice: 6.5 },
  { productId: 'p2', name: 'Aspall 440', menuName: 'Aspall', category: 'Draught', included: true, serveLabel: '', abv: 5.5, caseSize: '12×440ml Cans', menuPrice: 6.8 },
  { productId: 'p3', name: 'House Red', menuName: 'House Red', category: 'Wine', included: true, serveLabel: '175ml', menuPrice: 7 },
];

describe('composeMenuEntry', () => {
  it('sets a designer line as a name, a price, and serve with ABV', () => {
    const model = buildMenuExport('designer', { lines });
    const rows = Object.fromEntries(model.groups.flatMap((g) => g.rows.map((r) => [r.menuName, r])));
    expect(composeMenuEntry('designer', rows['Camden Hells'], model.columns)).toEqual({
      name: 'Camden Hells',
      price: '£6.50',
      unit: '',
      lines: ['Camden Hells 50L   ·   Pint   ·   4.6% ABV'],
    });
    expect(composeMenuEntry('designer', rows.Aspall, model.columns).lines).toEqual(['Aspall 440   ·   440ml   ·   5.5% ABV']);
    expect(composeMenuEntry('designer', rows['House Red'], model.columns).lines).toEqual(['175ml']);
  });

  it('keeps a schedule of rates to name, unit and rate', () => {
    const model = buildMenuExport('sor', { lines });
    const hells = model.groups[0].rows.find((r) => r.menuName === 'Camden Hells');
    expect(composeMenuEntry('sor', hells, model.columns)).toEqual({
      name: 'Camden Hells',
      price: '£6.50',
      unit: 'Pint',
      lines: [],
    });
  });
});
