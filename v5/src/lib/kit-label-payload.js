/**
 * Shared kit label barcode / QR payload resolution (no printer deps).
 */

const RMS_STOCK_LEVEL_PREFIX = 'http://measured.current-rms.com/stock_levels/';

/**
 * Decide what QR / barcode string to encode (and optionally persist).
 *
 * @param {{ barcode?: string|null, sku?: string|null, id?: string|null }} product
 * @returns {{ barcode: string, shouldPersist: boolean }}
 */
export function resolveKitLabelPayload(product) {
  const existing = String(product?.barcode ?? '').trim();
  if (existing) {
    return { barcode: existing, shouldPersist: false };
  }

  const sku = String(product?.sku ?? '').trim();
  if (/^\d+$/.test(sku)) {
    return {
      barcode: `${RMS_STOCK_LEVEL_PREFIX}${sku}`,
      shouldPersist: true,
    };
  }

  const id = String(product?.id ?? '').trim();
  if (!id) {
    throw new Error('Cannot print a label without a saved kit item.');
  }
  return { barcode: id, shouldPersist: true };
}
