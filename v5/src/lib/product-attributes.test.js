import { describe, it, expect } from 'vitest';
import { menuNameOf, palletQtyOf, normaliseProductAttributes } from './product-attributes.js';

describe('menuNameOf', () => {
  it('prefers the customer-facing menu name and falls back to the product name', () => {
    expect(menuNameOf({ name: 'Utopian', menu_name: 'Utopian Premium British Lager' })).toBe('Utopian Premium British Lager');
    expect(menuNameOf({ name: 'Utopian', menu_name: '  ' })).toBe('Utopian');
  });
});

describe('palletQtyOf', () => {
  const caseSizes = [{ id: 'cs1', cases_per_pallet: 80 }];
  it('uses the product override before the case size default', () => {
    expect(palletQtyOf({ pallet_qty: 60, stock_case_size_id: 'cs1' }, caseSizes)).toBe(60);
    expect(palletQtyOf({ stock_case_size_id: 'cs1' }, caseSizes)).toBe(80);
    expect(palletQtyOf({}, caseSizes)).toBeNull();
  });
});

describe('normaliseProductAttributes', () => {
  it('normalises blanks to null and validates enums', () => {
    expect(normaliseProductAttributes({ menu_name: ' ', pallet_qty: '', keg_coupler_type: '', dispense_gas_type: '' }))
      .toEqual({ patch: { menu_name: null, pallet_qty: null, keg_coupler_type: null, dispense_gas_type: null }, error: null });
    expect(normaliseProductAttributes({ keg_coupler_type: 'S', dispense_gas_type: 'Mixed 60/40', pallet_qty: '72' }).patch)
      .toMatchObject({ keg_coupler_type: 'S', dispense_gas_type: 'Mixed 60/40', pallet_qty: 72 });
  });

  it('rejects invalid values', () => {
    expect(normaliseProductAttributes({ pallet_qty: '-1' }).error).toMatch(/positive/);
    expect(normaliseProductAttributes({ keg_coupler_type: 'Z' }).error).toMatch(/coupler/);
    expect(normaliseProductAttributes({ dispense_gas_type: 'Helium' }).error).toMatch(/gas/);
  });
});
