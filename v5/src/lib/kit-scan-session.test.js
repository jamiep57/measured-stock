import { describe, it, expect } from 'vitest';
import {
  normalizeBarcode,
  normalizeScanMode,
  findProductByBarcode,
  planPackScan,
  bumpCheckInPending,
  pendingCheckInGroups,
  pendingCheckInTotal,
  scanPageUrl,
  qrImageUrl,
  isSessionExpired,
  isLoopbackHost,
  originWithHost,
  scanCodeCandidates,
  SCAN_MODE_PACK,
  SCAN_MODE_CHECK_IN,
} from './kit-scan-session.js';

describe('kit-scan-session', () => {
  it('normalizes barcodes and modes', () => {
    expect(normalizeBarcode('  ABC123  ')).toBe('ABC123');
    expect(normalizeScanMode('check_in')).toBe(SCAN_MODE_CHECK_IN);
    expect(normalizeScanMode('pack')).toBe(SCAN_MODE_PACK);
    expect(normalizeScanMode('nope')).toBe(SCAN_MODE_PACK);
  });

  it('extracts Current RMS stock_levels ids from URLs', () => {
    expect(scanCodeCandidates('http://measured.current-rms.com/stock_levels/755'))
      .toEqual(expect.arrayContaining([
        'http://measured.current-rms.com/stock_levels/755',
        '755',
      ]));
    expect(scanCodeCandidates('https://measured.current-rms.com/products/453'))
      .toEqual(expect.arrayContaining(['453']));
    // Plain barcodes stay as-is (no false id extract)
    expect(scanCodeCandidates('100010001')).toEqual(['100010001']);
    expect(scanCodeCandidates('LeverScrew')).toEqual(['LeverScrew']);
  });

  it('finds products by exact barcode (case-insensitive)', () => {
    const products = [
      { id: '1', barcode: 'ABC' },
      { id: '2', barcode: 'xyz-9' },
      { id: '3', barcode: null },
    ];
    expect(findProductByBarcode(products, 'abc')?.id).toBe('1');
    expect(findProductByBarcode(products, ' XYZ-9 ')?.id).toBe('2');
    expect(findProductByBarcode(products, 'missing')).toBeNull();
    expect(findProductByBarcode(products, '')).toBeNull();
  });

  it('finds products by Current RMS URL → sku', () => {
    const products = [
      { id: 'p453', sku: '453', barcode: 'LeverScrew', name: 'Lever Corkscrew' },
      { id: 'p108', sku: '108', barcode: 'Draught Kit' },
    ];
    expect(findProductByBarcode(
      products,
      'http://measured.current-rms.com/stock_levels/453',
    )?.id).toBe('p453');
    expect(findProductByBarcode(
      products,
      'http://measured.current-rms.com/stock_levels/108',
    )?.id).toBe('p108');
    expect(findProductByBarcode(
      products,
      'http://measured.current-rms.com/stock_levels/999',
    )).toBeNull();
  });

  it('finds products when stored barcode is a Current RMS URL', () => {
    const products = [
      {
        id: 'p1',
        sku: '99',
        barcode: 'http://measured.current-rms.com/stock_levels/755',
      },
    ];
    expect(findProductByBarcode(
      products,
      'http://measured.current-rms.com/stock_levels/755',
    )?.id).toBe('p1');
    expect(findProductByBarcode(products, '755')?.id).toBe('p1');
  });

  it('plans pack scan as bump when line exists', () => {
    const plan = planPackScan({
      items: [{ id: 'line1', product_id: 'p1', qty_packed: 2 }],
      product: { id: 'p1', name: 'Table' },
    });
    expect(plan).toEqual({
      action: 'bump',
      productId: 'p1',
      itemId: 'line1',
      nextPacked: 3,
      name: 'Table',
    });
  });

  it('plans pack scan as add when line missing', () => {
    const plan = planPackScan({
      items: [],
      product: { id: 'p2', name: 'Chair' },
    });
    expect(plan).toEqual({
      action: 'add',
      productId: 'p2',
      nextPlanned: 1,
      nextPacked: 1,
      name: 'Chair',
    });
  });

  it('returns unknown when product missing', () => {
    expect(planPackScan({ items: [], product: null }).action).toBe('unknown');
  });

  it('bumps check-in pending and totals', () => {
    let pending = bumpCheckInPending(null, 'a', 1);
    pending = bumpCheckInPending(pending, 'a', 2);
    pending = bumpCheckInPending(pending, 'b', 1);
    expect(pending.get('a')).toBe(3);
    expect(pending.get('b')).toBe(1);
    expect(pendingCheckInTotal(pending)).toBe(4);
  });

  it('groups check-in pending by own vs hire source', () => {
    const pending = new Map([['own1', 2], ['hire1', 1], ['ghost', 5]]);
    const groups = pendingCheckInGroups(pending, [
      { product_id: 'own1', source: 'own', product: { name: 'Own kit' } },
      { product_id: 'hire1', source: 'hire', product: { name: 'Hire kit' } },
    ]);
    expect(groups.warehouseOut).toEqual([{ product_id: 'own1', qty: 2, name: 'Own kit' }]);
    expect(groups.hireReturn).toEqual([{ product_id: 'hire1', qty: 1, name: 'Hire kit' }]);
    expect(groups.missing).toEqual(['ghost']);
  });

  it('builds scan page and QR urls', () => {
    expect(scanPageUrl('sess-1', 'https://example.com')).toBe('https://example.com/scan/?s=sess-1');
    expect(qrImageUrl('https://example.com/scan/?s=x', 120)).toContain('size=120x120');
    expect(qrImageUrl('https://example.com/scan/?s=x', 120)).toContain(encodeURIComponent('https://example.com/scan/?s=x'));
  });

  it('rewrites localhost origins to LAN hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('192.168.1.54')).toBe(false);
    expect(originWithHost('http://localhost:5173', '192.168.1.54'))
      .toBe('http://192.168.1.54:5173');
    expect(originWithHost('http://localhost:5173', '192.168.1.54:5174'))
      .toBe('http://192.168.1.54:5174');
  });

  it('detects expired sessions', () => {
    expect(isSessionExpired({ expires_at: '2000-01-01T00:00:00.000Z' }, Date.parse('2020-01-01'))).toBe(true);
    expect(isSessionExpired({ expires_at: '2099-01-01T00:00:00.000Z' }, Date.parse('2020-01-01'))).toBe(false);
    expect(isSessionExpired(null)).toBe(true);
  });
});
