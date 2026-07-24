import { describe, it, expect } from 'vitest';
import {
  normPoolName,
  defaultPoolServings,
  servingsPerCase,
  poolFractionText,
  defaultPoolFractionText,
  poolServingsFromFraction,
  groupProductsByPool,
  poolSummary,
} from './volume-pools.js';

describe('volume-pools', () => {
  it('normalises pool names', () => {
    expect(normPoolName('  House  Vodka ')).toBe('house vodka');
    expect(normPoolName('')).toBe('');
  });

  it('defaults servings from case size then 1', () => {
    const caseSizes = [{ id: 'cs1', label: '24×330ml', units_per_case: 24, servings_per_unit: 1, stock_unit: 'single' }];
    expect(defaultPoolServings({ case_size_id: 'cs1' }, caseSizes)).toBe(1);
    expect(defaultPoolServings({ pool_servings_per_unit: 28 }, caseSizes)).toBe(28);
    expect(defaultPoolServings({}, [])).toBe(1);
  });

  it('uses pack fractions 1/24 vs 1/12 for different case sizes', () => {
    const caseSizes = [
      { id: 'c24', label: '24×330ml', units_per_case: 24, servings_per_unit: 1, stock_unit: 'single' },
      { id: 'c12', label: '12×330ml', units_per_case: 12, servings_per_unit: 1, stock_unit: 'single' },
    ];
    const sprite = { name: 'Sprite', case_size_id: 'c24' };
    const sevenUp = { name: '7up', case_size_id: 'c12' };

    expect(defaultPoolFractionText(sprite, caseSizes)).toBe('1/24');
    expect(defaultPoolFractionText(sevenUp, caseSizes)).toBe('1/12');

    const spritePatch = poolServingsFromFraction('1/24', sprite, caseSizes);
    const sevenPatch = poolServingsFromFraction('1/12', sevenUp, caseSizes);
    expect(spritePatch.pool_servings_text).toBe('1/24');
    expect(spritePatch.pool_servings_per_unit).toBeCloseTo(1);
    expect(sevenPatch.pool_servings_per_unit).toBeCloseTo(1);

    expect(servingsPerCase({ ...sprite, ...spritePatch }, caseSizes)).toBeCloseTo(24);
    expect(servingsPerCase({ ...sevenUp, ...sevenPatch }, caseSizes)).toBeCloseTo(12);
  });

  it('prefers stored fraction text for display', () => {
    const p = {
      pool_servings_text: '1/24',
      pool_servings_per_unit: 1,
      units_per_case: 24,
    };
    expect(poolFractionText(p, [])).toBe('1/24');
  });

  it('derives bottle pour fraction 1/28', () => {
    const caseSizes = [{ id: 'b70', label: '70cl', units_per_case: 1, servings_per_unit: 28, stock_unit: 'bottle' }];
    const vodka = { case_size_id: 'b70' };
    expect(defaultPoolFractionText(vodka, caseSizes)).toBe('1/28');
    const patch = poolServingsFromFraction('1/28', vodka, caseSizes);
    expect(patch.pool_servings_per_unit).toBeCloseTo(28);
  });

  it('groups products by pool_name', () => {
    const products = [
      { id: '1', name: 'Sprite 24', pool_name: 'Lemon-lime soft' },
      { id: '2', name: '7up 12', pool_name: 'lemon-lime soft' },
      { id: '3', name: 'Coke', pool_name: null },
    ];
    const pools = groupProductsByPool(products);
    expect(pools).toHaveLength(1);
    expect(pools[0].name).toBe('Lemon-lime soft');
    expect(pools[0].members).toHaveLength(2);
    expect(poolSummary(pools[0], [])).toMatch(/2 products/);
  });
});
