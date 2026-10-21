import { describe, it, expect } from 'vitest';
import { buildMenuExport, cellValue, menuExportCsv, rateCardMargin, rateCardNote, sanitizeRow, serveSizeOf, INTERNAL_FIELDS } from './menu-exports.js';

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
    for (const type of ['designer', 'sor', 'ratecard']) {
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

describe('designer distribution', () => {
  const bars = [
    { id: 'b2', name: 'Bar 2' },
    { id: 'b1', name: 'Bar 1' },
    { id: 'bone', name: 'Bone yard' },
  ];
  const stocked = [
    { ...lines[0], productId: 'p1' },
    { ...lines[1], productId: 'p2' },
    { ...lines[2], productId: 'p3' },
    { productId: null, kind: 'cocktail', name: 'Paloma', menuName: 'Paloma', category: 'Cocktails', included: true, menuPrice: 10 },
  ];
  const barProducts = [
    { bar_id: 'b1', product_id: 'p1' },
    { bar_id: 'b1', product_id: 'p2' },
    { bar_id: 'b2', product_id: 'p2' },
  ];

  it('shows which bars serve each drink, and leaves a drink off a bar that does not stock it', () => {
    const m = buildMenuExport('designer', { lines: stocked, bars, barProducts });
    expect(m.columns.map((c) => c.label)).toEqual(['Menu name', 'Product', 'Serve size', 'ABV', 'Bars', 'Price']);
    expect(m.barName).toBe('');
    const byName = Object.fromEntries(m.groups.flatMap((g) => g.rows.map((r) => [r.menuName, r])));
    expect(byName['Camden Hells'].bars).toBe('Bar 1');
    expect(byName['Aspall Cider'].bars).toBe('All bars');
    expect(byName['Red Wine'].bars).toBe('Not on a bar');
    expect(byName.Paloma.bars).toBe('All bars');
    expect(m.groups.flatMap((g) => g.rows).some((r) => String(r.bars).includes('Bone'))).toBe(false);
  });

  it('scopes the menu to one bar', () => {
    const m = buildMenuExport('designer', { lines: stocked, bars, barProducts, barId: 'b2' });
    expect(m.barName).toBe('Bar 2');
    expect(m.columns.some((c) => c.key === 'bars')).toBe(false);
    const names = m.groups.flatMap((g) => g.rows.map((r) => r.menuName));
    expect(names).toEqual(['Paloma', 'Aspall Cider']);
    expect(m.missingRates).toBe(0);
  });

  it('treats a bar with no distribution rows as serving every drink', () => {
    const open = [
      { id: 'b1', name: 'Bar 1' },
      { id: 'b2', name: 'Bar 2' },
    ];
    const m = buildMenuExport('designer', {
      lines: stocked,
      bars: open,
      barProducts: [{ bar_id: 'b1', product_id: 'p1' }],
    });
    const byName = Object.fromEntries(m.groups.flatMap((g) => g.rows.map((r) => [r.menuName, r])));
    expect(byName['Camden Hells'].bars).toBe('All bars');
    expect(byName['Aspall Cider'].bars).toBe('Bar 2');
  });

  it('drops a drink the only bar does not serve', () => {
    const m = buildMenuExport('designer', {
      lines: stocked,
      bars: [{ id: 'b1', name: 'Bar 1' }],
      barProducts: [{ bar_id: 'b1', product_id: 'p1' }],
    });
    expect(m.barName).toBe('Bar 1');
    const names = m.groups.flatMap((g) => g.rows.map((r) => r.menuName));
    expect(names).toContain('Camden Hells');
    expect(names).not.toContain('Aspall Cider');
    expect(names).toContain('Paloma');
  });

  it('shortens the bars column once a site has many bars', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `b${i + 1}`, name: `Bar ${i + 1}` }));
    const barProducts = many.flatMap((bar, i) => {
      const rows = [{ bar_id: bar.id, product_id: 'p-all' }];
      if (i < 8) rows.push({ bar_id: bar.id, product_id: 'p-some' });
      if (i >= 18) rows.push({ bar_id: bar.id, product_id: 'p-few' });
      if (i !== 0) rows.push({ bar_id: bar.id, product_id: 'p-most' });
      return rows;
    });
    const drink = (productId, menuName) => ({
      productId, name: menuName, menuName, category: 'Beer', included: true, menuPrice: 5,
    });
    const m = buildMenuExport('designer', {
      lines: [
        drink('p-all', 'Everywhere'),
        drink('p-some', 'Eight bars'),
        drink('p-few', 'Two bars'),
        drink('p-most', 'Missing one'),
        drink('p-none', 'Nowhere'),
      ],
      bars: many,
      barProducts,
    });
    const byName = Object.fromEntries(m.groups.flatMap((g) => g.rows.map((r) => [r.menuName, r])));
    expect(byName.Everywhere.bars).toBe('All bars');
    expect(byName['Eight bars'].bars).toBe('8 of 20');
    expect(byName['Eight bars'].barsDetail).toBe('Bar 1, Bar 2, Bar 3, Bar 4, Bar 5, Bar 6, Bar 7, Bar 8');
    expect(byName['Two bars'].bars).toBe('Bar 19, Bar 20');
    expect(byName['Missing one'].bars).toBe('All except Bar 1');
    expect(byName.Nowhere.bars).toBe('Not on a bar');
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

describe('3rd party rate card', () => {
  it('adds the margin to serve cost and skips lines with no cost', () => {
    const priced = [
      ...lines,
      { productId: 'p5', name: 'No cost', menuName: 'No cost', category: 'Wine', included: true, serveLabel: '175ml', menuPrice: 8, costPerServe: null },
    ];
    const m = buildMenuExport('ratecard', { lines: priced, marginPct: 10 });
    expect(m.count).toBe(3);
    expect(m.missingRates).toBe(1);
    expect(m.marginPct).toBe(10);
    expect(m.columns.map((c) => c.label)).toEqual(['Item', 'Unit', 'Rate']);
    const rates = Object.fromEntries(m.groups.flatMap((g) => g.rows.map((r) => [r.menuName, r.rate])));
    expect(rates).toEqual({ 'Camden Hells': 1.32, 'Aspall Cider': 1.54, 'Red Wine': 2.2 });
    expect(allRowKeys(m).has('costPerServe')).toBe(false);
  });
  it('uses the serve cost when the margin is zero, and accepts a custom percent', () => {
    const m = buildMenuExport('ratecard', { lines, marginPct: '12.5' });
    expect(m.groups[0].rows.find((r) => r.menuName === 'Camden Hells').rate).toBe(1.35);
    expect(buildMenuExport('ratecard', { lines }).groups[0].rows.find((r) => r.menuName === 'Camden Hells').rate).toBe(1.2);
    expect(rateCardMargin('nope')).toBe(0);
    expect(rateCardMargin(250)).toBe(200);
    expect(rateCardNote(10)).toBe('Rates are the serve cost plus 10%, ex VAT.');
    expect(rateCardNote(0)).toBe('Rates are the serve cost, ex VAT.');
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
