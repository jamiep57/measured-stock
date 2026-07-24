/**
 * Internal transfers by recipient (client) — e.g. Artist Liaison got Lager ×5, Gin ×2.
 */

import { productStockPack } from '../pack-metrics.js';
import { storedToForm, totalUnitsForProduct, parseQty } from '../stock-entry.js';

function productFromEvent(event, productId) {
  const ep = (event?.event_products || []).find((x) => x.product_id === productId);
  return ep?.product || null;
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

/**
 * Aggregate product qty for one transfer's lines.
 */
export function transferProductQty(line, event, caseSizes = []) {
  const product = productFromEvent(event, line?.product_id) || line?.product || null;
  const form = storedToForm(line);
  const qty = totalUnitsForProduct(form.cases, form.singles, product, caseSizes);
  return {
    productId: line?.product_id || null,
    productName: product?.name || line?.product?.name || 'Unknown product',
    qty: Number.isFinite(qty) ? qty : 0,
    cases: parseQty(form.cases),
    singles: parseQty(form.singles),
    product,
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
      totalQty += row.qty;
      transferLines.push(row);

      if (!row.productId) continue;
      if (!agg.products.has(row.productId)) {
        agg.products.set(row.productId, {
          productId: row.productId,
          productName: row.productName,
          qty: 0,
          cases: 0,
          singles: 0,
          product: row.product,
        });
      }
      const p = agg.products.get(row.productId);
      p.qty += row.qty;
      p.cases += row.cases;
      p.singles += row.singles;
    }

    agg.transfers.push({
      transferId: t.id,
      transferredAt: when,
      notes: t.notes || '',
      lines: transferLines,
      totalQty: transferLines.reduce((s, l) => s + l.qty, 0),
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
    recipientRows,
  };
}

export function recipientTransferCsv(report, eventName = 'event') {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ['Client', 'Product', 'Qty', 'Qty label', 'Transfers', 'Summary'];
  const lines = [headers.map(esc).join(',')];

  for (const r of report.recipientRows || []) {
    if (!r.products.length) {
      lines.push([r.recipientName, '', '', '', r.transferCount, ''].map(esc).join(','));
      continue;
    }
    r.products.forEach((p, i) => {
      lines.push([
        r.recipientName,
        p.productName,
        p.qty,
        p.qtyLabel,
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
