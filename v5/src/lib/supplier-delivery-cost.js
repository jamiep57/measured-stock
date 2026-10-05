/**
 * Supplier delivery cost report — price each delivery line from the delivery's
 * supplier offer (or event override), then roll up totals.
 */

import { findOfferForSupplier, productStockPack } from '../pack-metrics.js';
import { storedToForm, totalUnitsForProduct } from '../stock-entry.js';
import { productStockUnit } from './recipe-stock.js';

export function eventProductFor(event, productId) {
  return (event?.event_products || []).find((ep) => ep.product_id === productId) || null;
}

export function usesBottlePrice(product, caseSizes = []) {
  return productStockUnit(product, caseSizes) === 'bottle';
}

function unitsPerCase(product, caseSizes = []) {
  const pack = productStockPack(product, caseSizes);
  if (pack.unitsPerCase > 0) return pack.unitsPerCase;
  const upc = Number(product?.units_per_case) || 0;
  return upc > 0 ? upc : 1;
}

/**
 * Case price for a delivery line: event override → offer for delivery supplier → product.
 * @returns {number|null}
 */
export function deliveryCasePrice(ep, product, supplierId) {
  if (ep?.order_price_override != null) return Number(ep.order_price_override) || 0;
  const offer = findOfferForSupplier(product, supplierId);
  if (offer?.case_price != null) return Number(offer.case_price) || 0;
  if (product?.case_price != null) return Number(product.case_price) || 0;
  return null;
}

/**
 * Unit/bottle price for a delivery line.
 * @returns {number|null}
 */
export function deliveryUnitPrice(ep, product, supplierId, caseSizes = []) {
  if (ep?.order_unit_price_override != null) return Number(ep.order_unit_price_override) || 0;
  if (ep?.order_price_override != null) {
    const upc = unitsPerCase(product, caseSizes);
    return upc > 0 ? (Number(ep.order_price_override) || 0) / upc : null;
  }
  const offer = findOfferForSupplier(product, supplierId);
  if (offer?.unit_price != null) return Number(offer.unit_price) || 0;
  if (offer?.case_price != null) {
    const upc = unitsPerCase(product, caseSizes);
    return upc > 0 ? Number(offer.case_price) / upc : null;
  }
  if (product?.unit_price != null) return Number(product.unit_price) || 0;
  if (product?.case_price != null) {
    const upc = unitsPerCase(product, caseSizes);
    return upc > 0 ? Number(product.case_price) / upc : null;
  }
  return null;
}

export function lineQtyCases(line, product, caseSizes = []) {
  const form = storedToForm(line);
  return totalUnitsForProduct(form.cases, form.singles, product, caseSizes);
}

export function lineInvoiceQtyCases(line, product, caseSizes = []) {
  if (line?.invoice_qty == null && !(Number(line?.invoice_singles) > 0)) return null;
  const form = storedToForm({ qty: line.invoice_qty, singles: line.invoice_singles });
  return totalUnitsForProduct(form.cases, form.singles, product, caseSizes);
}

/**
 * Cost one delivery line.
 * @param {'received'|'invoiced'} qtyMode
 */
export function costDeliveryLine({
  line,
  supplierId,
  event,
  caseSizes = [],
  qtyMode = 'received',
}) {
  const ep = eventProductFor(event, line?.product_id);
  const product = ep?.product || null;
  const name = product?.name || 'Unknown product';

  let qty;
  if (qtyMode === 'invoiced') {
    qty = lineInvoiceQtyCases(line, product, caseSizes);
    if (qty == null) qty = lineQtyCases(line, product, caseSizes);
  } else {
    qty = lineQtyCases(line, product, caseSizes);
  }

  const bottle = usesBottlePrice(product, caseSizes);
  const unitPrice = bottle
    ? deliveryUnitPrice(ep, product, supplierId, caseSizes)
    : deliveryCasePrice(ep, product, supplierId);
  const missingPrice = unitPrice == null || !Number.isFinite(unitPrice);
  const cost = missingPrice ? 0 : qty * unitPrice;

  return {
    productId: line?.product_id || null,
    productName: name,
    qty: Number.isFinite(qty) ? qty : 0,
    unitPrice: missingPrice ? null : unitPrice,
    cost,
    missingPrice,
    priceBasis: bottle ? 'unit' : 'case',
    supplierId: supplierId || null,
  };
}

function supplierLabel(delivery, suppliers) {
  if (delivery?.supplier?.name) return delivery.supplier.name;
  const sid = delivery?.supplier_id;
  if (!sid) return 'No supplier';
  const hit = (suppliers || []).find((s) => s.id === sid);
  return hit?.name || 'Unknown supplier';
}

function inDateRange(iso, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`).getTime();
    if (t < from) return false;
  }
  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999`).getTime();
    if (t > to) return false;
  }
  return true;
}

/**
 * Build a full supplier delivery cost report.
 * @param {{
 *   deliveries: object[],
 *   event: object,
 *   caseSizes?: object[],
 *   suppliers?: object[],
 *   supplierId?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 *   qtyMode?: 'received'|'invoiced',
 * }} opts
 */
export function buildSupplierDeliveryCostReport({
  deliveries = [],
  event,
  caseSizes = [],
  suppliers = [],
  supplierId = '',
  dateFrom = '',
  dateTo = '',
  qtyMode = 'received',
} = {}) {
  const filtered = (deliveries || []).filter((d) => {
    if (supplierId && d.supplier_id !== supplierId) return false;
    if (!inDateRange(d.delivered_at || d.created_at, dateFrom, dateTo)) return false;
    return true;
  });

  const deliveryRows = [];
  const bySupplier = new Map();
  let totalCost = 0;
  let totalQty = 0;
  let lineCount = 0;
  let missingPriceCount = 0;

  for (const d of filtered) {
    const sid = d.supplier_id || null;
    const sName = supplierLabel(d, suppliers);
    const lineCosts = (d.lines || []).map((line) => costDeliveryLine({
      line,
      supplierId: sid,
      event,
      caseSizes,
      qtyMode,
    }));
    const cost = lineCosts.reduce((s, l) => s + l.cost, 0);
    const qty = lineCosts.reduce((s, l) => s + l.qty, 0);
    const missing = lineCosts.filter((l) => l.missingPrice).length;

    totalCost += cost;
    totalQty += qty;
    lineCount += lineCosts.length;
    missingPriceCount += missing;

    const row = {
      deliveryId: d.id,
      deliveredAt: d.delivered_at || d.created_at || null,
      reference: d.reference || '',
      supplierId: sid,
      supplierName: sName,
      lineCount: lineCosts.length,
      qty,
      cost,
      missingPriceCount: missing,
      lines: lineCosts,
    };
    deliveryRows.push(row);

    const key = sid || '__none__';
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplierId: sid,
        supplierName: sName,
        deliveryCount: 0,
        lineCount: 0,
        qty: 0,
        cost: 0,
        missingPriceCount: 0,
      });
    }
    const agg = bySupplier.get(key);
    agg.deliveryCount += 1;
    agg.lineCount += lineCosts.length;
    agg.qty += qty;
    agg.cost += cost;
    agg.missingPriceCount += missing;
  }

  const supplierRows = [...bySupplier.values()].sort((a, b) => b.cost - a.cost
    || a.supplierName.localeCompare(b.supplierName));

  deliveryRows.sort((a, b) => {
    const ta = a.deliveredAt ? new Date(a.deliveredAt).getTime() : 0;
    const tb = b.deliveredAt ? new Date(b.deliveredAt).getTime() : 0;
    return tb - ta;
  });

  return {
    qtyMode,
    deliveryCount: deliveryRows.length,
    lineCount,
    totalQty,
    totalCost,
    missingPriceCount,
    supplierCount: supplierRows.length,
    supplierRows,
    deliveryRows,
  };
}

export function supplierDeliveryCostCsv(report, eventName = 'event') {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = [
    'Date', 'Supplier', 'Reference', 'Product', 'Qty', 'Unit price', 'Cost', 'Price basis', 'Missing price',
  ];
  const lines = [headers.map(esc).join(',')];
  for (const d of report.deliveryRows || []) {
    const date = d.deliveredAt
      ? new Date(d.deliveredAt).toISOString().slice(0, 10)
      : '';
    for (const l of d.lines || []) {
      lines.push([
        date,
        d.supplierName,
        d.reference,
        l.productName,
        l.qty,
        l.unitPrice != null ? l.unitPrice.toFixed(2) : '',
        l.cost.toFixed(2),
        l.priceBasis,
        l.missingPrice ? 'yes' : '',
      ].map(esc).join(','));
    }
  }
  lines.push([
    '', '', '', 'TOTAL', '', '', (report.totalCost || 0).toFixed(2), '', '',
  ].map(esc).join(','));

  const safeName = String(eventName || 'event').replace(/[^\w\s.-]/g, '').trim() || 'event';
  return {
    filename: `${safeName} Supplier delivery cost.csv`,
    content: lines.join('\r\n'),
  };
}
