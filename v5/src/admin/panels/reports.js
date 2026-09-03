/**
 * Reports — supplier delivery cost + internal transfers by client.
 */

import { $, escapeHtml, toast, formatMoney, fmtDateTime } from '../../lib/util.js';
import { getDB, loadEventFull, loadCaseSizes, loadSuppliers, loadRecipesFull, productsFromEvent } from '../../db.js';
import {
  buildSupplierDeliveryCostReport,
  supplierDeliveryCostCsv,
} from '../../lib/supplier-delivery-cost.js';
import {
  applyRecipientReportPricing,
  buildRecipientTransferReport,
  overrideStorageKey,
  recipientTransferCsv,
} from '../../lib/recipient-transfer-report.js';
import { generateRecipientInvoicePDF } from '../../lib/recipient-invoice-pdf.js';
import { icon, initIcons } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { parseQty } from '../../stock-entry.js';
import { computeReconRows } from '../../lib/recon.js';
import { buildVolumeReportXlsx } from '../../lib/volume-report-xlsx.js';
import { createGridCollabSession } from '../../lib/collab-presence.js';
import {
  reportsCellKeyFromInput,
  reportsFindCellEl,
} from '../../lib/grid-collab-keys.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
  setTableFilterContext,
} from '../table-filter.js';

function fmtQty(n) {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function fmtCost(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PRICING_STORAGE_PREFIX = 'v5ClientReportPricing:';

function emptyPricing() {
  return { markupByRecipient: {}, unitPriceOverrides: {} };
}

function loadPricing(eventId) {
  if (!eventId) return emptyPricing();
  try {
    const raw = localStorage.getItem(`${PRICING_STORAGE_PREFIX}${eventId}`);
    if (!raw) return emptyPricing();
    const parsed = JSON.parse(raw);
    return {
      markupByRecipient: parsed?.markupByRecipient || {},
      unitPriceOverrides: parsed?.unitPriceOverrides || {},
    };
  } catch {
    return emptyPricing();
  }
}

function savePricing(eventId, pricing) {
  if (!eventId) return;
  try {
    localStorage.setItem(`${PRICING_STORAGE_PREFIX}${eventId}`, JSON.stringify(pricing));
  } catch { /* ignore quota */ }
}

export function renderReportsShell() {
  return `
    <div class="admin-page reports-page" id="reportsPanel">
      ${loadingWidget('Loading reports…')}
    </div>`;
}

export function mountReportsPanel(route) {
  const root = $('reportsPanel');
  if (!root) return () => {};

  const ctx = {
    eventId: route.eventId,
    event: null,
    deliveries: [],
    transfers: [],
    caseSizes: [],
    suppliers: [],
    reportKind: 'clients',
    supplierId: '',
    recipientId: '',
    dateFrom: '',
    dateTo: '',
    qtyMode: 'received',
    supplierView: 'suppliers',
    abort: false,
    supplierReport: null,
    baseClientReport: null,
    clientReport: null,
    pricing: loadPricing(route.eventId),
    collab: null,
    tillRows: [],
    modifierRows: [],
    recipes: [],
    products: [],
    wastageBatches: [],
    closingRows: [],
    supplierReturns: [],
  };

  const seeded = getTableFilterValues('reports');
  if (seeded) {
    ctx.reportKind = seeded.kind || 'clients';
    ctx.supplierId = seeded.supplierId || '';
    ctx.recipientId = seeded.recipientId || '';
    ctx.dateFrom = seeded.dates?.from || '';
    ctx.dateTo = seeded.dates?.to || '';
    ctx.qtyMode = seeded.qtyMode || 'received';
    ctx.supplierView = seeded.supplierView || 'suppliers';
  }

  function stopCollab() {
    const session = ctx.collab;
    ctx.collab = null;
    session?.destroy();
  }

  function startCollab() {
    stopCollab();
    if (ctx.reportKind !== 'clients') return;
    ctx.collab = createGridCollabSession({
      channelName: `collab:reports:${ctx.eventId}`,
      root,
      inputSelector: '.reports-price-input, .reports-markup-input',
      cellKeyFromInput: reportsCellKeyFromInput,
      findCellEl: reportsFindCellEl,
    });
  }

  function clientsWithTransfers() {
    const withXfer = new Set(
      (ctx.transfers || []).map((t) => t.recipient_id).filter(Boolean),
    );
    const byId = new Map();
    for (const r of ctx.event?.recipients || []) {
      if (!withXfer.has(r.id)) continue;
      byId.set(r.id, { id: r.id, name: r.name || 'Unnamed' });
    }
    for (const t of ctx.transfers || []) {
      const id = t.recipient_id;
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        name: t.recipients?.name || 'Unknown client',
      });
    }
    return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function ensureClientSelected(clients) {
    if (ctx.recipientId && !clients.some((c) => c.id === ctx.recipientId)) {
      ctx.recipientId = '';
    }
  }

  function compute() {
    ctx.supplierReport = buildSupplierDeliveryCostReport({
      deliveries: ctx.deliveries,
      event: ctx.event,
      caseSizes: ctx.caseSizes,
      suppliers: ctx.suppliers,
      supplierId: ctx.supplierId,
      dateFrom: ctx.dateFrom,
      dateTo: ctx.dateTo,
      qtyMode: ctx.qtyMode,
    });
    const clients = clientsWithTransfers();
    ensureClientSelected(clients);
    ctx.baseClientReport = buildRecipientTransferReport({
      transfers: ctx.transfers,
      event: ctx.event,
      caseSizes: ctx.caseSizes,
      recipientId: ctx.recipientId,
      dateFrom: ctx.dateFrom,
      dateTo: ctx.dateTo,
    });
    ctx.clientReport = applyRecipientReportPricing(ctx.baseClientReport, ctx.pricing);
  }

  function persistPricing() {
    savePricing(ctx.eventId, ctx.pricing);
    ctx.clientReport = applyRecipientReportPricing(ctx.baseClientReport, ctx.pricing);
  }

  function exportCsv() {
    if (ctx.reportKind === 'clients') {
      if (!ctx.clientReport) return;
      const { filename, content } = recipientTransferCsv(ctx.clientReport, ctx.event?.name);
      downloadBlob(filename, content);
      return;
    }
    if (!ctx.supplierReport) return;
    const { filename, content } = supplierDeliveryCostCsv(ctx.supplierReport, ctx.event?.name);
    downloadBlob(filename, content);
  }

  function exportVolumeExcel() {
    if (!ctx.event) {
      toast('Event not loaded yet', true);
      return;
    }
    const reconRows = computeReconRows({
      event: ctx.event,
      closingRows: ctx.closingRows,
      tillRows: ctx.tillRows,
      modifierRows: ctx.modifierRows,
      recipes: ctx.recipes,
      products: ctx.products,
      caseSizes: ctx.caseSizes,
      suppliers: ctx.suppliers,
      wastageBatches: ctx.wastageBatches,
      transfers: ctx.transfers,
      supplierReturns: ctx.supplierReturns,
      deliveries: ctx.deliveries,
      showHidden: false,
      drafts: {},
    });

    if (!reconRows.length) {
      toast('No product data to export', true);
      return;
    }

    const eventName = (ctx.event?.name || 'event').replace(/[^\w\s.-]/g, '');
    const workbook = buildVolumeReportXlsx(reconRows, ctx.event?.name || 'Event');
    downloadBlob(
      `${eventName} Volume Report.xlsx`,
      workbook,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    toast('Volume report exported');
  }

  function downloadBlob(filename, content, type = 'text/csv;charset=utf-8') {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function invoicePayloadFromRow(r) {
    return {
      recipientName: r.recipientName,
      transferCount: r.transferCount,
      totalCost: r.totalCost,
      products: (r.products || []).map((p) => ({
        productName: p.productName,
        qtyLabel: p.qtyLabel,
        unitPrice: p.unitPrice,
        cost: p.cost,
        missingPrice: p.missingPrice,
      })),
    };
  }

  function currentRecipientFilter() {
    const el = $('rptRecipient');
    if (el) ctx.recipientId = el.value || '';
    return ctx.recipientId || '';
  }

  async function exportInvoice(recipientId) {
    if (ctx.reportKind !== 'clients') {
      toast('Switch to Clients to export invoices', true);
      return;
    }
    // Prefer an explicit client (per-card button); otherwise the Client dropdown.
    const targetId = (recipientId != null && recipientId !== '')
      ? recipientId
      : currentRecipientFilter();

    let report = ctx.clientReport;
    let rows = targetId
      ? (report?.recipientRows || []).filter((r) => String(r.recipientId) === String(targetId))
      : (report?.recipientRows || []);

    // If the Client filter changed without a recompute, rebuild from full transfers.
    if (targetId && !rows.length && ctx.event) {
      const full = applyRecipientReportPricing(
        buildRecipientTransferReport({
          transfers: ctx.transfers,
          event: ctx.event,
          caseSizes: ctx.caseSizes,
          recipientId: targetId,
          dateFrom: ctx.dateFrom,
          dateTo: ctx.dateTo,
        }),
        ctx.pricing,
      );
      report = full;
      rows = full?.recipientRows || [];
    }

    if (!rows.length) {
      toast(targetId ? 'No transfers for this client to invoice' : 'Select a client to invoice', true);
      return;
    }
    try {
      await generateRecipientInvoicePDF({
        eventName: ctx.event?.name || '',
        date: new Date(),
        invoices: rows.map(invoicePayloadFromRow),
      });
      toast(rows.length === 1
        ? `Invoice downloaded for ${rows[0].recipientName}`
        : `${rows.length} invoices downloaded`);
    } catch (err) {
      toast(err.message || 'Invoice PDF failed', true);
    }
  }

  function renderSupplierStats(report) {
    return `
      <div class="wst-stats reports-stats">
        <div class="wst-stat">
          <span class="wst-stat-label">Total cost</span>
          <span class="wst-stat-value">${escapeHtml(formatMoney(report.totalCost))}</span>
          <span class="wst-stat-label muted">${ctx.qtyMode === 'invoiced' ? 'Invoiced qty' : 'Received qty'}</span>
        </div>
        <div class="wst-stat">
          <span class="wst-stat-label">Deliveries</span>
          <span class="wst-stat-value">${report.deliveryCount}</span>
          <span class="wst-stat-label muted">${report.supplierCount} supplier${report.supplierCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="wst-stat">
          <span class="wst-stat-label">Lines</span>
          <span class="wst-stat-value">${report.lineCount}</span>
          <span class="wst-stat-label muted">${fmtQty(report.totalQty)} cases / units</span>
        </div>
        <div class="wst-stat">
          <span class="wst-stat-label">Missing price</span>
          <span class="wst-stat-value${report.missingPriceCount ? ' dash-stat-value--warn' : ''}">${report.missingPriceCount}</span>
          <span class="wst-stat-label muted">no offer / override</span>
        </div>
      </div>`;
  }

  function renderClientStats(report) {
    const markupNote = report.recipientRows?.some((r) => (r.markupPct || 0) > 0)
      ? 'includes hidden markup'
      : 'at event / offer price';
    return `
      <div class="wst-stats reports-stats reports-stats--3">
        <div class="wst-stat">
          <span class="wst-stat-label">Total charge</span>
          <span class="wst-stat-value">${escapeHtml(formatMoney(report.totalCost || 0))}</span>
          <span class="wst-stat-label muted">${escapeHtml(markupNote)}</span>
        </div>
        <div class="wst-stat">
          <span class="wst-stat-label">Transfers</span>
          <span class="wst-stat-value">${report.transferCount}</span>
          <span class="wst-stat-label muted">${report.lineCount} product lines</span>
        </div>
        <div class="wst-stat">
          <span class="wst-stat-label">Total qty</span>
          <span class="wst-stat-value">${escapeHtml(fmtQty(report.totalQty))}</span>
          <span class="wst-stat-label muted">${
            report.missingPriceCount
              ? `${report.missingPriceCount} missing price`
              : 'cases / units'
          }</span>
        </div>
      </div>`;
  }

  function renderSupplierTable(report) {
    if (!report.supplierRows.length) {
      return emptyState({
        iconHtml: icon('search', { size: 22 }),
        title: 'No matches',
        copy: 'No supplier deliveries match these filters.',
        variant: 'admin',
      });
    }
    return `
      <div class="dash-table-wrap">
        <table class="catalog-table dash-table reports-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th class="num">Deliveries</th>
              <th class="num">Lines</th>
              <th class="num">Qty</th>
              <th class="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            ${report.supplierRows.map((r) => `
              <tr>
                <td>${escapeHtml(r.supplierName)}</td>
                <td class="num">${r.deliveryCount}</td>
                <td class="num">${r.lineCount}</td>
                <td class="num">${escapeHtml(fmtQty(r.qty))}</td>
                <td class="num reports-cost">${escapeHtml(fmtCost(r.cost))}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr class="reports-total-row">
              <td>Total</td>
              <td class="num">${report.deliveryCount}</td>
              <td class="num">${report.lineCount}</td>
              <td class="num">${escapeHtml(fmtQty(report.totalQty))}</td>
              <td class="num reports-cost">${escapeHtml(fmtCost(report.totalCost))}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  function renderDeliveryTable(report) {
    if (!report.deliveryRows.length) {
      return emptyState({
        iconHtml: icon('search', { size: 22 }),
        title: 'No matches',
        copy: 'No supplier deliveries match these filters.',
        variant: 'admin',
      });
    }
    return `
      <div class="dash-table-wrap">
        <table class="catalog-table dash-table reports-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Supplier</th>
              <th>Reference</th>
              <th class="num">Lines</th>
              <th class="num">Qty</th>
              <th class="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            ${report.deliveryRows.map((d) => `
              <tr>
                <td>${escapeHtml(fmtDateTime(d.deliveredAt))}</td>
                <td>${escapeHtml(d.supplierName)}</td>
                <td>${d.reference ? escapeHtml(d.reference) : '<span class="muted">—</span>'}</td>
                <td class="num">${d.lineCount}</td>
                <td class="num">${escapeHtml(fmtQty(d.qty))}</td>
                <td class="num reports-cost">${escapeHtml(fmtCost(d.cost))}${
                  d.missingPriceCount
                    ? ` <span class="reports-miss muted" title="Lines missing price">(${d.missingPriceCount})</span>`
                    : ''
                }</td>
              </tr>
              ${d.lines.map((l) => `
                <tr class="reports-line-row">
                  <td></td>
                  <td colspan="2" class="reports-line-name">${escapeHtml(l.productName)}</td>
                  <td class="num muted">${escapeHtml(l.priceBasis)}</td>
                  <td class="num">${escapeHtml(fmtQty(l.qty))}</td>
                  <td class="num">${
                    l.missingPrice
                      ? '<span class="reports-miss">No price</span>'
                      : escapeHtml(fmtCost(l.cost))
                  }</td>
                </tr>`).join('')}
            `).join('')}
          </tbody>
          <tfoot>
            <tr class="reports-total-row">
              <td colspan="3">Total</td>
              <td class="num">${report.lineCount}</td>
              <td class="num">${escapeHtml(fmtQty(report.totalQty))}</td>
              <td class="num reports-cost">${escapeHtml(fmtCost(report.totalCost))}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  function unitPriceInputValue(p) {
    if (p.overrideUnitPrice != null && Number.isFinite(p.overrideUnitPrice)) {
      return String(p.overrideUnitPrice);
    }
    if (p.baseUnitPrice != null && Number.isFinite(p.baseUnitPrice)) {
      return String(p.baseUnitPrice);
    }
    return '';
  }

  function renderClientDetail(report) {
    const r = report.recipientRows?.[0];
    if (!r) {
      return emptyState({
        iconHtml: icon('search', { size: 22 }),
        title: 'No matches',
        copy: 'No transfers for this client in the selected date range.',
        variant: 'admin',
      });
    }

    return `
      <article class="del-card reports-client-card" data-recipient-id="${escapeHtml(r.recipientId)}">
        <div class="del-card-main del-card-main--stacked">
          <div class="del-card-head">
            <div class="del-card-body">
              <h3 class="del-card-title">${escapeHtml(r.recipientName)}</h3>
              <p class="del-card-meta">
                ${r.transferCount} transfer${r.transferCount !== 1 ? 's' : ''}
                · ${r.products.length} product${r.products.length !== 1 ? 's' : ''}
                · ${escapeHtml(fmtQty(r.totalQty))} total qty
              </p>
              <label class="reports-markup-field">
                <span class="admin-label">Markup % <span class="muted">(hidden on invoice)</span></span>
                <input type="text" inputmode="decimal" autocomplete="off" class="admin-input reports-markup-input num-math"
                  data-markup-recipient="${escapeHtml(r.recipientId)}"
                  value="${escapeHtml(String(r.markupPct || 0))}"
                  title="Added into unit prices — not shown as a separate line on the invoice">
              </label>
            </div>
            <div class="reports-client-cost">
              <span class="reports-client-cost-value" data-client-total="${escapeHtml(r.recipientId)}">${escapeHtml(fmtCost(r.totalCost))}</span>
              ${(r.markupPct || 0) > 0
                ? `<span class="muted reports-client-base">before markup ${escapeHtml(fmtCost(r.baseTotalCost))}</span>`
                : ''}
              ${r.missingPriceCount
                ? `<span class="reports-miss muted">${r.missingPriceCount} no price</span>`
                : ''}
              <button type="button" class="topbar-tool topbar-tool--label reports-invoice-btn"
                data-invoice-recipient="${escapeHtml(r.recipientId)}"
                title="Export invoice PDF" aria-label="Export invoice for ${escapeHtml(r.recipientName)}">
                ${icon('file-text', { size: 16 })}
                <span>Invoice</span>
              </button>
            </div>
          </div>
          <div class="dash-table-wrap reports-client-table-wrap">
            <table class="catalog-table dash-table reports-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th class="num">Qty</th>
                  <th class="num">Unit £</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${r.products.map((p) => {
                  const key = overrideStorageKey(r.recipientId, p);
                  const inputVal = unitPriceInputValue(p);
                  return `
                  <tr data-price-key="${escapeHtml(key)}">
                    <td>${escapeHtml(p.productName)}${
                      p.priceOverridden
                        ? ' <span class="catalog-tag">override</span>'
                        : ''
                    }</td>
                    <td class="num">${escapeHtml(p.qtyLabel)}</td>
                    <td class="num reports-price-cell">
                      <input type="text" inputmode="decimal" autocomplete="off" class="admin-input reports-price-input num-math"
                        data-price-recipient="${escapeHtml(r.recipientId)}"
                        data-price-key="${escapeHtml(key)}"
                        value="${escapeHtml(inputVal)}"
                        placeholder="—"
                        aria-label="Unit price for ${escapeHtml(p.productName)}">
                      ${(r.markupPct || 0) > 0 && p.unitPrice != null
                        ? `<span class="muted reports-charged-unit">invoice ${escapeHtml(fmtCost(p.unitPrice))}</span>`
                        : ''}
                    </td>
                    <td class="num reports-cost" data-line-amount>${
                      p.missingPrice
                        ? '<span class="reports-miss">No price</span>'
                        : escapeHtml(fmtCost(p.cost))
                    }</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${r.transfers.length ? `
            <details class="reports-client-transfers">
              <summary>Transfer history (${r.transferCount})</summary>
              <ul class="reports-xfer-list">
                ${r.transfers.map((t) => `
                  <li>
                    <span class="reports-xfer-date">${escapeHtml(fmtDateTime(t.transferredAt))}</span>
                    <span class="reports-xfer-items">${escapeHtml(
                      t.lines.map((l) => `${l.productName} (${fmtQty(l.qty)})`).join(', '),
                    )}</span>
                  </li>`).join('')}
              </ul>
            </details>` : ''}
        </div>
      </article>`;
  }

  function bind() {
    root.querySelectorAll('[data-invoice-recipient]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-invoice-recipient') || '';
        if (!id) {
          toast('Missing client for invoice export', true);
          return;
        }
        exportInvoice(id);
      };
    });

    root.querySelectorAll('.reports-price-input').forEach((inp) => {
      inp.onchange = () => {
        const key = inp.dataset.priceKey;
        const rid = inp.dataset.priceRecipient;
        if (!key) return;
        const raw = inp.value.trim();
        const baseProduct = ctx.baseClientReport?.recipientRows
          ?.find((r) => r.recipientId === rid)
          ?.products
          ?.find((p) => overrideStorageKey(rid, p) === key);
        const catalogUnit = baseProduct?.unitPrice;
        if (raw === '') {
          delete ctx.pricing.unitPriceOverrides[key];
        } else {
          const n = parseQty(raw);
          if (!/^[0-9+\-*/().\s]+$/.test(raw) || (!Number.isFinite(n))) {
            toast('Enter a valid unit price', true);
            return;
          }
          if (catalogUnit != null && Number.isFinite(catalogUnit) && n === catalogUnit) {
            delete ctx.pricing.unitPriceOverrides[key];
          } else {
            ctx.pricing.unitPriceOverrides[key] = n;
          }
        }
        persistPricing();
        paint();
      };
    });

    root.querySelectorAll('.reports-markup-input').forEach((inp) => {
      inp.onchange = () => {
        const rid = inp.dataset.markupRecipient;
        if (!rid) return;
        const raw = String(inp.value ?? '').trim();
        if (raw && !/^[0-9+\-*/().\s]+$/.test(raw)) {
          toast('Enter a valid markup %', true);
          return;
        }
        const n = parseQty(raw);
        if (n === 0) delete ctx.pricing.markupByRecipient[rid];
        else ctx.pricing.markupByRecipient[rid] = n;
        persistPricing();
        paint();
      };
    });
  }

  function paint() {
    const isClients = ctx.reportKind === 'clients';
    const recipients = clientsWithTransfers();

    let body = '';
    let lead = '';

    if (isClients) {
      const report = ctx.clientReport || {
        recipientCount: 0,
        transferCount: 0,
        lineCount: 0,
        totalQty: 0,
        totalCost: 0,
        missingPriceCount: 0,
        recipientRows: [],
      };
      lead = 'Use the filter menu to pick a client and date range. Edit unit prices and add an internal markup % — markup is baked into invoice prices and not shown as its own line.';
      if (!recipients.length) {
        body = emptyState({
          iconHtml: icon('arrow-left-right', { size: 22 }),
          title: 'No client transfers yet',
          copy: 'Log a transfer to a recipient (Artist Liaison, Production, etc.) on the Transfers page.',
          variant: 'admin',
        });
      } else if (!ctx.recipientId) {
        body = `
        ${renderClientStats(report)}
        ${emptyState({
          iconHtml: icon('funnel', { size: 22 }),
          title: 'Choose a client',
          copy: 'Open the filter menu and pick a client to see transfer detail and invoice pricing.',
          variant: 'admin',
        })}`;
      } else {
        body = `
        ${renderClientStats(report)}
        <div class="reports-client-detail">${renderClientDetail(report)}</div>`;
      }
    } else {
      const report = ctx.supplierReport || {
        deliveryCount: 0,
        lineCount: 0,
        totalQty: 0,
        totalCost: 0,
        missingPriceCount: 0,
        supplierCount: 0,
        supplierRows: [],
        deliveryRows: [],
      };
      const bySupplier = ctx.supplierView === 'suppliers';
      lead = 'Total cost of stock transferred in from suppliers (deliveries). Use the filter menu for report type, supplier, dates, quantity basis, and view.';
      body = `
        ${renderSupplierStats(report)}
        <section class="admin-surface projections-table-section">
          ${bySupplier ? renderSupplierTable(report) : renderDeliveryTable(report)}
        </section>`;
    }

    root.innerHTML = `
      <p class="projections-lead muted">${escapeHtml(lead)}</p>
      ${body}`;
    initIcons(root);
    bind();
    if (isClients) startCollab();
    else stopCollab();
  }

  function pushFilterContext() {
    setTableFilterContext('reports', {
      recipients: clientsWithTransfers().map((r) => ({ id: r.id, name: r.name })),
      suppliers: (ctx.suppliers || []).map((s) => ({ value: s.id, label: s.name })),
    });
  }

  async function reload() {
    const DB = getDB();
    const [event, caseSizes, suppliers] = await Promise.all([
      loadEventFull(ctx.eventId),
      loadCaseSizes(),
      loadSuppliers(),
    ]);
    if (ctx.abort) return;
    ctx.event = event;
    ctx.deliveries = [];
    ctx.transfers = [];
    ctx.caseSizes = caseSizes || [];
    ctx.suppliers = (suppliers || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    pushFilterContext();
    compute();
    paint();

    const [deliveries, transfers, tillImport, modImport, recipes, wastage, closingRows, supplierReturns] = await Promise.all([
      DB.deliveries.forEvent(ctx.eventId),
      DB.transfers.forEvent(ctx.eventId),
      DB.tillImports.forEvent(ctx.eventId).catch(() => null),
      DB.modifierImports.forEvent(ctx.eventId).catch(() => null),
      loadRecipesFull().catch(() => []),
      DB.wastage.forEvent(ctx.eventId).catch(() => []),
      DB.closing.forEvent(ctx.eventId).catch(() => []),
      DB.supplierReturns.forEvent(ctx.eventId).catch(() => []),
    ]);
    if (ctx.abort) return;
    ctx.deliveries = deliveries || [];
    ctx.transfers = transfers || [];
    ctx.tillRows = tillImport?.rows || [];
    ctx.modifierRows = modImport?.rows || [];
    ctx.recipes = recipes || [];
    ctx.products = productsFromEvent(event);
    ctx.wastageBatches = wastage || [];
    ctx.closingRows = closingRows || [];
    ctx.supplierReturns = supplierReturns || [];
    pushFilterContext();
    compute();
    paint();
  }

  function onToolbar(e) {
    if (e.detail?.action === 'export-reports') {
      e.detail.handled = true;
      exportCsv();
      return;
    }
    if (e.detail?.action === 'export-invoice') {
      e.detail.handled = true;
      exportInvoice(currentRecipientFilter());
      return;
    }
    if (e.detail?.action === 'export-volume') {
      e.detail.handled = true;
      exportVolumeExcel();
    }
  }

  function onTableFilter(e) {
    if (e.detail?.panel !== 'reports') return;
    const values = e.detail?.values;
    if (!values) return;
    ctx.reportKind = values.kind || 'clients';
    ctx.supplierId = values.supplierId || '';
    ctx.recipientId = values.recipientId || '';
    ctx.dateFrom = values.dates?.from || '';
    ctx.dateTo = values.dates?.to || '';
    ctx.qtyMode = values.qtyMode || 'received';
    ctx.supplierView = values.supplierView || 'suppliers';
    compute();
    paint();
  }

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  reload().catch((err) => {
    reportError(err, { source: 'admin.reports.load', silent: true });
    root.innerHTML = errorState({
      title: 'Couldn’t load reports',
      copy: err.message || 'Failed to load reports',
      variant: 'admin',
    });
    bindEmptyRetry(root, () => reload());
    toast(err.message || 'Failed to load reports', true);
  });

  return () => {
    ctx.abort = true;
    stopCollab();
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
