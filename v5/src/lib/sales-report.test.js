import { describe, it, expect } from 'vitest';
import {
  eventHeadlines, filterSales, groupSales, reconCostTotals, revenueComparison, rowsWithEvents, salesCsv, salesTotals,
} from './sales-report.js';

const rows = [
  { name: 'Hells', variation: 'Pint', category: 'Draught', location: 'Main', sale_date: '2027-06-05', items_sold: 100, net_sales: 500, gross_sales: 600 },
  { name: 'Hells', variation: 'Pint', category: 'Draught', location: 'Stage', sale_date: '2027-06-06', items_sold: 50, net_sales: 250, gross_sales: 300 },
  { name: 'Water', variation: 'Regular', category: 'Soft', location: 'Main', sale_date: '2027-06-06', items_sold: 40, net_sales: 100, gross_sales: 120 },
  { name: 'Legacy', variation: 'Regular', category: 'Soft', location: null, sale_date: null, items_sold: 10, net_sales: 50, gross_sales: 60 },
];

describe('sales grouping', () => {
  it('totals and lists locations and days', () => {
    const t = salesTotals(rows);
    expect(t).toMatchObject({ items: 200, net: 900, gross: 1080, avgGrossPerItem: 5.4 });
    expect(t.locations).toEqual(['Main', 'Stage']);
    expect(t.days).toEqual(['2027-06-05', '2027-06-06']);
  });

  it('groups by product with share of net', () => {
    const g = groupSales(rows, 'item');
    expect(g[0]).toMatchObject({ label: 'Hells · Pint', items: 150, net: 750, share: 83.3 });
    expect(g.find((x) => x.label === 'Water').sub).toBe('Soft');
  });

  it('groups by location and date (dates chronological, undated last)', () => {
    expect(groupSales(rows, 'location').map((g) => g.label)).toEqual(['Main', 'Stage', 'No location']);
    expect(groupSales(rows, 'date').map((g) => g.label)).toEqual(['2027-06-05', '2027-06-06', 'No date']);
  });

  it('filters by location and date range, counting undated rows dropped', () => {
    const { rows: out, undated } = filterSales(rows, { from: '2027-06-06', to: '2027-06-06' });
    expect(out.map((r) => r.name)).toEqual(['Hells', 'Water']);
    expect(undated).toBe(1);
    expect(filterSales(rows, { location: 'Main' }).rows).toHaveLength(2);
  });

  it('groups across events by start date', () => {
    const flat = rowsWithEvents([
      { event_id: 'b', event: { name: 'Later', start_date: '2027-08-01' }, rows: [{ items_sold: 1, net_sales: 10, gross_sales: 12 }] },
      { event_id: 'a', event: { name: 'Earlier', start_date: '2027-06-01' }, rows: [{ items_sold: 2, net_sales: 5, gross_sales: 6 }] },
    ]);
    expect(groupSales(flat, 'event').map((g) => g.label)).toEqual(['Earlier', 'Later']);
  });

  it('exports CSV', () => {
    const csv = salesCsv(groupSales(rows, 'item'), 'item');
    expect(csv).toContain('Product,Category,Items sold');
    expect(csv).toContain('Hells · Pint,Draught,150,750.00,900.00,83.3');
  });
});

describe('revenue & GP', () => {
  const lines = [
    { productId: 'p1', name: 'Hells', category: 'Draught', included: true, menuPrice: 6, costPerServe: 1, projectedServes: 200, vatRate: 0.2, servesPerUnit: 88, revenueNet: 1000, gpPct: 80 },
    { productId: 'p2', name: 'Water', category: 'Soft', included: true, menuPrice: 3, costPerServe: 0.5, projectedServes: 50, vatRate: 0.2, servesPerUnit: 1, revenueNet: 125, gpPct: 80 },
  ];
  const products = new Map([
    ['p1', { id: 'p1', name: 'Hells', units_per_case: 1 }],
    ['p2', { id: 'p2', name: 'Water', units_per_case: 24 }],
  ]);
  const reconRows = [
    { pid: 'p1', p: products.get('p1'), consumption: 2, plu: 1.8, rowPrice: 100, consumptionCharge: 200 },
    { pid: 'p2', p: products.get('p2'), consumption: 2, plu: 2, rowPrice: 12, consumptionCharge: 24 },
    { pid: 'p3', p: { name: 'Off menu', category: { name: 'Wine' } }, consumption: 1, plu: 0, rowPrice: 0, consumptionCharge: 0 },
  ];

  it('sums consumption cost and counts unpriced products', () => {
    expect(reconCostTotals(reconRows)).toEqual({ cost: 224, priced: 2, unpriced: 1 });
  });

  it('compares forecast mix with actual till and recon', () => {
    const c = revenueComparison({ lines, products, reconRows, tillRows: rows, targetGpPct: 70 });
    expect(c.forecast).toMatchObject({ revenueNet: 1125, cost: 225, gpAmount: 900, gpPct: 80 });
    expect(c.actual).toMatchObject({ revenueNet: 900, cost: 224, gpAmount: 676, unpricedProducts: 1 });
    expect(c.actual.gpPct).toBeCloseTo(75.11, 2);
    expect(c.variance.revenueNet).toBe(-225);
    expect(c.variance.revenuePct).toBeCloseTo(-20, 5);
    expect(c.targetGpPct).toBe(70);
  });

  it('builds per-product forecast vs actual, including off-menu consumption', () => {
    const c = revenueComparison({ lines, products, reconRows, tillRows: rows });
    const hells = c.products.find((p) => p.productId === 'p1');
    expect(hells).toMatchObject({ forecastUnits: 3, consumed: 2, unitsVariance: -1, forecastCost: 200, actualCost: 200, costVariance: 0 });
    const water = c.products.find((p) => p.productId === 'p2');
    expect(water.forecastUnits).toBe(50);
    const off = c.products.find((p) => p.productId === 'p3');
    expect(off).toMatchObject({ onMenu: false, actualCost: null, forecastUnits: null });
  });

  it('reports nothing actual when there are no sales', () => {
    const c = revenueComparison({ lines, products, reconRows: [], tillRows: [] });
    expect(c.actual).toMatchObject({ revenueNet: null, gpAmount: null, gpPct: null });
    expect(c.variance.revenueNet).toBeNull();
  });

  it('headlines pick top items, best day and top category', () => {
    const c = revenueComparison({ lines, products, reconRows, tillRows: rows, targetGpPct: 70 });
    const h = eventHeadlines({ tillRows: rows, comparison: c, topN: 2 });
    expect(h.top.map((t) => t.label)).toEqual(['Hells · Pint', 'Water']);
    expect(h.bestDay.label).toBe('2027-06-05');
    expect(h.topCategory.label).toBe('Draught');
    expect(h.targetGpPct).toBe(70);
    expect(h.revenueVsForecastPct).toBeCloseTo(-20, 5);
  });
});
