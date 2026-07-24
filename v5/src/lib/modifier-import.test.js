import { describe, it, expect } from 'vitest';
import { parseModifierRows } from '../lib/modifier-import.js';
import {
  findRecipe, recipeKey, mappedProductId, recipeOnEvent, recipeIsMapped,
} from '../lib/square-recipes.js';

describe('parseModifierRows', () => {
  it('parses Square-style columns', () => {
    const rows = parseModifierRows([
      {
        'Modifier Set': 'Mixer',
        Modifier: 'Coke',
        'Net Qty Sold': '12',
        'Net Sales': '£24.00',
      },
    ]);
    expect(rows).toEqual([{
      modifier_set: 'Mixer',
      modifier: 'Coke',
      qty_sold: 12,
      net_sales: 24,
    }]);
  });

  it('drops zero qty lines', () => {
    const rows = parseModifierRows([{ Modifier: 'Coke', 'Qty Sold': 0 }]);
    expect(rows).toEqual([]);
  });
});

describe('square-recipes', () => {
  it('matches modifier + set to recipe', () => {
    const recipes = [{ till_item: 'Coke', till_variation: 'Mixer', ingredients: [{ product_name: 'Coca Cola', qty: 1, position: 0 }] }];
    const r = findRecipe(recipes, 'Coke', 'Mixer');
    expect(r?.till_item).toBe('Coke');
    expect(recipeKey('Coke', 'Mixer')).toBe('coke|mixer');
  });

  it('resolves mapped product id from event products', () => {
    const recipes = [{ till_item: 'Coke', till_variation: 'Mixer', ingredients: [{ product_name: 'Coca Cola', qty: 1, position: 0 }] }];
    const eps = [{ product_id: 'p1', product: { name: 'Coca Cola' } }];
    expect(mappedProductId(findRecipe(recipes, 'Coke', 'Mixer'), eps)).toBe('p1');
  });

  it('recipeOnEvent requires all ingredients on event', () => {
    const recipes = [{
      till_item: 'G&T',
      till_variation: 'Regular',
      ingredients: [
        { product_name: 'Gin', qty: 0.04, position: 0 },
        { product_name: 'Tonic', qty: 0.25, position: 1 },
      ],
    }];
    const eps = [{ product_id: 'p1', product: { name: 'Gin' } }];
    expect(recipeIsMapped(findRecipe(recipes, 'G&T', 'Regular'))).toBe(true);
    expect(recipeOnEvent(findRecipe(recipes, 'G&T', 'Regular'), eps)).toBe(false);
    eps.push({ product_id: 'p2', product: { name: 'Tonic' } });
    expect(recipeOnEvent(findRecipe(recipes, 'G&T', 'Regular'), eps)).toBe(true);
  });

  it('maps volume pool ingredients and checks pool members on event', () => {
    const recipes = [{
      till_item: 'Sprite',
      till_variation: 'Regular',
      ingredients: [{ pool_name: 'Lemon-lime soft', qty: 1, position: 0 }],
    }];
    expect(recipeIsMapped(findRecipe(recipes, 'Sprite', 'Regular'))).toBe(true);
    expect(recipeOnEvent(findRecipe(recipes, 'Sprite', 'Regular'), [
      { product_id: 'p1', product: { name: 'Coke' } },
    ])).toBe(false);
    expect(recipeOnEvent(findRecipe(recipes, 'Sprite', 'Regular'), [
      { product_id: 'p2', product: { name: '7up', pool_name: 'Lemon-lime soft' } },
    ])).toBe(true);
  });
});
