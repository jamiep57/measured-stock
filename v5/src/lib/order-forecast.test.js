import { describe, it, expect } from 'vitest';
import {
  buildForecastLines,
  forecastTotals,
  groupForecastLines,
  keepMixServes,
  mixFromSales,
  mixPct,
  plannedOrderCost,
  roughCases,
  scaleCategoryServes,
  sellingPrice,
  servesForMix,
  servesFromMix,
} from './order-forecast.js';

const priced = {
  key: 'a',
  kind: 'menu',
  itemId: 'a',
  productId: 'p1',
  menuPrice: 6,
  costPerServe: 1,
  targetGpPct: 72,
  vatRate: 0.2,
  projectedServes: 100,
  servesPerUnit: 88,
  portion: 1,
  category: 'Draught',
  name: 'Hells',
  productName: 'Hells',
  menuName: 'Hells',
  sku: 'H1',
  included: true,
};

describe('sellingPrice', () => {
  it('uses the menu price', () => {
    expect(sellingPrice(priced)).toEqual({ price: 6, source: 'menu' });
  });
  it('uses the price needed to hit target GP when the menu price is blank', () => {
    expect(sellingPrice({ ...priced, menuPrice: null })).toEqual({ price: 4.3, source: 'gp' });
  });
  it('cannot forecast without a price or a cost', () => {
    expect(sellingPrice({ menuPrice: null, costPerServe: null }).source).toBeNull();
  });
});

describe('mix and servings', () => {
  it('turns a share of the target into whole servings', () => {
    expect(mixPct(100, 6, 1000)).toBe(60);
    expect(servesFromMix(1000, 60, 6)).toBe(100);
    expect(servesFromMix(1000, 10, 6)).toBe(17);
  });
  it('needs a target and a price', () => {
    expect(servesFromMix(null, 10, 6)).toBeNull();
    expect(mixPct(10, null, 1000)).toBeNull();
  });
  it('shows a size\'s share of a case before products are rounded up together', () => {
    expect(roughCases({ ...priced, projectedServes: 88 })).toBe(1);
    expect(roughCases({ ...priced, kind: 'cocktail', projectedServes: 88 })).toBeNull();
  });
});

describe('category scaling', () => {
  const half = {
    ...priced,
    key: 'b',
    itemId: 'b',
    serveLabel: 'Half',
    portion: 0.5,
    menuPrice: 3.5,
    projectedServes: 40,
  };
  it('keeps the relative mix when the category percentage changes', () => {
    const next = scaleCategoryServes([priced, half], 50, 1000);
    const pint = next.find((row) => row.key === 'a');
    const small = next.find((row) => row.key === 'b');
    expect(pint.serves * 6).toBeCloseTo(small.serves * 3.5 * (600 / 140), -1);
    expect((pint.serves * 6 + small.serves * 3.5) / 1000 * 100).toBeCloseTo(50, 0);
  });
  it('splits a new category evenly when nothing is projected yet', () => {
    const next = scaleCategoryServes([
      { ...priced, projectedServes: null },
      { ...half, projectedServes: null },
    ], 40, 1000);
    expect(next.find((row) => row.key === 'a').serves).toBe(33);
    expect(next.find((row) => row.key === 'b').serves).toBe(57);
  });
  it('leaves a line with no price out of the scale', () => {
    const next = scaleCategoryServes([
      priced,
      { ...half, menuPrice: null, costPerServe: null },
    ], 20, 1000);
    expect(next.map((row) => row.key)).toEqual(['a']);
  });
});

describe('keepMixServes', () => {
  it('multiplies serves so the same split hits the new target', () => {
    expect(keepMixServes([priced, { ...priced, key: 'b', projectedServes: null }], 1000, 1500))
      .toEqual([{ key: 'a', kind: 'menu', itemId: 'a', productId: 'p1', serves: 150 }]);
  });
});

describe('sales mix', () => {
  const pint = { ...priced, key: 'pint', serveLabel: 'Pint' };
  const half = { ...priced, key: 'half', serveLabel: 'Half', portion: 0.5, menuPrice: 3.5 };
  const cocktail = {
    key: 'cocktail:c1',
    kind: 'cocktail',
    itemId: 'c1',
    name: 'Margarita',
    category: 'Cocktails',
    included: true,
    squareItemName: 'Margarita',
    squareVariation: '',
    menuPrice: 10,
  };
  const lines = [pint, half, cocktail];

  it('matches a cocktail, a serve size, and leaves the rest unmatched', () => {
    const mix = mixFromSales([
      { name: 'Margarita', variation: 'Regular', gross_sales: 100, net_sales: 80 },
      { name: 'Hells', variation: 'Half', gross_sales: 50 },
      { name: 'Mystery', variation: 'Regular', gross_sales: 50 },
    ], lines);
    expect(mix.total).toBe(200);
    expect(mix.matchedPct).toBe(75);
    expect(mix.unmatchedPct).toBe(25);
    expect(mix.lines.find((row) => row.key === 'cocktail:c1').pct).toBe(50);
    expect(mix.lines.find((row) => row.key === 'half').pct).toBe(25);
    expect(mix.unmatched[0].name).toBe('Mystery');
    expect(mix.categories.find((row) => row.category === 'Cocktails').pct).toBe(50);
  });

  it('uses net sales when the file has no gross column', () => {
    const mix = mixFromSales([{ name: 'Hells', variation: 'Pint', gross_sales: 0, net_sales: 40 }], lines);
    expect(mix.lines[0].key).toBe('pint');
    expect(mix.lines[0].amount).toBe(40);
  });

  it('prefers a one-product recipe over a loose name', () => {
    const mix = mixFromSales(
      [{ name: 'House Lager', variation: 'Pint', gross_sales: 80 }],
      lines,
      {
        recipes: [{
          till_item: 'House Lager',
          till_variation: 'Pint',
          ingredients: [{ product_name: 'Hells', qty: 1, position: 0 }],
        }],
        products: [{ id: 'p1', name: 'Hells' }],
      },
    );
    expect(mix.lines[0].key).toBe('pint');
  });

  it('does not guess when two products share a name', () => {
    const other = { ...pint, key: 'other', productId: 'p2', sku: 'X' };
    const mix = mixFromSales([{ name: 'Hells', variation: 'Pint', gross_sales: 10 }], [pint, other]);
    expect(mix.lines).toEqual([]);
    expect(mix.unmatchedPct).toBe(100);
    expect(mix.unmatched[0].reason).toBe('ambiguous');
  });

  it('matches a SKU and lands a pinned cocktail variation', () => {
    const pinned = { ...cocktail, key: 'cocktail:c2', squareVariation: 'Double' };
    const mix = mixFromSales([
      { name: 'Something', variation: 'Regular', sku: 'H1', gross_sales: 20 },
      { name: 'Margarita', variation: 'Regular', gross_sales: 10 },
    ], [pint, pinned]);
    expect(mix.lines.map((row) => row.key)).toEqual(['pint']);
    expect(mix.unmatched[0].name).toBe('Margarita');
  });

  it('writes servings only for matched lines that have a price', () => {
    const unpriced = { ...cocktail, menuPrice: null, costPerServe: null };
    const mix = mixFromSales([
      { name: 'Hells', variation: 'Pint', gross_sales: 60 },
      { name: 'Margarita', variation: 'Regular', gross_sales: 40 },
    ], [pint, unpriced]);
    const result = servesForMix([pint, unpriced], mix.lines, 1000);
    expect(result.applied).toEqual([
      { key: 'pint', kind: 'menu', itemId: 'a', productId: 'p1', serves: 100 },
    ]);
    expect(result.skipped.map((row) => row.reason)).toEqual(['price']);
  });
});

describe('buildForecastLines', () => {
  const keg = {
    id: 'p1',
    name: 'Utopian',
    menu_name: 'Hells',
    sku: 'UT1',
    case_size: '50L Keg',
    units_per_case: 1,
    pool_servings_per_unit: 88,
    category: { name: 'Draught' },
    product_suppliers: [{ supplier_id: 's1', case_price: 88, is_preferred: true }],
  };

  it('includes each size and each cocktail, and skips lines taken off the menu', () => {
    const items = new Map([['p1', [
      { id: 'm1', product_id: 'p1', included: true, menu_price: 6, projected_serves: 80, serve_label: 'Pint', portion: 1 },
      { id: 'm2', product_id: 'p1', included: false, menu_price: 3.5, serve_label: 'Half', portion: 0.5 },
    ]]]);
    const lines = buildForecastLines({
      items,
      cocktails: [
        { id: 'c1', name: 'Margarita', included: true, menu_price: 10, projected_serves: 20, square_item_name: 'Margarita', drink_kind: 'cocktail' },
        { id: 'c2', name: 'Off', included: false, menu_price: 10 },
      ],
      productById: new Map([['p1', keg]]),
      event: { target_gp_pct: 70 },
    });
    expect(lines.map((line) => line.key)).toEqual(['m1', 'cocktail:c1']);
    expect(lines[0].category).toBe('Draught');
    expect(lines[0].menuName).toBe('Hells');
    expect(lines[0].servesPerUnit).toBe(88);
    expect(lines[1].category).toBe('Cocktails');
    const grouped = groupForecastLines(lines, 1000);
    expect(grouped.map((group) => group.category)).toEqual(['Cocktails', 'Draught']);
    expect(forecastTotals(lines, 1000).revenue).toBe(680);
  });
});

describe('plannedOrderCost', () => {
  it('prices planned cases and counts products with no case cost', () => {
    expect(plannedOrderCost(
      [{ productId: 'a', planned: 2 }, { productId: 'b', planned: 4 }, { productId: 'c', planned: null }],
      (id) => (id === 'a' ? 10 : null),
    )).toEqual({ total: 20, unpriced: 1 });
  });
});
