import { describe, it, expect } from 'vitest';
import { mergeTillRowsByItem, parseSaleDate, parseTillRows } from '../lib/till-import.js';

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
      location: null,
      sale_date: null,
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

  it('aggregates Item Details rows per item, location and day', () => {
    const base = { Item: 'Hells', 'Price Point Name': 'Pint', Category: 'Draught', Count: '1' };
    const rows = parseTillRows([
      { Date: '2027-06-05', Location: 'Main Bar', Qty: '2', 'Net Sales': '£10.00', 'Gross Sales': '£12.00', ...base },
      { Date: '2027-06-05', Location: 'Main Bar', Qty: '1', 'Net Sales': '£5.00', 'Gross Sales': '£6.00', ...base },
      { Date: '2027-06-05', Location: 'Main Bar', Qty: '-1', 'Net Sales': '-£5.00', 'Gross Sales': '-£6.00', ...base },
      { Date: '06/06/2027', Location: 'Stage Bar', Qty: '4', 'Net Sales': '£20.00', 'Gross Sales': '£24.00', ...base },
    ]);
    expect(rows).toHaveLength(2);
    const main = rows.find((r) => r.location === 'Main Bar');
    expect(main).toMatchObject({ variation: 'Pint', sale_date: '2027-06-05', items_sold: 2, net_sales: 10, gross_sales: 12 });
    expect(rows.find((r) => r.location === 'Stage Bar').sale_date).toBe('2027-06-06');
  });

  it('falls back to Device Name for location', () => {
    const rows = parseTillRows([{ Item: 'Water', Qty: 1, 'Device Name': 'Till 3' }]);
    expect(rows[0].location).toBe('Till 3');
  });
});

describe('parseSaleDate', () => {
  it('reads ISO, UK slash, US-only slash and Excel serial dates', () => {
    expect(parseSaleDate('2027-06-05 14:00')).toBe('2027-06-05');
    expect(parseSaleDate('05/06/2027')).toBe('2027-06-05');
    expect(parseSaleDate('06/25/2027')).toBe('2027-06-25');
    expect(parseSaleDate(46543)).toBe('2027-06-05');
    expect(parseSaleDate('n/a')).toBeNull();
  });
});

describe('mergeTillRowsByItem', () => {
  it('sums locations and days into one mapping row', () => {
    const merged = mergeTillRowsByItem([
      { name: 'Hells', variation: 'Pint', items_sold: 2, net_sales: 10, location: 'A' },
      { name: 'Hells', variation: 'Pint', items_sold: 3, net_sales: 15, location: 'B' },
      { name: 'Water', variation: 'Regular', items_sold: 1, net_sales: 2 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ items_sold: 5, net_sales: 25 });
  });
});
