import { describe, it, expect } from 'vitest';
import { computeLooseStock, validateLoosePayment } from './loose-stock.js';

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
        { id: 'a1', product_id: 'vodka', allowance_units: 5 },
        { id: 'a2', category_id: 'c-sp', allowance_units: 10 },
      ],
    });
    const vodka = groups.find((g) => g.key === 'p:vodka');
    expect(vodka).toMatchObject({ allowance: 5, excessUnits: 3, excessValue: 30 });
    // Gin alone is in the spirits pool: 4 loose, 10 allowed → nothing chargeable.
    const pool = groups.find((g) => g.key === 'c:c-sp');
    expect(pool).toMatchObject({ looseUnits: 4, excessUnits: 0, excessValue: 0 });
    expect(pool.lines.map((l) => l.productId)).toEqual(['gin']);
  });

  it('pools a category allowance across products and values excess at the pool average', () => {
    const { groups } = computeLooseStock({
      reconRows,
      allowances: [{ id: 'a2', category_id: 'c-sp', allowance_units: 6 }],
    });
    const pool = groups.find((g) => g.key === 'c:c-sp');
    // 12 loose (8 vodka @ £10 + 4 gin @ £15 = £140, avg £11.667), 6 allowed → 6 × 11.667.
    expect(pool).toMatchObject({ looseUnits: 12, excessUnits: 6, looseValue: 140, excessValue: 70 });
  });

  it('skips products with no loose stock and flags unpriced excess', () => {
    const { groups, totals } = computeLooseStock({ reconRows });
    expect(groups.some((g) => g.key === 'n:cider')).toBe(false);
    const mystery = groups.find((g) => g.key === 'n:mystery');
    expect(mystery.excessValue).toBeNull();
    expect(totals.unpriced).toBe(1);
  });

  it('reconciles chargeable against payments and refunds', () => {
    const { totals } = computeLooseStock({
      reconRows: [reconRows[0], reconRows[2]],
      payments: [{ amount: 50 }, { amount: 30 }, { amount: -10 }],
    });
    // Vodka 8 × £10 = 80, lager 30 × £2 = 60 → 140 chargeable, 70 paid.
    expect(totals).toMatchObject({ chargeable: 140, paid: 70, outstanding: 70, overAllowance: 2 });
  });

  it('shows overpayment as negative outstanding', () => {
    const { totals } = computeLooseStock({ reconRows: [reconRows[0]], payments: [{ amount: 100 }] });
    expect(totals.outstanding).toBe(-20);
  });

  it('keeps product allowance rows visible even with nothing loose', () => {
    const { groups } = computeLooseStock({ reconRows, allowances: [{ id: 'x', product_id: 'cider', allowance_units: 2 }] });
    expect(groups.find((g) => g.key === 'p:cider')).toMatchObject({ looseUnits: 0, excessUnits: 0 });
  });
});

describe('validateLoosePayment', () => {
  it('accepts payments and refunds', () => {
    expect(validateLoosePayment({ amount: '£1,250.50', paid_on: '2026-07-10', reference: ' BACS ' }).value)
      .toEqual({ amount: 1250.5, paid_on: '2026-07-10', reference: 'BACS', notes: null });
    expect(validateLoosePayment({ amount: '-20', paid_on: '2026-07-10' }).ok).toBe(true);
  });
  it('rejects zero, junk and missing dates', () => {
    expect(validateLoosePayment({ amount: '0', paid_on: '2026-07-10' }).errors.amount).toBeTruthy();
    expect(validateLoosePayment({ amount: 'abc', paid_on: '2026-07-10' }).ok).toBe(false);
    expect(validateLoosePayment({ amount: '5' }).errors.paid_on).toBeTruthy();
  });
});
