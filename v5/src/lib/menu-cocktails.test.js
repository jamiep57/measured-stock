import { describe, it, expect } from 'vitest';
import {
  cocktailServesByProduct,
  projectedServesWithCocktails,
  resolveCocktailLine,
} from './menu-cocktails.js';

const tequila = {
  id: 'teq',
  name: 'Tequila',
  case_size: '70cl',
  stock_unit: 'bottle',
  unit_price: 28,
  pool_servings_per_unit: 14,
  category: { name: 'Spirits' },
};
const triple = {
  id: 'trip',
  name: 'Triple sec',
  case_size: '70cl',
  stock_unit: 'bottle',
  unit_price: 16,
  pool_servings_per_unit: 16,
  category: { name: 'Spirits' },
};
const lime = {
  id: 'lime',
  name: 'Lime juice',
  case_size: '1L',
  stock_unit: 'bottle',
  unit_price: 5,
  pool_servings_per_unit: 10,
  category: { name: 'Softs' },
};

const ctx = {
  productById: new Map([[tequila.id, tequila], [triple.id, triple], [lime.id, lime]]),
  items: new Map(),
  caseSizes: [],
  event: { target_gp_pct: 70, gp_amber_band: 5 },
};

describe('resolveCocktailLine', () => {
  const cocktail = {
    id: 'c1',
    name: 'Margarita',
    included: true,
    menu_price: 12,
    projected_serves: 100,
  };
  const ingredients = [
    { product_id: 'teq', measures: 2 },
    { product_id: 'trip', measures: 1 },
    { product_id: 'lime', measures: 1 },
  ];

  it('adds the ingredient costs and prices the drink as one', () => {
    const line = resolveCocktailLine(cocktail, ingredients, ctx);
    expect(line.kind).toBe('cocktail');
    expect(line.drinkKind).toBe('cocktail');
    expect(line.category).toBe('Cocktails');
    expect(line.costPerServe).toBeCloseTo(5.5, 10);
    expect(line.gpPct).toBeCloseTo(45, 10);
    expect(line.revenueGross).toBe(1200);
    expect(line.ingredientSummary).toBe('Tequila · Triple sec · Lime juice');
    expect(line.productId).toBeNull();
  });

  it('uses a menu deal cost and serves override for an ingredient', () => {
    const line = resolveCocktailLine(
      { id: 'c1', name: 'Margarita', menu_price: 12 },
      [{ product_id: 'teq', measures: 1 }],
      {
        ...ctx,
        items: new Map([['teq', { product_id: 'teq', unit_cost_override: 14, serves_per_unit: 7 }]]),
      },
    );
    expect(line.costPerServe).toBeCloseTo(2, 10);
  });

  it('files a spirit and mixer in its own section', () => {
    const line = resolveCocktailLine(
      { id: 'c2', name: 'Vodka Red Bull', drink_kind: 'spirit_mixer', menu_price: 8 },
      [{ product_id: 'teq', measures: 1 }, { product_id: 'lime', measures: 1 }],
      ctx,
    );
    expect(line.kind).toBe('cocktail');
    expect(line.drinkKind).toBe('spirit_mixer');
    expect(line.category).toBe('Spirit & mixers');
    expect(line.ingredientSummary).toBe('Tequila · Lime juice');
  });

  it('leaves the cost empty when an ingredient has no price', () => {
    const line = resolveCocktailLine(
      { id: 'c1', name: 'Margarita', menu_price: 12 },
      [{ product_id: 'teq', measures: 1 }, { product_id: 'missing', measures: 1 }],
      ctx,
    );
    expect(line.costPerServe).toBeNull();
    expect(line.gpPct).toBeNull();
  });
});

describe('cocktailServesByProduct', () => {
  it('turns projected cocktails into serves of each ingredient', () => {
    const map = cocktailServesByProduct([
      {
        included: true,
        projected_serves: 100,
        ingredients: [
          { product_id: 'teq', measures: 2 },
          { product_id: 'lime', measures: 1 },
        ],
      },
      {
        included: false,
        projected_serves: 50,
        ingredients: [{ product_id: 'teq', measures: 2 }],
      },
      {
        included: true,
        projected_serves: null,
        ingredients: [{ product_id: 'teq', measures: 1 }],
      },
    ]);
    expect(map.get('teq')).toBe(200);
    expect(map.get('lime')).toBe(100);
  });
});

describe('projectedServesWithCocktails', () => {
  it('adds cocktail pours onto the product forecast', () => {
    expect(projectedServesWithCocktails({ included: true, projected_serves: 4 }, 6)).toEqual({ mode: 'projection', serves: 10 });
  });
  it('still buys an ingredient that is not sold on its own', () => {
    expect(projectedServesWithCocktails({ included: false, projected_serves: 4 }, 10)).toEqual({ mode: 'projection', serves: 10 });
    expect(projectedServesWithCocktails(null, 3)).toEqual({ mode: 'projection', serves: 3 });
  });
  it('leaves a planned-quantity override alone', () => {
    expect(projectedServesWithCocktails({ planned_qty_override: 2, projected_serves: 40 }, 10)).toEqual({ mode: 'override', serves: null });
  });
  it('plans nothing when there is no forecast', () => {
    expect(projectedServesWithCocktails({ included: true }, 0)).toEqual({ mode: 'none', serves: null });
  });
});
