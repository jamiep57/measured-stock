import { describe, it, expect, vi } from 'vitest';
import {
  RECIPE_PACK_SEP,
  recipeStoredProductName,
  recipeProductNameRewrites,
  syncRecipeIngredientsForProductRename,
} from './recipe-stock.js';

const caseSizes = [
  { id: 'cs12', label: '12x250ml', stock_unit: 'case', units_per_case: 12, servings_per_unit: 1 },
];

describe('recipeProductNameRewrites', () => {
  it('rewrites pack-qualified and bare labels when name changes', () => {
    const oldProduct = { name: 'Bloody Classic 2', case_size: '12x250ml', case_size_id: 'cs12' };
    const newProduct = { name: 'Bloody Classic', case_size: '12x250ml', case_size_id: 'cs12' };
    const oldStored = recipeStoredProductName(oldProduct, caseSizes);
    expect(oldStored).toBe(`Bloody Classic 2${RECIPE_PACK_SEP}12x250ml`);
    expect(recipeProductNameRewrites(oldProduct, newProduct, caseSizes)).toEqual([
      { from: oldStored, to: `Bloody Classic${RECIPE_PACK_SEP}12x250ml` },
      { from: 'Bloody Classic 2', to: `Bloody Classic${RECIPE_PACK_SEP}12x250ml` },
    ]);
  });

  it('rewrites pack label only when pack changes (leaves bare name)', () => {
    const oldProduct = { name: 'Gin', case_size: '70cl' };
    const newProduct = { name: 'Gin', case_size: '1L' };
    expect(recipeProductNameRewrites(oldProduct, newProduct, [])).toEqual([
      { from: `Gin${RECIPE_PACK_SEP}70cl`, to: `Gin${RECIPE_PACK_SEP}1L` },
    ]);
  });

  it('rewrites bare stored name when product has no pack label', () => {
    const oldProduct = { name: 'House Ice' };
    const newProduct = { name: 'Ice Cubes' };
    expect(recipeProductNameRewrites(oldProduct, newProduct, [])).toEqual([
      { from: 'House Ice', to: 'Ice Cubes' },
    ]);
  });

  it('returns nothing when stored label is unchanged', () => {
    const p = { name: 'Cola', case_size: '24x330ml' };
    expect(recipeProductNameRewrites(p, { ...p }, [])).toEqual([]);
  });
});

describe('syncRecipeIngredientsForProductRename', () => {
  it('updates each rewrite via DB.update', async () => {
    const update = vi.fn(async () => []);
    const select = vi.fn(async () => []);
    const DB = { update, select, _: { enc: encodeURIComponent } };
    const oldProduct = { name: 'Bloody Classic 2', case_size: '12x250ml' };
    const newProduct = { name: 'Bloody Classic', case_size: '12x250ml' };

    await syncRecipeIngredientsForProductRename(DB, oldProduct, newProduct, caseSizes);

    expect(update.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(update.mock.calls[0][0]).toBe('recipe_ingredients');
    expect(update.mock.calls[0][1]).toContain('product_name=eq.');
    expect(update.mock.calls[0][2]).toEqual({
      product_name: `Bloody Classic${RECIPE_PACK_SEP}12x250ml`,
    });
    expect(select).toHaveBeenCalled();
  });

  it('rewrites leftover pack-qualified rows after a name change', async () => {
    const update = vi.fn(async () => []);
    const select = vi.fn(async () => ([
      { id: 'ri1', product_name: `Bloody Classic 2${RECIPE_PACK_SEP}12×250ml` },
    ]));
    const DB = { update, select, _: { enc: encodeURIComponent } };

    await syncRecipeIngredientsForProductRename(
      DB,
      { name: 'Bloody Classic 2', case_size: '12x250ml' },
      { name: 'Bloody Classic', case_size: '12x250ml' },
      caseSizes,
    );

    const byId = update.mock.calls.find((c) => String(c[1]).includes('id=eq.'));
    expect(byId?.[2]).toEqual({
      product_name: `Bloody Classic${RECIPE_PACK_SEP}12×250ml`,
    });
  });

  it('swallows recipe update failures', async () => {
    const DB = {
      update: vi.fn(async () => { throw new Error('missing table'); }),
      select: vi.fn(async () => { throw new Error('missing table'); }),
      _: { enc: encodeURIComponent },
    };
    await expect(syncRecipeIngredientsForProductRename(
      DB,
      { name: 'A', case_size: '1' },
      { name: 'B', case_size: '1' },
      [],
    )).resolves.toBeUndefined();
  });
});
