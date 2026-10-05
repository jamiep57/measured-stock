import { describe, it, expect } from 'vitest';
import {
  resolveMenuLine, resolveUnitCost, menuTotals, scenarioGp, parsePlanningNumber,
  formatPlanningPriceInput,
} from './planning-menu.js';

describe('parsePlanningNumber', () => {
  it('accepts currency, percent and thousands formatting', () => {
    expect(parsePlanningNumber('£6.50')).toEqual({ ok: true, value: 6.5 });
    expect(parsePlanningNumber('72%')).toEqual({ ok: true, value: 72 });
    expect(parsePlanningNumber('1,200')).toEqual({ ok: true, value: 1200 });
    expect(parsePlanningNumber('.5')).toEqual({ ok: true, value: 0.5 });
  });
  it('treats empty as clear', () => {
    expect(parsePlanningNumber('  ')).toEqual({ ok: true, value: null });
  });
  it('shows a price as accounting pounds to two decimals', () => {
    expect(formatPlanningPriceInput(9)).toBe('9.00');
    expect(formatPlanningPriceInput(7.5)).toBe('7.50');
    expect(formatPlanningPriceInput('£1,200.5')).toBe('1200.50');
    expect(formatPlanningPriceInput(0)).toBe('0.00');
    expect(formatPlanningPriceInput(null)).toBe('');
    expect(formatPlanningPriceInput('')).toBe('');
  });
  it('rejects junk, negatives and values at the max', () => {
    expect(parsePlanningNumber('abc').ok).toBe(false);
    expect(parsePlanningNumber('-2').ok).toBe(false);
    expect(parsePlanningNumber('100', { max: 100 }).ok).toBe(false);
  });
});

const keg = {
  id: 'p1',
  name: 'Utopian',
  menu_name: 'Utopian Premium British Lager',
  case_size: '50L Keg',
  units_per_case: 1,
  unit_price: 100,
  pool_servings_per_unit: 88,
  category: { name: 'Draught' },
  product_suppliers: [{ supplier_id: 's1', unit_price: 88, is_preferred: true }],
};
const year = { vat_rate: 0.2, default_target_gp_pct: 70 };
const event = { target_gp_pct: 72, gp_amber_band: 4 };

describe('resolveUnitCost', () => {
  it('prefers locked snapshot, then deal, then supplier offer', () => {
    expect(resolveUnitCost({ unit_cost_snapshot: 80, unit_cost_override: 70 }, keg)).toEqual({ unitCost: 80, source: 'locked' });
    expect(resolveUnitCost({ unit_cost_override: 70 }, keg)).toEqual({ unitCost: 70, source: 'deal' });
    expect(resolveUnitCost({}, keg)).toEqual({ unitCost: 88, source: 'supplier' });
  });
  it('falls back to the product price without offers', () => {
    expect(resolveUnitCost({}, { unit_price: 12 })).toEqual({ unitCost: 12, source: 'supplier' });
  });
});

describe('resolveMenuLine', () => {
  it('derives cost per serve, GP and status', () => {
    const line = resolveMenuLine(
      { product_id: 'p1', menu_price: 6, projected_serves: 100 },
      { product: keg, year, event },
    );
    expect(line.menuName).toBe('Utopian Premium British Lager');
    expect(line.caseSize).toBe('50L Keg');
    expect(line.abv).toBeNull();
    expect(line.servesPerUnit).toBe(88);
    expect(line.caseCost).toBe(88);
    expect(line.costPerServe).toBe(1);
    expect(line.targetGpPct).toBe(72);
    expect(line.gpPct).toBeCloseTo(80, 10);
    expect(line.status).toBe('green');
    expect(line.revenueGross).toBe(600);
    expect(line.gpAmount).toBeCloseTo(400, 10);
  });
  it('uses house target and serves when the item has none', () => {
    const line = resolveMenuLine(
      { product_id: 'p1', menu_price: 3 },
      { product: keg, year, event, house: { target_gp_pct: 75, serves_per_unit: 44, menu_price: 6.5 } },
    );
    expect(line.servesPerUnit).toBe(44);
    expect(line.targetGpPct).toBe(75);
    expect(line.housePrice).toBe(6.5);
    expect(line.status).toBe('red');
  });
  it('suggested price falls back to the required price', () => {
    const line = resolveMenuLine({ product_id: 'p1' }, { product: keg, year, event: {} });
    expect(line.requiredPrice).toBe(4);
    expect(line.suggestedPrice).toBe(4);
    expect(line.gpPct).toBeNull();
    expect(line.status).toBeNull();
  });
  it('prices a half as half a serve of the same keg', () => {
    const pint = resolveMenuLine(
      { id: 'a', product_id: 'p1', serve_label: 'Pint', portion: 1, menu_price: 6 },
      { product: keg, year, event },
    );
    const half = resolveMenuLine(
      { id: 'b', product_id: 'p1', serve_label: 'Half', portion: 0.5, menu_price: 3.5 },
      { product: keg, year, event },
    );
    expect(pint.costPerServe).toBe(1);
    expect(half.costPerServe).toBe(0.5);
    expect(half.itemId).toBe('b');
    expect(half.serveLabel).toBe('Half');
    expect(half.gpPct).toBeGreaterThan(pint.gpPct);
  });
  it('keeps the frozen cost after supplier prices change', () => {
    const item = { product_id: 'p1', menu_price: 6, unit_cost_snapshot: 88 };
    const before = resolveMenuLine(item, { product: keg, year, event });
    const repriced = { ...keg, product_suppliers: [{ supplier_id: 's1', unit_price: 140, is_preferred: true }] };
    const after = resolveMenuLine(item, { product: repriced, year, event });
    expect(after.gpPct).toBe(before.gpPct);
  });
});

const canCase = {
  id: 'cs24',
  label: '24×330ml',
  units_per_case: 24,
  stock_unit: 'case',
  servings_per_unit: 1,
};
const camden = {
  id: 'camden',
  name: 'Camden Pale Ale',
  case_size: '24×330ml',
  stock_case_size_id: 'cs24',
  units_per_case: 24,
  stock_unit: 'case',
  unit_price: 1.375,
  product_suppliers: [{ supplier_id: 'tesco', unit_price: 1.375, case_price: 33, is_preferred: true }],
};

describe('Camden Pale Ale 24×330ml', () => {
  const ctx = { product: camden, caseSizes: [canCase], year, event };

  it('pulls 24 serves from the case and divides the £33 case price once', () => {
    const line = resolveMenuLine({ product_id: 'camden' }, ctx);
    expect(line.servesPerUnit).toBe(24);
    expect(line.unitCost).toBeCloseTo(1.375, 10);
    expect(line.caseCost).toBeCloseTo(33, 10);
    expect(line.costPerServe).toBeCloseTo(1.375, 10);
  });

  it('does not divide again when Serves is saved as 24', () => {
    const blank = resolveMenuLine({ product_id: 'camden' }, ctx);
    const typed = resolveMenuLine({ product_id: 'camden', serves_per_unit: 24 }, ctx);
    expect(typed.servesPerUnit).toBe(24);
    expect(typed.costPerServe).toBeCloseTo(blank.costPerServe, 10);
    expect(typed.costPerServe).toBeCloseTo(33 / 24, 10);
  });

  it('still divides the case price once when Serves is changed', () => {
    const line = resolveMenuLine({ product_id: 'camden', serves_per_unit: 12 }, ctx);
    expect(line.costPerServe).toBeCloseTo(33 / 12, 10);
  });
});

describe('menuTotals', () => {
  it('ignores excluded items and weights the mix', () => {
    const lines = [
      resolveMenuLine({ product_id: 'p1', menu_price: 6, projected_serves: 1000 }, { product: keg, year, event }),
      resolveMenuLine({ product_id: 'p1', menu_price: 1, projected_serves: 1000, included: false }, { product: keg, year, event }),
    ];
    const totals = menuTotals(lines);
    expect(totals.revenueGross).toBe(6000);
    expect(totals.gpPct).toBeCloseTo(80, 10);
  });
  it('can total at scenario prices', () => {
    const lines = [resolveMenuLine({ product_id: 'p1', menu_price: 6, projected_serves: 10 }, { product: keg, year, event })];
    const totals = menuTotals(lines, { priceFor: () => 7.2 });
    expect(totals.revenueGross).toBe(72);
  });
});

describe('scenarioGp', () => {
  it('rates an alternative price against the line target', () => {
    const line = resolveMenuLine({ product_id: 'p1', menu_price: 6 }, { product: keg, year, event });
    const s = scenarioGp(line, 4.2);
    expect(s.gpPct).toBeCloseTo((3.5 - 1) / 3.5 * 100, 10);
    expect(s.status).toBe('amber'); // 71.4% vs 72% target, 4pt band
    expect(scenarioGp(line, 4.8).status).toBe('green');
    expect(scenarioGp(line, 3).status).toBe('red');
    expect(scenarioGp(line, null).gpPct).toBeNull();
  });
});
