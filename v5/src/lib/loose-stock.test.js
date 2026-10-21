import { describe, it, expect } from 'vitest';
import { computeLooseStock } from './loose-stock.js';

const spirits = { id: 'c-sp', name: 'Spirits' };
const beer = { id: 'c-beer', name: 'Beer' };
function row(pid, name, category, singles, ups, rowPrice) {
  return { pid, p: { name, category }, closingSingles: singles, ups, rowPrice };
}

const reconRows = [
  row('vodka', 'Vodka', spirits, 8, 6, 60),
  row('gin', 'Gin', spirits, 4, 6, 90),
  row('lager', 'Lager', beer, 30, 24, 48),
  row('cider', 'Cider', beer, 0, 24, 40),
  row('mystery', 'Mystery', beer, 5, 12, 0),
];

describe('computeLooseStock', () => {
  it('charges everything when no allowance is agreed', () => {
    const { groups, totals } = computeLooseStock({ reconRows: [reconRows[0]] });
    expect(groups[0]).toMatchObject({ scope: 'none', looseUnits: 8, excessUnits: 8, excessValue: 80 });
    expect(totals.chargeable).toBe(80);
  });

  it('applies product allowances before category pools', () => {
    const { groups } = computeLooseStock({
      reconRows,
      allowances: [
        { id: 'a1', product_id: 'vodka', allowance_pct: 25 },
        { id: 'a2', category_id: 'c-sp', allowance_pct: 50 },
      ],
    });
    const vodka = groups.find((g) => g.key === 'p:vodka');
    // 25% of 8 singles allowed → 6 chargeable at £10.
    expect(vodka).toMatchObject({ allowance: 25, excessUnits: 6, excessValue: 60 });
    // Gin alone is in the spirits pool: 4 loose, 50% allowed → 2 chargeable at £15.
    const pool = groups.find((g) => g.key === 'c:c-sp');
    expect(pool).toMatchObject({ looseUnits: 4, allowance: 50, excessUnits: 2, excessValue: 30 });
    expect(pool.lines.map((l) => l.productId)).toEqual(['gin']);
  });

  it('pools a category allowance across products and values excess at the pool average', () => {
    const { groups } = computeLooseStock({
      reconRows,
      allowances: [{ id: 'a2', category_id: 'c-sp', allowance_pct: 50 }],
    });
    const pool = groups.find((g) => g.key === 'c:c-sp');
    // 12 loose (8 vodka @ £10 + 4 gin @ £15 = £140, avg £11.667), 50% allowed → 6 × 11.667.
    expect(pool).toMatchObject({ looseUnits: 12, allowance: 50, excessUnits: 6, looseValue: 140, excessValue: 70 });
  });

  it('charges nothing when the allowance is 100%', () => {
    const { groups, totals } = computeLooseStock({
      reconRows: [reconRows[0]],
      allowances: [{ id: 'a', product_id: 'vodka', allowance_pct: 100 }],
    });
    expect(groups[0]).toMatchObject({ allowance: 100, excessUnits: 0, excessValue: 0 });
    expect(totals.chargeable).toBe(0);
  });

  it('skips products with no loose stock and flags unpriced excess', () => {
    const { groups, totals } = computeLooseStock({ reconRows });
    expect(groups.some((g) => g.key === 'n:cider')).toBe(false);
    const mystery = groups.find((g) => g.key === 'n:mystery');
    expect(mystery.excessValue).toBeNull();
    expect(totals.unpriced).toBe(1);
  });

  it('keeps product allowance rows visible even with nothing loose', () => {
    const { groups } = computeLooseStock({ reconRows, allowances: [{ id: 'x', product_id: 'cider', allowance_pct: 10 }] });
    expect(groups.find((g) => g.key === 'p:cider')).toMatchObject({ looseUnits: 0, allowance: 10, excessUnits: 0 });
  });
});
