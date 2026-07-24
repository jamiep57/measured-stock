import { describe, it, expect } from 'vitest';
import { buildCountSheetsHtml } from './count-sheets-print.js';

const event = {
  name: 'Summer Fest',
  bars: [
    { id: 'bar-a', name: 'Main Bar' },
    { id: 'bar-b', name: 'VIP' },
    { id: 'bar-c', name: 'Bone Yard' },
  ],
  event_products: [
    { product_id: 'p1', product: { name: 'Lager', case_size: '24x330', category: { name: 'Beer' } } },
    { product_id: 'p2', product: { name: 'Gin', case_size: '6x70cl', category: { name: 'Spirits' } } },
    { product_id: 'p3', product: { name: 'Cider', case_size: '24x440', category: { name: 'Beer' } } },
  ],
};

const barProducts = [
  { bar_id: 'bar-a', product_id: 'p1' },
  { bar_id: 'bar-a', product_id: 'p2' },
  { bar_id: 'bar-b', product_id: 'p3' },
];

describe('buildCountSheetsHtml', () => {
  it('builds one sheet per serving bar with only that bar’s products', () => {
    const result = buildCountSheetsHtml({ event, barProducts, caseSizes: [] });
    expect(result.error).toBeUndefined();
    expect(result.barCount).toBe(2);
    expect(result.html).toContain('Main Bar');
    expect(result.html).toContain('VIP');
    expect(result.html).not.toContain('Bone Yard');
    expect(result.html).toContain('Lager');
    expect(result.html).toContain('Gin');
    expect(result.html).toContain('Cider');
  });

  it('errors when no bars exist', () => {
    const result = buildCountSheetsHtml({
      event: { name: 'Empty', bars: [], event_products: event.event_products },
      barProducts,
    });
    expect(result.error).toMatch(/Add bars/);
  });

  it('errors when no products are on any location menu', () => {
    const result = buildCountSheetsHtml({
      event: {
        name: 'Empty menus',
        bars: [{ id: 'bar-a', name: 'Main Bar' }],
        event_products: [],
      },
      barProducts: [],
    });
    expect(result.error).toMatch(/No products/);
  });
});
