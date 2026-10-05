import { describe, it, expect } from 'vitest';
import { buildMenuExport, cellValue, menuExportCsv, sanitizeRow, serveSizeOf, INTERNAL_FIELDS } from './menu-exports.js';

const lines = [
  { productId: 'p1', name: 'Camden Hells 50L', menuName: 'Camden Hells', category: 'Draught', included: true, serveLabel: 'Pint', menuPrice: 6.5, projectedServes: 300, costPerServe: 1.2, gpPct: 77.8 },
  { productId: 'p2', name: 'Aspall 30L', menuName: 'Aspall Cider', category: 'Draught', included: true, serveLabel: 'Pint', menuPrice: 6.8, projectedServes: 100, costPerServe: 1.4, gpPct: 75.3 },
  { productId: 'p3', name: 'House Red 75cl', menuName: 'Red Wine', category: 'Wine', included: true, serveLabel: '175ml', menuPrice: null, projectedServes: null, costPerServe: 2, gpPct: null },
  { productId: 'p4', name: 'Off menu', menuName: 'Off menu', category: 'Wine', included: false, menuPrice: 5 },
];
const scenarios = [
  { id: 's1', name: '+5%', scenario_prices: [{ product_id: 'p1', price: 6.85 }] },
  { id: 's2', name: 'Hidden', scenario_prices: [] },
];

function allRowKeys(model) {
  return new Set(model.groups.flatMap((g) => g.rows.flatMap((r) => Object.keys(r))));
}

describe('field whitelisting', () => {
  it('never exposes cost or GP in designer or SOR exports, even when asked', () => {
    for (const type of ['designer', 'sor']) {
      const model = buildMenuExport(type, { lines, includeInternal: true });
      const keys = allRowKeys(model);
      INTERNAL_FIELDS.forEach((f) => expect(keys.has(f)).toBe(false));
      expect(model.columns.some((c) => c.internal)).toBe(false);
    }
  });
  it('client pack hides internals unless an admin opts in', () => {
    const plain = buildMenuExport('client', { lines, scenarios, scenarioIds: ['s1'] });
    INTERNAL_FIELDS.forEach((f) => expect(allRowKeys(plain).has(f)).toBe(false));
    const internal = buildMenuExport('client', { lines, scenarios, scenarioIds: ['s1'], includeInternal: true });
    expect(allRowKeys(internal).has('gpPct')).toBe(true);
    expect(internal.columns.filter((c) => c.internal).map((c) => c.key)).toEqual(['costPerServe', 'gpPct']);
  });
  it('sanitizeRow drops unknown keys', () => {
    expect(sanitizeRow('designer', { menuName: 'x', unitCost: 3, secret: 1 })).toEqual({ menuName: 'x' });
  });
});

describe('serve size', () => {
  it('uses the pack unit, and a pint for draught', () => {
    expect(serveSizeOf({ caseSize: '12×440ml Cans' })).toBe('440ml');
    expect(serveSizeOf({ caseSize: '24×330ml' })).toBe('330ml');
    expect(serveSizeOf({ caseSize: '70cl' })).toBe('70cl');
    expect(serveSizeOf({ caseSize: '50L Keg' })).toBe('Pint');
    expect(serveSizeOf({ caseSize: '9 Gal', stockUnit: 'keg' })).toBe('Pint');
    expect(serveSizeOf({ serveLabel: '175ml', caseSize: '750ml' })).toBe('175ml');
    expect(serveSizeOf({ kind: 'cocktail' })).toBe('Cocktail');
    expect(serveSizeOf({ kind: 'cocktail', drinkKind: 'spirit_mixer' })).toBe('Spirit & mixer');
    expect(serveSizeOf({ kind: 'cocktail', serveLabel: 'Coupe' })).toBe('Coupe');
  });
});

describe('designer export', () => {
  it('lists on-menu items by category with menu names, serve sizes, ABV and prices', () => {
    const withPack = [
      { ...lines[0], abv: 4.6, caseSize: '50L Keg', stockUnit: 'keg' },
      { ...lines[1], serveLabel: '', abv: 5.5, caseSize: '12×440ml Cans' },
      lines[2],
      lines[3],
    ];
    const m = buildMenuExport('designer', { lines: withPack });
    expect(m.columns.map((c) => c.label)).toEqual(['Menu name', 'Product', 'Serve size', 'ABV', 'Price']);
    expect(m.groups.map((g) => g.category)).toEqual(['Draught', 'Wine']);
    expect(m.groups[0].rows.map((r) => r.menuName)).toEqual(['Aspall Cider', 'Camden Hells']);
    const byName = Object.fromEntries(m.groups[0].rows.map((r) => [r.menuName, r]));
    expect(byName['Camden Hells']).toMatchObject({ serve: 'Pint', abv: '4.6%' });
    expect(byName['Aspall Cider']).toMatchObject({ serve: '440ml', abv: '5.5%' });
    expect(m.groups[1].rows[0]).toMatchObject({ serve: '175ml', abv: '—' });
    expect(m.count).toBe(3);
    expect(m.missingRates).toBe(1);
  });
});

describe('client pack', () => {
  it('shows mix share and only the chosen scenarios', () => {
    const m = buildMenuExport('client', { lines, scenarios, scenarioIds: ['s1'] });
    const hells = m.groups[0].rows.find((r) => r.menuName === 'Camden Hells');
    expect(hells.mixPct).toBe(75);
    expect(m.columns.map((c) => c.label)).toEqual(['Product', 'Serve', 'Menu price', 'Mix %', '+5%']);
    expect(cellValue(hells, m.columns[4])).toBe(6.85);
  });
});

describe('schedule of rates', () => {
  it('uses menu prices and skips unpriced items', () => {
    const m = buildMenuExport('sor', { lines });
    expect(m.count).toBe(2);
    expect(m.missingRates).toBe(1);
    expect(m.columns.map((c) => c.label)).toEqual(['Item', 'Unit', 'Rate']);
  });
  it('rider rates override menu prices, falling back where none agreed', () => {
    const riderPrices = new Map([['p1', { price: 5.5 }]]);
    const m = buildMenuExport('sor', { lines, rateSource: 'rider', riderPrices });
    const rates = Object.fromEntries(m.groups[0].rows.map((r) => [r.menuName, r.rate]));
    expect(rates).toEqual({ 'Camden Hells': 5.5, 'Aspall Cider': 6.8 });
  });
  it('can use a scenario as the rate card', () => {
    const m = buildMenuExport('sor', { lines, scenarios, rateSource: 's1' });
    expect(m.groups[0].rows.find((r) => r.menuName === 'Camden Hells').rate).toBe(6.85);
  });
});

describe('csv', () => {
  it('escapes and keeps raw numbers', () => {
    const m = buildMenuExport('designer', { lines: [{ ...lines[0], menuName: 'Hells, "crisp"' }] });
    const csv = menuExportCsv(m);
    expect(csv).toContain('"Hells, ""crisp"""');
    expect(csv).toContain('6.50');
    expect(csv.startsWith('\uFEFFCategory,Menu name')).toBe(true);
  });
});
