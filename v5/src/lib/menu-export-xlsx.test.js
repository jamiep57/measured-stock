import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildMenuExport } from './menu-exports.js';
import { buildMenuExportXlsx } from './menu-export-xlsx.js';

const lines = [
  { productId: 'p1', name: 'Hells', menuName: 'Hells <Lager> & co', category: 'Draught', included: true, serveLabel: 'Pint', menuPrice: 6.5, costPerServe: 1.23, gpPct: 77.8 },
];

function sheetXml(bytes) {
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
  return strFromU8(files['xl/worksheets/sheet1.xml']);
}

describe('menu export xlsx', () => {
  it('writes escaped text, numeric prices and category bands', () => {
    const model = buildMenuExport('sor', { lines });
    const xml = sheetXml(buildMenuExportXlsx({ model, title: 'Schedule of rates', meta: ['Client & Co'] }));
    expect(xml).toContain('Hells &lt;Lager&gt; &amp; co');
    expect(xml).toContain('Client &amp; Co');
    expect(xml).toContain('<v>6.5</v>');
    expect(xml).toContain('DRAUGHT');
  });
  it('contains no cost or GP for client-facing exports', () => {
    const model = buildMenuExport('client', { lines, includeInternal: false });
    const xml = sheetXml(buildMenuExportXlsx({ model, title: 'Client' }));
    expect(xml).not.toContain('1.23');
    expect(xml).not.toContain('77.8');
    expect(xml).not.toMatch(/GP %|COST/);
  });
});
