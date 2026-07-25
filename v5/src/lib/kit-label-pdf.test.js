import { describe, it, expect } from 'vitest';
import {
  resolveKitLabelPayload,
  buildKitLabelHtml,
  KIT_LABEL_WIDTH_MM,
  KIT_LABEL_HEIGHT_MM,
} from './kit-label-pdf.js';
import {
  mmToPx,
  QL_DPI,
  QL_MEDIA_62_CONTINUOUS,
  webUsbSupported,
} from './ql800-webusb.js';

describe('kit-label-pdf', () => {
  it('uses landscape QL-800 62mm continuous dimensions', () => {
    expect(KIT_LABEL_WIDTH_MM).toBe(100);
    expect(KIT_LABEL_HEIGHT_MM).toBe(62);
  });

  it('keeps an existing barcode', () => {
    expect(resolveKitLabelPayload({
      id: 'abc',
      sku: '123',
      barcode: 'http://measured.current-rms.com/stock_levels/99',
    })).toEqual({
      barcode: 'http://measured.current-rms.com/stock_levels/99',
      shouldPersist: false,
    });
  });

  it('builds Current RMS URL from numeric sku when barcode missing', () => {
    expect(resolveKitLabelPayload({ id: 'abc', sku: '453', barcode: null })).toEqual({
      barcode: 'http://measured.current-rms.com/stock_levels/453',
      shouldPersist: true,
    });
  });

  it('falls back to product id when no barcode or numeric sku', () => {
    expect(resolveKitLabelPayload({ id: 'uuid-1', sku: 'TABLE', barcode: '' })).toEqual({
      barcode: 'uuid-1',
      shouldPersist: true,
    });
  });

  it('requires a product id when nothing else is available', () => {
    expect(() => resolveKitLabelPayload({ sku: 'x', barcode: null })).toThrow(/saved kit item/i);
  });

  it('builds preview HTML with page size and QR', () => {
    const html = buildKitLabelHtml({
      name: 'Lever Corkscrew',
      barcode: 'http://measured.current-rms.com/stock_levels/453',
      isContainer: false,
      copies: 1,
      qrDataUrl: 'data:image/png;base64,abc',
    });
    expect(html).toContain('size: 100mm 62mm');
    expect(html).toContain('Lever Corkscrew');
    expect(html).toContain('data:image/png;base64,abc');
    expect(html).toContain('Measured · Kit');
  });
});

describe('ql800-webusb', () => {
  it('maps mm to 300dpi pixels', () => {
    expect(QL_DPI).toBe(300);
    expect(mmToPx(25.4)).toBe(300);
    expect(mmToPx(KIT_LABEL_HEIGHT_MM)).toBe(Math.round((62 * 300) / 25.4));
  });

  it('targets 62mm continuous media', () => {
    expect(QL_MEDIA_62_CONTINUOUS).toBe(259);
  });

  it('reports WebUSB support from the environment', () => {
    expect(typeof webUsbSupported()).toBe('boolean');
  });
});
