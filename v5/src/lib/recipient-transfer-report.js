/**
 * Internal transfers by recipient (client) — e.g. Artist Liaison got Lager ×5, Gin ×2.
 * Costs use event override → preferred supplier offer → product price (same basis as recon).
 */

import { productStockPack } from '../pack-metrics.js';
import { storedToForm, totalUnitsForProduct, parseQty } from '../stock-entry.js';
import {
  eventProductFor,
  usesBottlePrice,
  deliveryCasePrice,
  deliveryUnitPrice,
} from './supplier-delivery-cost.js';
import { preferredSupplierId } from './recon.js';

/**
 * Unit/case price for a transferred product (event cost basis).
 * @returns {{ unitPrice: number|null, missingPrice: boolean, priceBasis: 'unit'|'case', supplierId: string|null }}
 */
export function transferProductPrice(ep, product, caseSizes = []) {
  const bottle = usesBottlePrice(product, caseSizes);
  const supplierId = preferredSupplierId(product);
  const unitPrice = bottle
    ? deliveryUnitPrice(ep, product, supplierId, caseSizes)
    : deliveryCasePrice(ep, product, supplierId);
  const missingPrice = unitPrice == null || !Number.isFinite(unitPrice);
  return {
    unitPrice: missingPrice ? null : unitPrice,
    missingPrice,
    priceBasis: bottle ? 'unit' : 'case',
    supplierId: supplierId || null,
  };
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

export function recipientName(transfer, event) {
  if (transfer?.recipients?.name) return transfer.recipients.name;
  const sid = transfer?.recipient_id;
  if (!sid) return 'Unknown client';
  const hit = (event?.recipients || []).find((r) => r.id === sid);
  return hit?.name || 'Unknown client';
}

export function formatTransferQtyLabel(qty, product, caseSizes = []) {
  const n = Math.round((Number(qty) || 0) * 100) / 100;
  const pack = productStockPack(product, caseSizes);
  const unit = pack.stockUnit || 'case';
  const labels = {
    bottle: n === 1 ? 'bottle' : 'bottles',
    keg: n === 1 ? 'keg' : 'kegs',
    unit: n === 1 ? 'unit' : 'units',
    single: n === 1 ? 'single' : 'singles',
    case: n === 1 ? 'case' : 'cases',
  };
  const label = labels[unit] || labels.case;
  const qtyStr = Number.isInteger(n) ? String(n) : String(n);
  return `${qtyStr} ${label}`;
}

/** Collapse same-named catalog rows (and null ids) into one aggregate line. */
function productAggregateKey(row) {
  const name = String(row?.productName || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  if (row?.productId) return `id:${row.productId}`;
  return 'unknown';
}

/**
 * Aggregate product qty + cost for one transfer line.
 */
export function transferProductQty(line, event, caseSizes = []) {
  const ep = eventProductFor(event, line?.product_id);
  const product = ep?.product || line?.product || null;
  const form = storedToForm(line);
  const qty = totalUnitsForProduct(form.cases, form.singles, product, caseSizes);
  const priced = transferProductPrice(ep, product, caseSizes);
  const safeQty = Number.isFinite(qty) ? qty : 0;
  const cost = priced.missingPrice ? 0 : safeQty * priced.unitPrice;
  return {
    productId: line?.product_id || null,
    productName: product?.name || line?.product?.name || 'Unknown product',
    qty: safeQty,
    cases: parseQty(form.cases),
    singles: parseQty(form.singles),
    product,
    unitPrice: priced.unitPrice,
    cost,
    missingPrice: priced.missingPrice,
    priceBasis: priced.priceBasis,
  };
}

/**
 * Build report of transfers sent to internal recipients (clients).
 * @param {{
 *   transfers: object[],
 *   event: object,
 *   caseSizes?: object[],
 *   recipientId?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 * }} opts
 */
export function buildRecipientTransferReport({
  transfers = [],
  event,
  caseSizes = [],
  recipientId = '',
  dateFrom = '',
  dateTo = '',
} = {}) {
  const eventId = event?.id;
  const filtered = (transfers || []).filter((t) => {
    if (!t.recipient_id) return false;
    if (eventId && t.from_event_id !== eventId && t.to_event_id !== eventId) {
      // still allow if recipient belongs to this event
      const recip = (event?.recipients || []).find((r) => r.id === t.recipient_id);
      if (!recip) return false;
    }
    if (recipientId && t.recipient_id !== recipientId) return false;
    if (!inDateRange(t.transferred_at || t.created_at, dateFrom, dateTo)) return false;
    return true;
  });

  const byRecipient = new Map();
  let transferCount = 0;
  let lineCount = 0;
  let totalQty = 0;
  let totalCost = 0;
  let missingPriceCount = 0;

  for (const t of filtered) {
    const rid = t.recipient_id;
    const name = recipientName(t, event);
    if (!byRecipient.has(rid)) {
      byRecipient.set(rid, {
        recipientId: rid,
        recipientName: name,
        transferCount: 0,
        lineCount: 0,
        totalQty: 0,
        totalCost: 0,
        missingPriceCount: 0,
        products: new Map(),
        transfers: [],
      });
    }
    const agg = byRecipient.get(rid);
    agg.transferCount += 1;
    transferCount += 1;

    const when = t.transferred_at || t.created_at || null;
    const transferLines = [];

    for (const line of t.lines || []) {
      const row = transferProductQty(line, event, caseSizes);
      lineCount += 1;
      agg.lineCount += 1;
      agg.totalQty += row.qty;
      agg.totalCost += row.cost;
      totalQty += row.qty;
      totalCost += row.cost;
      if (row.missingPrice) {
        missingPriceCount += 1;
        agg.missingPriceCount += 1;
      }
      transferLines.push(row);

      const key = productAggregateKey(row);
      if (!agg.products.has(key)) {
        agg.products.set(key, {
          productId: row.productId,
          productName: row.productName,
          qty: 0,
          cases: 0,
          singles: 0,
          cost: 0,
          missingPrice: false,
          unitPrice: row.unitPrice,
          priceBasis: row.priceBasis,
          product: row.product,
        });
      }
      const p = agg.products.get(key);
      p.qty += row.qty;
      p.cases += row.cases;
      p.singles += row.singles;
      p.cost += row.cost;
      if (row.missingPrice) p.missingPrice = true;
      else if (p.unitPrice == null && row.unitPrice != null) p.unitPrice = row.unitPrice;
    }

    agg.transfers.push({
      transferId: t.id,
      transferredAt: when,
      notes: t.notes || '',
      lines: transferLines,
      totalQty: transferLines.reduce((s, l) => s + l.qty, 0),
      totalCost: transferLines.reduce((s, l) => s + l.cost, 0),
    });
  }

  const recipientRows = [...byRecipient.values()].map((agg) => {
    const products = [...agg.products.values()]
      .map((p) => ({
        ...p,
        qtyLabel: formatTransferQtyLabel(p.qty, p.product, caseSizes),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));

    const summary = products.map((p) => `${p.productName} (${p.qtyLabel})`).join(', ');

    return {
      recipientId: agg.recipientId,
      recipientName: agg.recipientName,
      transferCount: agg.transferCount,
      lineCount: agg.lineCount,
      totalQty: agg.totalQty,
      totalCost: agg.totalCost,
      missingPriceCount: agg.missingPriceCount,
      products,
      summary,
      transfers: agg.transfers.sort((a, b) => {
        const ta = a.transferredAt ? new Date(a.transferredAt).getTime() : 0;
        const tb = b.transferredAt ? new Date(b.transferredAt).getTime() : 0;
        return tb - ta;
      }),
    };
  }).sort((a, b) => a.recipientName.localeCompare(b.recipientName));

  return {
    recipientCount: recipientRows.length,
    transferCount,
    lineCount,
    totalQty,
    totalCost,
    missingPriceCount,
    recipientRows,
  };
}

export function recipientTransferCsv(report, eventName = 'event') {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = [
    'Client',
    'Product',
    'Qty',
    'Qty label',
    'Base unit price',
    'Override unit price',
    'Markup %',
    'Unit price',
    'Cost',
    'Transfers',
    'Summary',
  ];
  const lines = [headers.map(esc).join(',')];

  for (const r of report.recipientRows || []) {
    if (!r.products.length) {
      lines.push([r.recipientName, '', '', '', '', '', r.markupPct || '', '', '', r.transferCount, ''].map(esc).join(','));
      continue;
    }
    r.products.forEach((p, i) => {
      lines.push([
        r.recipientName,
        p.productName,
        p.qty,
        p.qtyLabel,
        p.baseUnitPrice == null || !Number.isFinite(p.baseUnitPrice) ? '' : Number(p.baseUnitPrice).toFixed(2),
        p.overrideUnitPrice == null || !Number.isFinite(p.overrideUnitPrice) ? '' : Number(p.overrideUnitPrice).toFixed(2),
        i === 0 ? (r.markupPct || 0) : '',
        p.missingPrice || p.unitPrice == null ? '' : Number(p.unitPrice).toFixed(2),
        p.missingPrice ? '' : Number(p.cost || 0).toFixed(2),
        i === 0 ? r.transferCount : '',
        i === 0 ? r.summary : '',
      ].map(esc).join(','));
    });
  }

  const safeName = String(eventName || 'event').replace(/[^\w\s.-]/g, '').trim() || 'event';
  return {
    filename: `${safeName} Transfers by client.csv`,
    content: lines.join('\r\n'),
  };
}

/** Stable key for per-line price overrides within a client. */
export function productPricingKey(product) {
  const name = String(product?.productName || '').trim().toLowerCase();
  if (name) return name;
  if (product?.productId) return `id:${product.productId}`;
  return 'unknown';
}

export function overrideStorageKey(recipientId, product) {
  return `${recipientId || ''}::${productPricingKey(product)}`;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Apply editable unit-price overrides + a client-hidden markup %.
 * Markup is baked into charged unit/line prices (not shown as its own invoice line).
 *
 * @param {object} report
 * @param {{
 *   markupByRecipient?: Record<string, number>,
 *   unitPriceOverrides?: Record<string, number>,
 * }} [adjustments]
 */
export function applyRecipientReportPricing(report, adjustments = {}) {
  if (!report) return report;
  const markupByRecipient = adjustments.markupByRecipient || {};
  const overrides = adjustments.unitPriceOverrides || {};

  let totalCost = 0;
  let totalBaseCost = 0;
  let missingPriceCount = 0;

  const recipientRows = (report.recipientRows || []).map((r) => {
    const rawMarkup = Number(markupByRecipient[r.recipientId]);
    const markupPct = Number.isFinite(rawMarkup) ? rawMarkup : 0;
    const factor = 1 + markupPct / 100;
    let rowCost = 0;
    let rowBaseCost = 0;
    let missing = 0;

    const products = (r.products || []).map((p) => {
      const key = overrideStorageKey(r.recipientId, p);
      const rawOverride = overrides[key];
      const hasOverride = rawOverride != null && rawOverride !== '' && Number.isFinite(Number(rawOverride));
      const overrideUnitPrice = hasOverride ? Number(rawOverride) : null;
      const catalogUnit = p.baseUnitPrice != null && Number.isFinite(p.baseUnitPrice)
        ? p.baseUnitPrice
        : (p.unitPrice != null && Number.isFinite(p.unitPrice) ? p.unitPrice : null);
      const sourceUnit = hasOverride ? overrideUnitPrice : catalogUnit;
      const missingPrice = sourceUnit == null || !Number.isFinite(sourceUnit);
      const chargedUnit = missingPrice ? null : roundMoney(sourceUnit * factor);
      const cost = missingPrice ? 0 : roundMoney(chargedUnit * (Number(p.qty) || 0));
      const preMarkupCost = missingPrice ? 0 : roundMoney(sourceUnit * (Number(p.qty) || 0));

      if (missingPrice) missing += 1;
      else {
        rowCost += cost;
        rowBaseCost += preMarkupCost;
      }

      return {
        ...p,
        baseUnitPrice: catalogUnit,
        overrideUnitPrice,
        markupPct,
        unitPrice: chargedUnit,
        cost,
        baseCost: preMarkupCost,
        missingPrice,
        priceOverridden: hasOverride,
      };
    });

    totalCost += rowCost;
    totalBaseCost += rowBaseCost;
    missingPriceCount += missing;

    return {
      ...r,
      products,
      markupPct,
      totalCost: rowCost,
      baseTotalCost: rowBaseCost,
      missingPriceCount: missing,
    };
  });

  return {
    ...report,
    recipientRows,
    totalCost,
    baseTotalCost: totalBaseCost,
    missingPriceCount,
  };
}
