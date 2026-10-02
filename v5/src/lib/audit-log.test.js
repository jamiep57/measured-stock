import { describe, it, expect } from 'vitest';
import { describeAuditRow } from './audit-log.js';

describe('describeAuditRow', () => {
  it('summarises updates with before → after values and skips housekeeping columns', () => {
    const d = describeAuditRow({
      table_name: 'products',
      op: 'UPDATE',
      old_data: { name: 'Utopian', case_price: 30, updated_at: 'a' },
      new_data: { name: 'Utopian', case_price: 32, updated_at: 'b' },
      changed_cols: ['case_price', 'updated_at'],
    });
    expect(d.record).toBe('Product: Utopian');
    expect(d.summary).toBe('case_price: 30 → 32');
  });

  it('labels inserts, deletes and app events', () => {
    expect(describeAuditRow({ table_name: 'deliveries', op: 'INSERT', new_data: { reference: 'DN1' } }))
      .toEqual({ record: 'Delivery: DN1', summary: 'Created' });
    expect(describeAuditRow({ table_name: 'bars', op: 'DELETE', old_data: { name: 'Main' } }).summary).toBe('Deleted');
    expect(describeAuditRow({ table_name: 'export', op: 'EVENT', new_data: { kind: 'sor' } }).summary).toContain('sor');
  });
});
