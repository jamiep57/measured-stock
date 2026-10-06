import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesiredCatalog, diffCatalog } from './catalog-plan.js';

const products = [
  { id: 'p-lager', name: 'Utopian Lager 50L', menu_name: 'Utopian Lager', category_id: 'c-beer' },
  { id: 'p-can', name: 'Utopian Lager Can 24x330', menu_name: 'Utopian Lager (Can)', category_id: 'c-beer' },
  { id: 'p-vodka', name: 'Finlandia 70cl', category_id: 'c-spirit' },
  { id: 'p-coke', name: 'Coke 24x330', category_id: 'c-soft' },
];
const categories = [
  { id: 'c-beer', name: 'Beer' },
  { id: 'c-spirit', name: 'Spirits' },
  { id: 'c-soft', name: 'Softs' },
];
const barLinks = [
  { bar_id: 'b-lake', square_location_id: 'L-LAKE' },
  { bar_id: 'b-forest', square_location_id: 'L-FOREST' },
];

function desired(extra = {}) {
  return buildDesiredCatalog({
    products,
    categories,
    barLinks,
    menuItems: [
      { product_id: 'p-lager', serve_label: 'Pint', menu_price: 7.45 },
      { product_id: 'p-lager', serve_label: 'Half', menu_price: 3.95 },
      { product_id: 'p-can', serve_label: null, menu_price: 6.95 },
      { product_id: 'p-coke', serve_label: 'Can', menu_price: null },
    ],
    distribution: [
      { bar_id: 'b-lake', product_id: 'p-lager', qty_allocated: 10 },
      { bar_id: 'b-forest', product_id: 'p-lager', qty_allocated: 0 },
      { bar_id: 'b-forest', product_id: 'p-can', qty_allocated: 5 },
      { bar_id: 'b-lake', product_id: 'p-vodka', qty_allocated: 2 },
      { bar_id: 'b-lake', product_id: 'p-coke', qty_allocated: 2 },
    ],
    cocktails: [{ id: 'k1', name: 'Vodka Coke', serve_label: 'Single', menu_price: 8.5 }],
    ingredients: [
      { cocktail_id: 'k1', product_id: 'p-vodka' },
      { cocktail_id: 'k1', product_id: 'p-coke' },
    ],
    ...extra,
  });
}

test('one item per product, serve sizes become variations, prices in pence', () => {
  const { items, warnings } = desired();
  const lager = items.find((i) => i.key === 'product:p-lager');
  assert.equal(lager.name, 'Utopian Lager');
  assert.deepEqual(lager.variations.map((v) => [v.name, v.priceMinor]), [['Pint', 745], ['Half', 395]]);
  assert.deepEqual(lager.locations, ['L-LAKE']);
  assert.equal(lager.category.name, 'Beer');

  const can = items.find((i) => i.key === 'product:p-can');
  assert.deepEqual(can.variations.map((v) => v.name), ['Regular']);
  assert.deepEqual(can.locations, ['L-FOREST']);

  assert.equal(items.some((i) => i.key === 'product:p-coke'), false);
  assert.ok(warnings.some((w) => /no menu price/.test(w)));
});

test('cocktail is offered only where every ingredient is distributed', () => {
  const { items } = desired();
  const vc = items.find((i) => i.key === 'cocktail:vodka coke');
  assert.deepEqual(vc.locations, ['L-LAKE']);
  assert.equal(vc.category.name, 'Cocktails');
  assert.deepEqual(vc.variations.map((v) => [v.name, v.priceMinor]), [['Single', 850]]);
});

const base = { linkedLocationIds: ['L-LAKE', 'L-FOREST'], allLocationIds: ['L-LAKE', 'L-FOREST', 'L-OTHER'], currency: 'GBP' };

test('creates new items with temp ids and records locations to add', () => {
  const plan = diffCatalog({ ...base, desired: desired().items, objects: [], map: [] });
  assert.equal(plan.summary.itemsCreated, 3);
  assert.deepEqual(plan.summary.categoriesCreated.sort(), ['Beer', 'Cocktails']);
  const lager = plan.upserts.find((o) => o.type === 'ITEM' && o.item_data.name === 'Utopian Lager');
  assert.equal(lager.present_at_all_locations, false);
  assert.deepEqual(lager.present_at_location_ids, ['L-LAKE']);
  assert.equal(lager.item_data.variations[0].item_variation_data.price_money.amount, 745);
  assert.equal(lager.item_data.variations[0].item_variation_data.item_id, lager.id);
  assert.ok(plan.summary.locations['L-LAKE'].add.includes('Utopian Lager'));
  assert.ok(plan.mapRows.some((r) => r.kind === 'variation' && r.app_key === 'product:p-lager|pint'));
});

test('adopts an existing item by name, keeps other locations, updates price', () => {
  const existing = {
    type: 'ITEM',
    id: 'SQ-LAGER',
    version: 5,
    present_at_all_locations: true,
    absent_at_location_ids: ['L-FOREST'],
    item_data: {
      name: 'utopian lager',
      variations: [
        { type: 'ITEM_VARIATION', id: 'SQ-PINT', version: 5, present_at_all_locations: true, item_variation_data: { item_id: 'SQ-LAGER', name: 'Pint', pricing_type: 'FIXED_PRICING', price_money: { amount: 700, currency: 'GBP' } } },
        { type: 'ITEM_VARIATION', id: 'SQ-JUG', version: 5, present_at_all_locations: true, item_variation_data: { item_id: 'SQ-LAGER', name: 'Jug', pricing_type: 'FIXED_PRICING', price_money: { amount: 2000, currency: 'GBP' } } },
      ],
    },
  };
  const plan = diffCatalog({ ...base, desired: desired().items, objects: [existing], map: [] });
  const item = plan.upserts.find((o) => o.id === 'SQ-LAGER');
  assert.equal(item.version, 5);
  assert.deepEqual(item.present_at_location_ids, ['L-LAKE', 'L-OTHER']);
  assert.equal(item.absent_at_location_ids, undefined);
  const pint = item.item_data.variations.find((v) => v.id === 'SQ-PINT');
  assert.equal(pint.item_variation_data.price_money.amount, 745);
  const half = item.item_data.variations.find((v) => v.item_variation_data.name === 'Half');
  assert.match(half.id, /^#var-/);
  const jug = item.item_data.variations.find((v) => v.id === 'SQ-JUG');
  assert.deepEqual(jug.present_at_location_ids, ['L-OTHER']);
  assert.deepEqual(plan.summary.priceChanges, [{ item: 'Utopian Lager', variation: 'Pint', from: 700, to: 745 }]);
  assert.equal(plan.summary.itemsUpdated, 1);
});

test('an item built on Square item options keeps its options and warns about a missing size', () => {
  const existing = {
    type: 'ITEM',
    id: 'SQ-LAGER',
    version: 2,
    present_at_all_locations: true,
    item_data: {
      name: 'Utopian Lager',
      item_options: [{ item_option_id: 'OPT-SIZE' }],
      variations: [
        { type: 'ITEM_VARIATION', id: 'SQ-PINT', version: 2, present_at_all_locations: true, item_variation_data: { item_id: 'SQ-LAGER', name: 'Pint', pricing_type: 'FIXED_PRICING', price_money: { amount: 700, currency: 'GBP' }, item_option_values: [{ item_option_id: 'OPT-SIZE', item_option_value_id: 'VAL-PINT' }] } },
      ],
    },
  };
  const plan = diffCatalog({ ...base, desired: desired().items, objects: [existing], map: [] });
  const item = plan.upserts.find((o) => o.id === 'SQ-LAGER');
  assert.deepEqual(item.item_data.variations.map((v) => v.id), ['SQ-PINT']);
  assert.equal(item.item_data.variations[0].item_variation_data.item_option_values[0].item_option_value_id, 'VAL-PINT');
  assert.equal(plan.summary.variationsCreated, 2);
  assert.match(plan.warnings[0], /add a "Half" option in Square/);
});

test('hides unrelated items only at linked locations and skips unchanged ones', () => {
  const stray = {
    type: 'ITEM',
    id: 'SQ-WINE',
    version: 2,
    present_at_location_ids: ['L-LAKE', 'L-OTHER'],
    item_data: { name: 'House Wine', variations: [] },
  };
  const elsewhere = {
    type: 'ITEM',
    id: 'SQ-FOOD',
    version: 1,
    present_at_location_ids: ['L-OTHER'],
    item_data: { name: 'Burger', variations: [] },
  };
  const plan = diffCatalog({ ...base, desired: [], objects: [stray, elsewhere], map: [] });
  assert.equal(plan.upserts.length, 1);
  assert.deepEqual(plan.upserts[0].present_at_location_ids, ['L-OTHER']);
  assert.deepEqual(plan.summary.locations['L-LAKE'].remove, ['House Wine']);
});

test('a stored mapping wins over a name match and an unchanged item is not re-sent', () => {
  const { items } = desired({
    menuItems: [{ product_id: 'p-can', serve_label: null, menu_price: 6.95 }],
    cocktails: [],
  });
  const mappedItem = {
    type: 'ITEM',
    id: 'SQ-CAN',
    version: 3,
    present_at_location_ids: ['L-FOREST'],
    item_data: {
      name: 'Utopian Lager (Can)',
      categories: [{ id: 'SQ-BEER' }],
      variations: [{ type: 'ITEM_VARIATION', id: 'SQ-CAN-R', version: 3, present_at_location_ids: ['L-FOREST'], item_variation_data: { item_id: 'SQ-CAN', name: 'Regular', pricing_type: 'FIXED_PRICING', price_money: { amount: 695, currency: 'GBP' } } }],
    },
  };
  const category = { type: 'CATEGORY', id: 'SQ-BEER', version: 1, category_data: { name: 'Beer' } };
  const plan = diffCatalog({
    ...base,
    desired: items,
    objects: [mappedItem, category],
    map: [{ kind: 'item', app_key: 'product:p-can', square_id: 'SQ-CAN' }],
  });
  assert.equal(plan.upserts.length, 0);
  assert.equal(plan.summary.itemsUpdated, 0);
});
