import { describe, it, expect } from 'vitest';
import { parseTillRows } from '../lib/till-import.js';

describe('parseTillRows', () => {
  it('parses Square Item Sales columns', () => {
    const rows = parseTillRows([
      {
        'Item Name': 'G&T',
        'Item Variation': 'Large',
        Category: 'Spirits',
        SKU: 'GTL',
        'Items Sold': '8',
        'Net Sales': '£64.00',
        'Gross Sales': '£70.00',
      },
    ]);
    expect(rows).toEqual([{
      name: 'G&T',
      variation: 'Large',
      sku: 'GTL',
      category: 'Spirits',
      items_sold: 8,
      net_sales: 64,
      gross_sales: 70,
    }]);
  });

  it('defaults variation to Regular when missing', () => {
    const rows = parseTillRows([{ 'Item Name': 'Water', 'Items Sold': 3 }]);
    expect(rows[0].variation).toBe('Regular');
  });

  it('drops zero qty lines', () => {
    const rows = parseTillRows([{ 'Item Name': 'Water', 'Items Sold': 0 }]);
    expect(rows).toEqual([]);
  });
});
