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

  it('uses the same serves default the menu grid shows when the row is blank', () => {
    const recipe = cocktailToRecipe(spritz(), ctxFor([spritz()], []));
    expect(recipe.incomplete).toEqual([]);
    expect(recipe.ingredients[0].qty).toBeCloseTo(1);
  });

  it('leaves an ingredient unmapped when the product is gone', () => {
    const recipe = cocktailToRecipe(spritz(), saleCtxFrom({
      cocktails: [spritz()],
      menuItems: [],
      products: [],
      caseSizes: [],
    }));
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.incomplete).toEqual([{ productId: 'ap', name: 'Product' }]);
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

const camdenCase = {
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
  product_suppliers: [{ unit_price: 1.375, case_price: 33, is_preferred: true }],
};

function pale(overrides = {}) {
  return {
    id: 'pale',
    name: 'Camden Pale',
    included: true,
    square_item_name: 'CAMDEN PALE',
    square_variation: null,
    ingredients: [{ product_id: 'camden', measures: 1, position: 0 }],
    ...overrides,
  };
}

function camdenCtx(menuItems = []) {
  return saleCtxFrom({
    cocktails: [pale()],
    menuItems,
    products: [camden],
    caseSizes: [camdenCase],
    event: { event_products: [{ product_id: 'camden', product: camden }] },
  });
}

describe('Camden Pale Ale serves', () => {
  it('uses the 24 serves the menu grid shows when the row is blank', () => {
    const recipe = cocktailToRecipe(pale(), camdenCtx());
    expect(recipe.incomplete).toEqual([]);
    expect(recipe.ingredients[0].qty).toBeCloseTo(1 / 24);
    expect(recipe.ingredients[0].qty_text).toBe('1/24');
  });

  it('does not divide twice when the menu row already says 24', () => {
    const recipe = cocktailToRecipe(pale(), camdenCtx([
      { product_id: 'camden', serves_per_unit: 24, included: true },
    ]));
    expect(recipe.ingredients[0].qty).toBeCloseTo(1 / 24);
  });

  it('turns 24 sales into one case', () => {
    const plu = computePluByProductId(
      [{ product_id: 'camden', product: camden, delivered_qty: 10, damaged_qty: 0 }],
      [{ name: 'CAMDEN PALE', variation: 'Regular', items_sold: 24 }],
      [],
      [camden],
      [camdenCase],
      null,
      null,
      camdenCtx(),
    );
    expect(plu.camden).toBe(1);
  });
});

describe('menu rows pushed to Square', () => {
  const lager = { id: 'lager', name: 'Utopian Lager 50L', menu_name: 'Utopian Lager', case_size: '50L', units_per_case: 1 };
  const menuItems = [
    { product_id: 'lager', serve_label: 'Pint', serves_per_unit: 88, portion: 1, included: true },
    { product_id: 'lager', serve_label: 'Half', serves_per_unit: 88, portion: 0.5, included: true },
  ];
  const ctx = (extra = {}) => saleCtxFrom({
    cocktails: [],
    menuItems,
    products: [lager],
    caseSizes: [],
    event: { event_products: [{ product_id: 'lager', product: lager }] },
    ...extra,
  });

  it('maps the Square item name and serve size to the product without a recipe', () => {
    const pint = resolveSaleRecipe('Utopian Lager', 'Pint', [], ctx()).recipe;
    expect(pint.source).toBe('menu');
    expect(pint.ingredients[0].qty).toBeCloseTo(1 / 88);
    const half = resolveSaleRecipe('utopian lager', 'half', [], ctx()).recipe;
    expect(half.ingredients[0].qty).toBeCloseTo(0.5 / 88);
  });

  it('leaves unknown serves and names unmapped', () => {
    expect(resolveSaleRecipe('Utopian Lager', 'Jug', [], ctx()).recipe).toBeNull();
    expect(resolveSaleRecipe('Utopian Lager 50L', 'Pint', [], ctx()).recipe).toBeNull();
  });

  it('matches the bracketed name Square gets when two products share a name', () => {
    const keg = { id: 'keg', name: 'Utopian Lager', case_size: '50L Keg', stock_unit: 'keg' };
    const can = { id: 'can', name: 'Utopian Lager', case_size: '24×440ml Cans', stock_unit: 'case' };
    const both = saleCtxFrom({
      cocktails: [],
      menuItems: [
        { product_id: 'keg', serve_label: 'Pint', serves_per_unit: 88, included: true },
        { product_id: 'can', serve_label: null, serves_per_unit: 24, included: true },
      ],
      products: [keg, can],
      caseSizes: [],
    });
    const pint = resolveSaleRecipe('Utopian Lager (Draught)', 'Pint', [], both).recipe;
    expect(pint.ingredients[0].qty).toBeCloseTo(1 / 88);
    const tin = resolveSaleRecipe('Utopian Lager (Can)', 'Regular', [], both).recipe;
    expect(tin.ingredients[0].qty).toBeCloseTo(1 / 24);
  });

  it('a shared recipe still wins over the menu row', () => {
    const recipes = [{
      till_item: 'Utopian Lager',
      till_variation: 'Pint',
      ingredients: [{ product_name: 'Other', qty: 0.02, position: 0 }],
    }];
    const recipe = resolveSaleRecipe('Utopian Lager', 'Pint', recipes, ctx()).recipe;
    expect(recipe.ingredients[0].product_name).toBe('Other');
  });
});
