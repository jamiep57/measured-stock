import { describe, it, expect } from 'vitest';
import {
  countMappedRows,
  computeDashboardInsights,
  buildQuickActions,
} from './dashboard-insights.js';

const recipes = [
  {
    till_item: 'G&T',
    till_variation: 'Regular',
    ingredients: [{ product_name: 'Gin', qty: 0.05, position: 0 }],
  },
  {
    till_item: 'Oat milk',
    till_variation: 'Milk',
    ingredients: [{ product_name: 'Oat', qty: 1, position: 0 }],
  },
];

describe('countMappedRows', () => {
  it('counts rows with mapped recipes', () => {
    const rows = [
      { name: 'G&T', variation: 'Regular' },
      { name: 'Cola', variation: 'Regular' },
    ];
    expect(countMappedRows(rows, 'name', 'variation', recipes)).toBe(1);
  });
});

describe('computeDashboardInsights', () => {
  it('aggregates mapping, sales, and stock outlook', () => {
    const ctx = {
      tillRows: [{ name: 'G&T', variation: 'Regular' }, { name: 'Cola', variation: 'Regular' }],
      modRows: [{ modifier: 'Oat milk', modifier_set: 'Milk' }],
      recipes,
      projection: {
        baselineNet: 10000,
        mappedNet: 8000,
        target: 100000,
        items: [
          { inEvent: true, name: 'Gin', runOutRevenue: 20000 },
          { inEvent: true, name: 'Tonic', runOutRevenue: 90000 },
          { inEvent: false, name: 'Other', runOutRevenue: null },
        ],
      },
    };

    const insights = computeDashboardInsights(ctx);
    expect(insights.till).toEqual({ mapped: 1, total: 2, pct: 50 });
    expect(insights.mod).toEqual({ mapped: 1, total: 1, pct: 100 });
    expect(insights.sales.mappedPct).toBe(80);
    expect(insights.stockOutlook.lasts).toBeGreaterThanOrEqual(0);
    expect(insights.atRisk.length).toBeGreaterThan(0);
    expect(insights.atRisk[0].name).toBe('Gin');
  });
});

describe('buildQuickActions', () => {
  it('prioritises import when no sales', () => {
    const actions = buildQuickActions({
      eventId: 'ev1',
      tillRows: [],
      modRows: [],
      event: {},
      recipes: [],
      projection: { baselineNet: 0, mappedNet: 0, items: [] },
    });
    expect(actions[0].label).toBe('Import item sales');
    expect(actions[0].primary).toBe(true);
    expect(actions[0].href).toContain('/events/ev1/sales');
  });

  it('suggests mapping when sales exist but unmapped', () => {
    const actions = buildQuickActions({
      eventId: 'ev1',
      tillRows: [{ name: 'Cola', variation: 'Regular' }],
      modRows: [],
      event: { target_revenue: 50000 },
      recipes: [],
      projection: { baselineNet: 1000, mappedNet: 0, items: [] },
    });
    expect(actions.some((a) => a.label === 'Import sales')).toBe(true);
  });

  it('suggests target when missing', () => {
    const actions = buildQuickActions({
      eventId: 'ev1',
      tillRows: [{ name: 'G&T', variation: 'Regular' }],
      modRows: [],
      event: {},
      recipes,
      projection: { baselineNet: 1000, mappedNet: 1000, items: [] },
    });
    expect(actions.some((a) => a.label === 'Set target revenue')).toBe(true);
  });
});
