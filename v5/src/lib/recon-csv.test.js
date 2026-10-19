import { describe, expect, it } from 'vitest';
import { reconCsv } from './recon-csv.js';

describe('reconCsv', () => {
  it('matches the recon page columns and totals the budget', () => {
    const csv = reconCsv([
      {
        reconStatus: 'green',
        p: { name: 'Lager, pint', case_size: '50L', abv: 4.5 },
        rowPrice: 12.5,
        supplierName: 'Brew Co',
        ups: 1,
        delivered: 10,
        invoiced: 10,
        closingCases: 2,
        closingSingles: 0,
        supplierReturns: 0,
        transferred: 1,
        wastage: 0,
        consumption: 7,
        plu: 7,
        variance: 0,
        variancePct: 0,
        consumptionCharge: 87.5,
        consumptionLooseCharge: 0,
        pluCharge: 87.5,
        invoiceCharge: 125,
        budgetCost: 80,
        reconNote: 'ok',
      },
      {
        reconStatus: null,
        p: { name: 'Cola' },
        budgetCost: 20,
      },
    ]);

    expect(csv.split('\r\n')[0]).toBe(
      'Status,Item,Case Size,ABV,Price,Supplier,Units per case,Delivered,Invoiced,Closing (Cases),Closing (Singles),Returned to supplier,Transferred,Wastage,Consumption,PLU,Variance,Variance %,Consumption Charge,Loose Charge,PLU Charge,Invoice Charge,Budget Cost,Notes',
    );
    expect(csv).toContain('"Lager, pint"');
    expect(csv).toContain('Done');
    expect(csv).toContain('4.50%');
    expect(csv.endsWith('100.00')).toBe(true);
  });
});
