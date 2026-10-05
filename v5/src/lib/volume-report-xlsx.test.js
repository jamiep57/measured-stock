import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildVolumeReportXlsx } from './volume-report-xlsx.js';

describe('buildVolumeReportXlsx', () => {
  it('groups products by category and includes category and grand totals', () => {
    const workbook = buildVolumeReportXlsx([
      {
        p: { name: 'Cola & Lime', case_size: '24 × 330ml', category: { name: 'Soft Drinks' } },
        plu: 10,
        consumption: 12,
      },
      {
        p: { name: 'Lager', case_size: '50L', category: { name: 'Beer' } },
        plu: 20,
        consumption: 21.5,
      },
    ], 'Summer Event');

    const files = unzipSync(workbook);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);

    expect(sheet).toContain('Summer Event — Volume Report');
    expect(sheet).toContain('Beer (1)');
    expect(sheet).toContain('Soft Drinks (1)');
    expect(sheet).toContain('Soft Drinks total');
    expect(sheet).toContain('GRAND TOTAL');
    expect(sheet).toContain('Cola &amp; Lime');
    expect(sheet.indexOf('Beer (1)')).toBeLessThan(sheet.indexOf('Soft Drinks (1)'));
    expect(sheet).toContain('<v>31.5</v>');
  });
});
