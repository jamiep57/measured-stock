import { describe, expect, it } from 'vitest';
import {
  cocktailToRecipe,
  cocktailsAwaitingSales,
  findCocktailForSale,
  resolveSaleRecipe,
  saleCtxFrom,
} from './cocktail-square.js';
import { computePluByProductId } from './recon.js';

const aperol = {
  id: 'ap',
  name: 'Aperol',
  case_size: '70cl',
  units_per_case: 1,
  stock_unit: 'bottle',
};

function spritz(overrides = {}) {
  return {
    id: 'c1',
    name: 'Aperol Spritz',
    included: true,
    square_item_name: 'SPRITZ APEROL',
    square_variation: null,
    ingredients: [{ product_id: 'ap', measures: 1, position: 0 }],
    ...overrides,
  };
}

function ctxFor(cocktails, menuItems = [{ product_id: 'ap', serves_per_unit: 28, included: true }]) {
  const ep = { product_id: 'ap', product: aperol };
  return saleCtxFrom({
    cocktails,
    menuItems,
    products: [aperol],
    caseSizes: [],
    event: { event_products: [ep] },
  });
}

describe('findCocktailForSale', () => {
  const open = spritz();
  const large = spritz({
    id: 'c2',
    square_variation: 'Large',
    ingredients: [{ product_id: 'ap', measures: 2, position: 0 }],
  });

  it('matches the Square item, not the menu name', () => {
    expect(findCocktailForSale([open], 'SPRITZ APEROL', 'Regular')?.id).toBe('c1');
    expect(findCocktailForSale([open], 'Aperol Spritz', 'Regular')).toBeNull();
  });

  it('lets a pinned variation win over a cocktail that matches any variation', () => {
    expect(findCocktailForSale([open, large], 'spritz aperol', 'Large')?.id).toBe('c2');
    expect(findCocktailForSale([open, large], 'SPRITZ APEROL', 'Regular')?.id).toBe('c1');
  });

  it('does not use a pinned cocktail for a different variation', () => {
    expect(findCocktailForSale([large], 'SPRITZ APEROL', 'Regular')).toBeNull();
  });

  it('skips excluded drinks and drinks with no Square item', () => {
    expect(findCocktailForSale([spritz({ included: false })], 'SPRITZ APEROL', 'Regular')).toBeNull();
    expect(findCocktailForSale([spritz({ square_item_name: '' })], 'SPRITZ APEROL', 'Regular')).toBeNull();
  });
});

describe('cocktailToRecipe', () => {
  it('turns one measure into a stock fraction of the serves per unit', () => {
    const recipe = cocktailToRecipe(spritz(), ctxFor([spritz()]));
    expect(recipe.source).toBe('cocktail');
    expect(recipe.ingredients).toHaveLength(1);
    expect(recipe.ingredients[0].qty).toBeCloseTo(1 / 28);
    expect(recipe.ingredients[0].qty_text).toBe('1/28');
    expect(recipe.ingredients[0].product_name).toContain('Aperol');
    expect(recipe.incomplete).toEqual([]);
  });

  it('leaves an ingredient unmapped when serves per unit was never set', () => {
    const recipe = cocktailToRecipe(spritz(), ctxFor([spritz()], []));
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.incomplete).toEqual([{ productId: 'ap', name: 'Aperol' }]);
  });
});

describe('resolveSaleRecipe', () => {
  const shared = [{
    till_item: 'SPRITZ APEROL',
    till_variation: 'Regular',
    ingredients: [{ product_name: 'Shared Gin', qty: 1, position: 0 }],
  }];

  it('prefers the event cocktail and ignores the shared recipe', () => {
    const resolved = resolveSaleRecipe('SPRITZ APEROL', 'Regular', shared, ctxFor([spritz()]));
    expect(resolved.fromCocktail).toBe(true);
    expect(resolved.sharedIgnored).toBe(true);
    expect(resolved.recipe.ingredients[0].product_name).toContain('Aperol');
  });

  it('uses the shared recipe when no cocktail matches', () => {
    const resolved = resolveSaleRecipe('Lager Pint', 'Regular', [{
      till_item: 'Lager Pint',
      till_variation: 'Regular',
      ingredients: [{ product_name: 'Lager', qty: 1, position: 0 }],
    }], ctxFor([]));
    expect(resolved.fromCocktail).toBe(false);
    expect(resolved.recipe.ingredients[0].product_name).toBe('Lager');
  });
});

describe('cocktailsAwaitingSales', () => {
  it('keeps a cocktail visible until a till line matches its Square item', () => {
    const cocktail = spritz();
    expect(cocktailsAwaitingSales([cocktail], [])).toEqual([cocktail]);
    expect(cocktailsAwaitingSales([cocktail], [
      { name: 'SPRITZ APEROL', variation: 'Regular', items_sold: 4 },
    ])).toEqual([]);
  });
});

describe('computePluByProductId cocktail mapping', () => {
  const ep = { product_id: 'ap', product: aperol, delivered_qty: 10, damaged_qty: 0 };
  const shared = [{
    till_item: 'SPRITZ APEROL',
    till_variation: 'Regular',
    ingredients: [{ product_name: 'Aperol', qty: 1, position: 0 }],
  }];

  it('uses one unit of Aperol for 28 spritz sales at 28 serves per unit', () => {
    const plu = computePluByProductId(
      [ep],
      [{ name: 'SPRITZ APEROL', variation: 'Regular', items_sold: 28 }],
      shared,
      [aperol],
      [],
      null,
      null,
      ctxFor([spritz()]),
    );
    expect(plu.ap).toBe(1);
  });

  it('treats a double as two measures', () => {
    const plu = computePluByProductId(
      [ep],
      [{ name: 'SPRITZ APEROL', variation: 'Regular', items_sold: 14 }],
      [],
      [aperol],
      [],
      null,
      null,
      ctxFor([spritz({ ingredients: [{ product_id: 'ap', measures: 2, position: 0 }] })]),
    );
    expect(plu.ap).toBe(1);
  });

  it('does not let a cocktail consume modifier sales', () => {
    const plu = computePluByProductId(
      [ep],
      [],
      [],
      [aperol],
      [],
      null,
      [{ modifier: 'SPRITZ APEROL', modifier_set: 'Regular', qty_sold: 28 }],
      ctxFor([spritz()]),
    );
    expect(plu.ap).toBe(0);
  });
});
