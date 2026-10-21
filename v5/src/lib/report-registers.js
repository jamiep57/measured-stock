/**
 * Read-only registers for the Reports library. Each builder returns table
 * cells plus a CSV of the same rows. Row actions (PDF, delivery note) stay
 * in the panel and are named here so the table can render a button.
 */

import { findOfferForSupplier } from '../pack-metrics.js';
import { storedToForm, totalUnitsForProduct } from '../stock-entry.js';
import { orderPayable } from './order-compare.js';
import { preferredSupplierId, reconRowPrice, reconUsesBottlePrice } from './recon.js';

const ORDER_STATUS = {
  draft: 'Draft',
  sent: 'Sent',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export function inReportDateRange(iso, dateFrom, dateTo) {
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

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableCsv(columns, rows) {
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  (rows || []).forEach((row) => {
    lines.push(columns.map((c) => csvEscape(row.cells?.[c.key] ?? '')).join(','));
  });
  return lines.join('\r\n');
}

function trimNum(n) {
  const r = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(r) || r === 0) return '';
  return Number.isInteger(r) ? String(r) : String(r);
}

export function formatReportWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function qtyLabel(lines) {
  let cases = 0;
  let singles = 0;
  (lines || []).forEach((line) => {
    const form = storedToForm(line);
    cases += Number(form.cases) || 0;
    singles += Number(form.singles) || 0;
  });
  const parts = [];
  if (cases) parts.push(`${trimNum(cases)} cases`);
  if (singles) parts.push(`${trimNum(singles)} singles`);
  return parts.join(', ');
}

function finish(columns, rows, footer = null) {
  const showFooter = !!(footer && rows.length);
  let csv = tableCsv(columns, rows);
  if (showFooter) {
    csv += `\r\n${columns.map((c) => csvEscape(footer[c.key] ?? '')).join(',')}`;
  }
  return { columns, rows, csv, footer: showFooter ? footer : null };
}

function formatReportMoney(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** True when recon has a price source for this event product (including an explicit zero). */
function wastagePriceKnown(ep, caseSizes) {
  if (!ep?.product) return false;
  if (ep.order_price_override != null || ep.order_unit_price_override != null) return true;
  if (ep.prices_captured_at != null) return true;
  const product = ep.product;
  const offer = findOfferForSupplier(product, preferredSupplierId(product));
  if (reconUsesBottlePrice(product, caseSizes)) {
    return offer?.unit_price != null || offer?.case_price != null
      || product.unit_price != null || product.case_price != null;
  }
  return offer?.case_price != null || product.case_price != null;
}

function wastageLineCost(line, event, caseSizes) {
  const ep = (event?.event_products || []).find((row) => row.product_id === line?.product_id) || null;
  if (!wastagePriceKnown(ep, caseSizes)) return { cost: 0, missing: true };
  const form = storedToForm(line);
  const qty = totalUnitsForProduct(form.cases, form.singles, ep.product, caseSizes);
  const price = Number(reconRowPrice(ep, null, caseSizes)) || 0;
  const safeQty = Number.isFinite(qty) ? qty : 0;
  return { cost: Math.round(safeQty * price * 100) / 100, missing: false };
}

function productName(event, productId, names) {
  if (names?.get?.(productId)) return names.get(productId);
  const ep = (event?.event_products || []).find((row) => row.product_id === productId);
  return ep?.product?.name || 'Product';
}

/**
 * @param {{ deliveries: object[], event: object, supplierId?: string, dateFrom?: string, dateTo?: string, names?: Map }} input
 */
export function buildDeliveryRegister({
  deliveries = [], event, supplierId = '', dateFrom = '', dateTo = '', names,
} = {}) {
  const columns = [
    { key: 'when', label: 'Date' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'reference', label: 'Reference' },
    { key: 'lines', label: 'Products' },
    { key: 'qty', label: 'Quantity' },
    { key: 'notes', label: 'Notes' },
  ];
  const rows = (deliveries || [])
    .filter((d) => !supplierId || d.supplier_id === supplierId || d.supplier?.id === supplierId)
    .filter((d) => inReportDateRange(d.delivered_at, dateFrom, dateTo))
    .slice()
    .sort((a, b) => new Date(b.delivered_at || 0) - new Date(a.delivered_at || 0))
    .map((d) => ({
      id: d.id,
      cells: {
        when: formatReportWhen(d.delivered_at),
        supplier: d.supplier?.name || 'No supplier',
        reference: d.reference || '',
        lines: (d.lines || []).map((l) => productName(event, l.product_id, names)).join(', '),
        qty: qtyLabel(d.lines),
        notes: d.notes || '',
      },
    }));
  return finish(columns, rows);
}

/**
 * @param {{ batches: object[], event: object, caseSizes?: object[], dateFrom?: string, dateTo?: string, names?: Map }} input
 */
export function buildWastageRegister({
  batches = [], event, caseSizes = [], dateFrom = '', dateTo = '', names,
} = {}) {
  const columns = [
    { key: 'when', label: 'Date' },
    { key: 'reason', label: 'Reason' },
    { key: 'lines', label: 'Products' },
    { key: 'qty', label: 'Quantity' },
    { key: 'cost', label: 'Cost', num: true, money: true },
    { key: 'notes', label: 'Notes' },
  ];
  let total = 0;
  let missing = 0;
  const rows = (batches || [])
    .filter((b) => inReportDateRange(b.recorded_at || b.created_at, dateFrom, dateTo))
    .slice()
    .sort((a, b) => new Date(b.recorded_at || b.created_at || 0) - new Date(a.recorded_at || a.created_at || 0))
    .map((b) => {
      const lines = b.lines || [];
      let cost = 0;
      let rowMissing = 0;
      lines.forEach((line) => {
        const priced = wastageLineCost(line, event, caseSizes);
        if (priced.missing) rowMissing += 1;
        else cost += priced.cost;
      });
      cost = Math.round(cost * 100) / 100;
      total += cost;
      missing += rowMissing;
      const pricedCount = lines.length - rowMissing;
      return {
        id: b.id,
        cells: {
          when: formatReportWhen(b.recorded_at || b.created_at),
          reason: b.reason || 'Wastage',
          lines: lines.map((l) => productName(event, l.product_id, names)).join(', '),
          qty: qtyLabel(lines),
          cost: pricedCount ? formatReportMoney(cost) : '',
          notes: b.notes || '',
        },
      };
    });
  total = Math.round(total * 100) / 100;
  const footer = {
    when: 'Total',
    reason: missing ? `${missing} without a price` : '',
    lines: '',
    qty: '',
    cost: formatReportMoney(total),
    notes: '',
  };
  return finish(columns, rows, footer);
}

/**
 * One group per count session. The spreadsheet stays one row per counted line.
 * @param {{ sessions: object[], linesBySession: Map|Record<string, object[]>, event: object, dateFrom?: string, dateTo?: string, names?: Map }} input
 */
export function buildCountRegister({
  sessions = [], linesBySession = new Map(), event, dateFrom = '', dateTo = '', names,
} = {}) {
  const columns = [
    { key: 'when', label: 'Date' },
    { key: 'session', label: 'Session' },
    { key: 'location', label: 'Location' },
    { key: 'product', label: 'Product' },
    { key: 'cases', label: 'Cases', num: true },
    { key: 'singles', label: 'Singles', num: true },
  ];
  const barName = (id) => (event?.bars || []).find((b) => b.id === id)?.name || (id ? 'Location' : 'All locations');
  const csvRows = [];
  const rows = (sessions || [])
    .filter((s) => inReportDateRange(s.counted_at, dateFrom, dateTo))
    .slice()
    .sort((a, b) => new Date(b.counted_at || 0) - new Date(a.counted_at || 0))
    .map((session) => {
      const stored = (linesBySession instanceof Map
        ? linesBySession.get(session.id)
        : linesBySession?.[session.id]) || [];
      const when = formatReportWhen(session.counted_at);
      const name = session.name || 'Count';
      const lines = stored
        .filter((line) => (Number(line.cases) || 0) !== 0 || (Number(line.singles) || 0) !== 0)
        .map((line) => ({
          product: productName(event, line.product_id, names),
          location: barName(line.bar_id || session.bar_id),
          cases: trimNum(line.cases),
          singles: trimNum(line.singles),
        }))
        .sort((a, b) => a.product.localeCompare(b.product) || a.location.localeCompare(b.location));
      const places = [...new Set(lines.map((line) => line.location).filter(Boolean))];
      const location = places.length === 1
        ? places[0]
        : places.length > 1
          ? `${places.length} locations`
          : barName(session.bar_id);
      if (lines.length) {
        lines.forEach((line) => {
          csvRows.push({
            cells: {
              when,
              session: name,
              location: line.location,
              product: line.product,
              cases: line.cases,
              singles: line.singles,
            },
          });
        });
      } else {
        csvRows.push({
          cells: { when, session: name, location, product: '', cases: '', singles: '' },
        });
      }
      return {
        id: session.id,
        when,
        session: name,
        location,
        lines,
      };
    });
  return {
    columns,
    rows,
    csv: tableCsv(columns, csvRows),
    layout: 'counts',
    footer: null,
  };
}

/**
 * Products on this event (opening stock).
 * @param {{ event: object }} input
 */
export function buildProductRegister({ event } = {}) {
  const columns = [
    { key: 'product', label: 'Product' },
    { key: 'category', label: 'Category' },
    { key: 'pack', label: 'Pack' },
    { key: 'abv', label: 'ABV' },
    { key: 'opening', label: 'Opening', num: true },
  ];
  const rows = (event?.event_products || [])
    .filter((ep) => ep?.product?.name)
    .slice()
    .sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''))
    .map((ep) => {
      const p = ep.product;
      const opening = ep.already_in_stock != null && ep.already_in_stock !== ''
        ? String(ep.already_in_stock)
        : '';
      return {
        id: ep.product_id || p.id,
        cells: {
          product: p.name,
          category: p.category?.name || '',
          pack: p.case_size || '',
          abv: p.abv != null && p.abv !== '' ? `${Number(p.abv)}%` : '',
          opening,
        },
      };
    });
  return finish(columns, rows);
}

/**
 * @param {{ orders: object[], suppliers?: object[], names?: Map, supplierId?: string, dateFrom?: string, dateTo?: string }} input
 */
export function buildOrderRegister({
  orders = [], suppliers = [], names, supplierId = '', dateFrom = '', dateTo = '',
} = {}) {
  const columns = [
    { key: 'reference', label: 'Reference' },
    { key: 'status', label: 'Status' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'ordered', label: 'Ordered' },
    { key: 'delivery', label: 'Deliver by' },
    { key: 'lines', label: 'Lines', num: true },
    { key: 'cases', label: 'Cases', num: true },
    { key: 'total', label: 'Total' },
  ];
  const supplierName = (id) => (suppliers || []).find((s) => s.id === id)?.name || '';
  const rows = (orders || [])
    .filter((po) => !supplierId || po.supplier_id === supplierId)
    .filter((po) => inReportDateRange(po.order_date || po.created_at, dateFrom, dateTo))
    .slice()
    .sort((a, b) => new Date(b.order_date || b.created_at || 0) - new Date(a.order_date || a.created_at || 0))
    .map((po) => {
      const lines = po.purchase_order_lines || [];
      const cases = lines.reduce((sum, line) => sum + (Number(line.qty_cases) || 0), 0);
      const total = orderPayable(lines, po.delivery_cost);
      return {
        id: po.id,
        action: lines.length ? 'po-pdf' : '',
        cells: {
          reference: po.reference || '',
          status: ORDER_STATUS[po.status] || po.status || '',
          supplier: supplierName(po.supplier_id),
          ordered: (po.order_date || '').slice(0, 10),
          delivery: (po.delivery_date || '').slice(0, 10),
          lines: String(lines.length),
          cases: trimNum(cases),
          total: total.priced || total.delivery > 0 ? total.net.toFixed(2) : '',
        },
        po,
        lineNames: lines.map((line) => ({
          name: names?.get?.(line.product_id) || 'Product',
          pack: '',
          qty_cases: line.qty_cases,
          case_price: line.case_price,
        })),
      };
    });
  return finish(columns, rows);
}

function barName(event, id) {
  return (event?.bars || []).find((b) => b.id === id)?.name || '';
}

function warehouseName(warehouses, id) {
  return (warehouses || []).find((w) => w.id === id)?.name || '';
}

export function transferEnds(transfer, event, warehouses) {
  const from = transfer.from_bar_id
    ? (barName(event, transfer.from_bar_id) || 'Location')
    : transfer.from_warehouse_id
      ? (warehouseName(warehouses, transfer.from_warehouse_id) || 'Warehouse')
      : (event?.name || 'Event');
  let to = '—';
  if (transfer.to_bar_id) to = barName(event, transfer.to_bar_id) || 'Location';
  else if (transfer.recipients?.name) to = transfer.recipients.name;
  else if (transfer.recipient_id) {
    to = (event?.recipients || []).find((r) => r.id === transfer.recipient_id)?.name || 'Client';
  } else if (transfer.to_warehouse_id) {
    to = warehouseName(warehouses, transfer.to_warehouse_id) || 'Warehouse';
  }
  return { from, to };
}

/**
 * One visual group per transfer. The spreadsheet stays one row per product.
 * @param {{ transfers: object[], event: object, warehouses?: object[], dateFrom?: string, dateTo?: string, names?: Map }} input
 */
export function buildTransferRegister({
  transfers = [], event, warehouses = [], dateFrom = '', dateTo = '', names,
} = {}) {
  const columns = [
    { key: 'when', label: 'Date' },
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
    { key: 'lines', label: 'Product' },
    { key: 'qty', label: 'Quantity' },
  ];
  const csvRows = [];
  const rows = (transfers || [])
    .filter((t) => inReportDateRange(t.transferred_at, dateFrom, dateTo))
    .slice()
    .sort((a, b) => new Date(b.transferred_at || 0) - new Date(a.transferred_at || 0))
    .map((t) => {
      const ends = transferEnds(t, event, warehouses);
      const source = t.lines || [];
      const when = formatReportWhen(t.transferred_at);
      const lines = source.map((line) => ({
        name: productName(event, line.product_id, names),
        qty: qtyLabel([line]),
      }));
      const listed = source.length ? source : [null];
      listed.forEach((line) => {
        csvRows.push({
          cells: {
            when,
            from: ends.from,
            to: ends.to,
            lines: line ? productName(event, line.product_id, names) : '',
            qty: line ? qtyLabel([line]) : '',
          },
        });
      });
      return {
        id: t.id,
        action: source.length ? 'delivery-note' : '',
        when,
        from: ends.from,
        to: ends.to,
        totalQty: qtyLabel(source),
        lines,
      };
    });
  const model = finish(columns, rows);
  model.layout = 'transfers';
  model.csv = tableCsv(columns, csvRows);
  return model;
}

/**
 * Closing counts. A sticker action is offered when cases were counted.
 * @param {{ event: object, closingRows?: object[] }} input
 */
export function buildClosingRegister({ event, closingRows = [] } = {}) {
  const columns = [
    { key: 'product', label: 'Product' },
    { key: 'pack', label: 'Pack' },
    { key: 'cases', label: 'Closing cases', num: true },
    { key: 'singles', label: 'Closing singles', num: true },
    { key: 'returned', label: 'Returned', num: true },
  ];
  const closingByProduct = new Map((closingRows || []).map((row) => [row.product_id, row]));
  const rows = (event?.event_products || [])
    .filter((ep) => ep?.product?.name)
    .slice()
    .sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''))
    .map((ep) => {
      const closing = closingByProduct.get(ep.product_id) || {};
      const cases = closing.closing_cases != null ? Number(closing.closing_cases) : null;
      return {
        id: ep.product_id,
        action: cases > 0 ? 'pallet-sticker' : '',
        cells: {
          product: ep.product.name,
          pack: ep.product.case_size || '',
          cases: cases != null ? trimNum(cases) : '',
          singles: closing.closing_singles != null ? trimNum(closing.closing_singles) : '',
          returned: closing.return_amount != null ? trimNum(closing.return_amount) : '',
        },
        sticker: {
          productName: ep.product.name,
          caseSize: ep.product.case_size || '',
          cases: cases || 0,
        },
      };
    });
  return finish(columns, rows);
}
