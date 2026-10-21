/**
 * Reports library. Opening the page lists named reports. Opening a report
 * shows its preview, its own filters, and only the downloads it can produce.
 */

import { $, escapeHtml, toast, formatMoney, fmtDateTime, isBoneYard } from '../../lib/util.js';
import { getDB, loadEventFull, loadCaseSizes, loadSuppliers, loadRecipesFull, loadLibraryProducts, productsFromEvent } from '../../db.js';
import {
  isCocktailSchemaMissing,
  listEventCocktails,
  listEventMenu,
  listScenarios,
  loadEventCocktailMapping,
  loadEventPricing,
} from '../../lib/planning-data.js';
import { loadSalesBundle } from '../../lib/sales-feed.js';
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
import { ADMIN_TOOLBAR_ACTION, setTopbarFilterSuppressed, setTopbarToolbarStrips } from '../topbar-toolbar.js';
import { parseQty } from '../../stock-entry.js';
import { computeReconRows } from '../../lib/recon.js';
import { reconCsv } from '../../lib/recon-csv.js';
import { buildVolumeReportXlsx, volumeReportGroups } from '../../lib/volume-report-xlsx.js';
import { can } from '../../lib/permissions.js';
import { isOrgAdmin } from '../../lib/organisations.js';
import { getQueueStats } from '../../sync-queue.js';
import { auditExportDocument, auditExportFilename, runEventAudit, CHECK_META } from '../../lib/forensics.js';
import { resolveMenuLine } from '../../lib/planning-menu.js';
import { baseMenuItem, groupMenuItems } from '../../lib/menu-serves.js';
import { resolveCocktailLine } from '../../lib/menu-cocktails.js';
import { cellValue, formatCell, buildMenuExport } from '../../lib/menu-exports.js';
import { commitMenuExport } from '../planning-export.js';
import { listPurchaseOrders } from '../../lib/orders-data.js';
import { generatePurchaseOrderPDF } from '../../lib/purchase-order-pdf.js';
import { generateDeliveryNotePDF } from '../../lib/delivery-note-pdf.js';
import { generatePalletStickerPDF } from '../../lib/pallet-sticker-pdf.js';
import { printClosingCountSheet, printCountSheets } from '../../lib/count-sheets-print.js';
import { findOfferForSupplier } from '../../pack-metrics.js';
import {
  buildClosingRegister,
  buildCountRegister,
  buildDeliveryRegister,
  buildOrderRegister,
  buildProductRegister,
  buildTransferRegister,
  buildWastageRegister,
  transferEnds,
} from '../../lib/report-registers.js';
import { formatSpec, reportById, visibleReports } from '../report-catalog.js';
import { renderDataTable, renderReportLibrary, renderWorkspaceHead } from '../report-view.js';
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
  patchTableFilterState,
  setTableFilterContext,
} from '../table-filter.js';
import { INSIGHT_KINDS, createReportInsights } from '../reports-insights.js';

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
    reportId: '',
    search: '',
    supplierId: '',
    recipientId: '',
    dateFrom: '',
    dateTo: '',
    qtyMode: 'received',
    supplierView: 'suppliers',
    printScope: 'all',
    rateSource: 'menu',
    includeInternal: false,
    menuScenarioIds: [],
    menuScenarioInit: false,
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
    salesGroup: 'item',
    location: '',
    cocktails: [],
    menuItems: [],
    orders: [],
    countSessions: [],
    countLines: new Map(),
    warehouses: [],
    barProducts: [],
    libraryProducts: [],
    menuLines: [],
    menuScenarios: [],
    menuVatRate: 0.2,
    menuLoaded: false,
    menuLoading: false,
    libraryLoaded: false,
    auditReport: null,
    auditLoaded: false,
    auditLoading: false,
    auditError: null,
  };

  const insightFilters = () => ({
    dateFrom: ctx.dateFrom, dateTo: ctx.dateTo, location: ctx.location, salesGroup: ctx.salesGroup,
  });
  const insights = createReportInsights({ getBase: () => ctx, onChange: () => paint() });
  const isInsight = () => INSIGHT_KINDS.includes(ctx.reportId);

  const seeded = getTableFilterValues('reports');
  if (seeded) {
    ctx.reportId = seeded.reportId || '';
    ctx.salesGroup = seeded.salesGroup || 'item';
    ctx.location = seeded.location || '';
    ctx.supplierId = seeded.supplierId || '';
    ctx.recipientId = seeded.recipientId || '';
    ctx.dateFrom = seeded.dates?.from || '';
    ctx.dateTo = seeded.dates?.to || '';
    ctx.qtyMode = seeded.qtyMode || 'received';
    ctx.supplierView = seeded.supplierView || 'suppliers';
    ctx.printScope = seeded.printScope || 'all';
    ctx.rateSource = seeded.rateSource || 'menu';
  }
  if (ctx.reportId && !visibleReports(can).some((entry) => entry.id === ctx.reportId)) {
    ctx.reportId = '';
  }

  function stopCollab() {
    const session = ctx.collab;
    ctx.collab = null;
    session?.destroy();
  }

  function startCollab() {
    stopCollab();
    if (ctx.reportId !== 'clients') return;
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
    if (ctx.reportId === 'clients') {
      if (!ctx.clientReport) return;
      const { filename, content } = recipientTransferCsv(ctx.clientReport, ctx.event?.name);
      downloadBlob(filename, content);
      return;
    }
    if (ctx.reportId === 'suppliers') {
      if (!ctx.supplierReport) return;
      const { filename, content } = supplierDeliveryCostCsv(ctx.supplierReport, ctx.event?.name);
      downloadBlob(filename, content);
      return;
    }
    const register = currentRegister();
    if (!register) return;
    const entry = reportById(ctx.reportId);
    downloadBlob(`${fileStem(entry?.title || 'Report')}.csv`, register.csv);
    toast('CSV downloaded');
  }

  function reconRows() {
    if (!ctx.event) return [];
    return computeReconRows({
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
      cocktails: ctx.cocktails,
      menuItems: ctx.menuItems,
    });
  }

  function exportVolumeExcel() {
    if (!ctx.event) {
      toast('Event not loaded yet', true);
      return;
    }
    const rows = reconRows();

    if (!rows.length) {
      toast('No product data to export', true);
      return;
    }

    const eventName = (ctx.event?.name || 'event').replace(/[^\w\s.-]/g, '');
    const workbook = buildVolumeReportXlsx(rows, ctx.event?.name || 'Event');
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
    if (ctx.reportId !== 'clients') {
      toast('Open Transfers by client to export invoices', true);
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

  function fileStem(title) {
    const eventName = (ctx.event?.name || 'event').replace(/[^\w\s.-]/g, '');
    return `${eventName} ${title}`.trim();
  }

  function names() {
    const map = new Map();
    (ctx.products || []).forEach((p) => { if (p?.id) map.set(p.id, p.name || 'Product'); });
    (ctx.libraryProducts || []).forEach((p) => {
      if (p?.id && !map.has(p.id)) map.set(p.id, p.name || 'Product');
    });
    return map;
  }

  function productRecord(productId) {
    const ep = (ctx.event?.event_products || []).find((row) => row.product_id === productId);
    if (ep?.product) return ep.product;
    return (ctx.libraryProducts || []).find((p) => p.id === productId) || null;
  }

  function currentRegister() {
    const shared = {
      event: ctx.event,
      names: names(),
      dateFrom: ctx.dateFrom,
      dateTo: ctx.dateTo,
      supplierId: ctx.supplierId,
    };
    if (ctx.reportId === 'deliveries') return buildDeliveryRegister({ ...shared, deliveries: ctx.deliveries });
    if (ctx.reportId === 'wastage') {
      return buildWastageRegister({
        ...shared,
        batches: ctx.wastageBatches,
        caseSizes: ctx.caseSizes,
      });
    }
    if (ctx.reportId === 'counts') {
      return buildCountRegister({
        ...shared,
        sessions: ctx.countSessions,
        linesBySession: ctx.countLines,
      });
    }
    if (ctx.reportId === 'products') return buildProductRegister({ event: ctx.event });
    if (ctx.reportId === 'orders') {
      return buildOrderRegister({
        ...shared,
        orders: ctx.orders,
        suppliers: ctx.suppliers,
      });
    }
    if (ctx.reportId === 'transfers') {
      return buildTransferRegister({
        ...shared,
        transfers: ctx.transfers,
        warehouses: ctx.warehouses,
      });
    }
    if (ctx.reportId === 'closing') {
      return buildClosingRegister({ event: ctx.event, closingRows: ctx.closingRows });
    }
    return null;
  }

  function menuExportType() {
    if (ctx.reportId === 'menu-client') return 'client';
    if (ctx.reportId === 'menu-sor') return 'sor';
    return 'designer';
  }

  function menuModel() {
    return buildMenuExport(menuExportType(), {
      lines: ctx.menuLines,
      scenarios: ctx.menuScenarios,
      scenarioIds: ctx.menuScenarioIds,
      rateSource: ctx.rateSource || 'menu',
      includeInternal: !!ctx.includeInternal && isOrgAdmin() && menuExportType() === 'client',
    });
  }

  function allowedEntry() {
    const entry = reportById(ctx.reportId);
    if (!entry) return null;
    if (entry.feature && !can(entry.feature)) return null;
    return entry;
  }

  function syncChrome() {
    const entry = allowedEntry();
    if (!entry) {
      setTopbarToolbarStrips(null);
      setTopbarFilterSuppressed(true);
      return;
    }
    const items = (entry.formats || []).map((key) => {
      const spec = formatSpec(key);
      return spec ? {
        id: spec.action,
        icon: spec.icon,
        label: spec.menu,
        title: spec.menu,
      } : null;
    }).filter(Boolean);
    const printOnly = entry.formats.length === 1 && entry.formats[0] === 'print';
    setTopbarToolbarStrips(items.length ? [{
      id: 'data',
      label: printOnly ? 'Print' : 'Export',
      items: [{
        id: 'report-export',
        kind: 'menu',
        icon: printOnly ? 'printer' : 'download',
        label: printOnly ? 'Print' : 'Export',
        title: printOnly ? 'Print' : 'Export',
        items,
      }],
    }] : null);
    setTopbarFilterSuppressed(!entry.filters);
  }

  function selectReport(id) {
    const next = id || '';
    if (next && !visibleReports(can).some((entry) => entry.id === next)) return;
    ctx.reportId = next;
    patchTableFilterState('reports', { reportId: next });
    compute();
    paint();
  }

  function renderClientsBody() {
    const recipients = clientsWithTransfers();
    const report = ctx.clientReport || {
      recipientCount: 0, transferCount: 0, lineCount: 0, totalQty: 0, totalCost: 0, missingPriceCount: 0, recipientRows: [],
    };
    if (!recipients.length) {
      return emptyState({
        iconHtml: icon('arrow-left-right', { size: 22 }),
        title: 'No client transfers yet',
        copy: 'Log a transfer to a recipient (Artist Liaison, Production, etc.) on the Transfers page.',
        variant: 'admin',
      });
    }
    if (!ctx.recipientId) {
      return `
        ${renderClientStats(report)}
        ${emptyState({
          iconHtml: icon('funnel', { size: 22 }),
          title: 'Choose a client',
          copy: 'Open the filter menu and pick a client to see transfer detail and invoice pricing.',
          variant: 'admin',
        })}`;
    }
    return `
      ${renderClientStats(report)}
      <div class="reports-client-detail">${renderClientDetail(report)}</div>`;
  }

  function renderSuppliersBody() {
    const report = ctx.supplierReport || {
      deliveryCount: 0, lineCount: 0, totalQty: 0, totalCost: 0, missingPriceCount: 0, supplierCount: 0, supplierRows: [], deliveryRows: [],
    };
    const bySupplier = ctx.supplierView === 'suppliers';
    return `
      ${renderSupplierStats(report)}
      <section class="admin-surface projections-table-section">
        ${bySupplier ? renderSupplierTable(report) : renderDeliveryTable(report)}
      </section>`;
  }

  function renderVolumeBody() {
    if (!ctx.detailLoaded) return loadingWidget('Loading sales and recon…');
    const groups = volumeReportGroups(reconRows());
    const rows = groups.flatMap((group) => group.products.map((row) => ({
      cells: {
        category: group.category,
        product: row?.p?.name || 'Unnamed product',
        pack: row?.p?.case_size || '',
        plu: fmtQty(row.plu),
        uplift: fmtQty((Number(row.plu) || 0) * 1.05),
        consumption: fmtQty(row.consumption),
      },
    })));
    return renderDataTable({
      columns: [
        { key: 'category', label: 'Category' },
        { key: 'product', label: 'Product' },
        { key: 'pack', label: 'Case size' },
        { key: 'plu', label: 'PLU', num: true },
        { key: 'uplift', label: 'PLU + 5%', num: true },
        { key: 'consumption', label: 'Consumption', num: true },
      ],
      rows,
    }, { title: 'No product data', copy: 'Volume is built from this event’s products and recon.' });
  }

  function renderReconBody() {
    if (!ctx.detailLoaded) return loadingWidget('Loading sales and recon…');
    const titles = { red: 'Action needed', yellow: 'Review', green: 'Done', blue: 'None returned' };
    const rows = reconRows().filter((row) => !row.reconHidden).map((row) => ({
      cells: {
        status: titles[row.reconStatus] || '',
        item: row.p?.name || '',
        supplier: row.supplierName || '',
        delivered: fmtQty(row.delivered),
        closing: fmtQty(row.closingCases),
        consumption: fmtQty(row.consumption),
        variance: fmtQty(row.variance),
        budget: row.budgetCost != null ? fmtCost(row.budgetCost) : '',
      },
    }));
    return renderDataTable({
      columns: [
        { key: 'status', label: 'Status' },
        { key: 'item', label: 'Item' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'delivered', label: 'Delivered', num: true },
        { key: 'closing', label: 'Closing cases', num: true },
        { key: 'consumption', label: 'Consumption', num: true },
        { key: 'variance', label: 'Variance', num: true },
        { key: 'budget', label: 'Budget', num: true },
      ],
      rows,
    }, { title: 'Nothing to reconcile', copy: 'Add products to this event to build the recon.' });
  }

  function renderMenuOptions() {
    if (ctx.reportId !== 'menu-client' || !ctx.menuLoaded) return '';
    const checks = (ctx.menuScenarios || []).map((s) => `
      <label class="plan-check"><input type="checkbox" data-menu-scenario="${escapeHtml(s.id)}" ${ctx.menuScenarioIds.includes(s.id) ? 'checked' : ''}>
        ${escapeHtml(s.name || 'Scenario')}</label>`).join('');
    const internal = isOrgAdmin()
      ? `<label class="plan-check"><input type="checkbox" id="reportsInternal" ${ctx.includeInternal ? 'checked' : ''}>
          Include internal cost per serve and GP %</label>`
      : '';
    return `<div class="reports-menu-options">${checks || '<span class="muted">No pricing scenarios on this event.</span>'}${internal}</div>`;
  }

  function renderMenuBody() {
    if (!ctx.menuLoaded) return loadingWidget('Loading menu…');
    const model = menuModel();
    const columns = [
      { key: 'category', label: 'Category' },
      ...model.columns.map((col) => ({ key: col.key, label: col.label, num: !!(col.money || col.pct) })),
    ];
    const rows = model.groups.flatMap((group) => group.rows.map((row) => ({
      cells: {
        category: group.category,
        ...Object.fromEntries(model.columns.map((col) => [col.key, formatCell(cellValue(row, col), col)])),
      },
    })));
    const note = model.missingRates
      ? `<p class="muted">${model.missingRates} item${model.missingRates === 1 ? '' : 's'} ${menuExportType() === 'sor' ? 'left off — no rate' : 'without a menu price'}.</p>`
      : '';
    return `${renderMenuOptions()}${note}${renderDataTable({ columns, rows }, {
      title: 'Nothing on the menu',
      copy: 'Add products on Menu & GP before exporting.',
    })}`;
  }

  function renderPrintBody() {
    const scope = ctx.printScope || 'all';
    const label = scope === 'event'
      ? 'the whole event catalogue'
      : scope.startsWith('bar:')
        ? 'one location'
        : 'one sheet per location';
    const which = ctx.reportId === 'closing-sheets' ? 'closing count sheets' : 'count sheets';
    return `<p class="projections-lead muted">Prints blank ${which} for ${escapeHtml(label)}. Choose the scope in the filter menu.</p>`;
  }

  function renderAuditBody() {
    if (ctx.auditError) {
      return emptyState({
        iconHtml: icon('circle-alert', { size: 22 }),
        title: 'Audit failed',
        copy: ctx.auditError,
        variant: 'admin',
      });
    }
    if (!ctx.auditLoaded) return loadingWidget('Running forensic audit…');
    const report = ctx.auditReport;
    const summary = report?.summary || { errors: 0, warns: 0, infos: 0 };
    const rows = (report?.findings || []).map((f) => ({
      cells: {
        severity: f.severity || '',
        check: CHECK_META[f.checkId]?.label || f.checkId || '',
        product: f.productName || '',
        message: f.message || '',
      },
    }));
    return `
      <p class="muted">${summary.errors} errors · ${summary.warns} warnings · ${summary.infos} info</p>
      ${renderDataTable({
        columns: [
          { key: 'severity', label: 'Severity' },
          { key: 'check', label: 'Check' },
          { key: 'product', label: 'Product' },
          { key: 'message', label: 'Message' },
        ],
        rows,
      }, { title: 'No findings', copy: 'This audit run did not report any issues.' })}`;
  }

  function renderRegisterBody() {
    if (!ctx.detailLoaded) return loadingWidget('Loading event data…');
    const register = currentRegister();
    if (!register) return '';
    return renderDataTable(register, {
      title: 'Nothing to show',
      copy: 'Nothing on this event matches the current filters.',
    });
  }

  function renderActiveBody() {
    if (isInsight()) {
      insights.ensure(ctx.reportId, insightFilters());
      return ctx.detailLoaded
        ? insights.render(ctx.reportId, insightFilters())
        : loadingWidget('Loading sales and recon…');
    }
    if (ctx.reportId === 'clients') return renderClientsBody();
    if (ctx.reportId === 'suppliers') return renderSuppliersBody();
    if (ctx.reportId === 'volume') return renderVolumeBody();
    if (ctx.reportId === 'recon') return renderReconBody();
    if (ctx.reportId.startsWith('menu-')) return renderMenuBody();
    if (ctx.reportId === 'count-sheets' || ctx.reportId === 'closing-sheets') return renderPrintBody();
    if (ctx.reportId === 'audit') return renderAuditBody();
    return renderRegisterBody();
  }

  function paintLibrary() {
    const entries = visibleReports(can);
    root.innerHTML = renderReportLibrary(entries, ctx.search);
    initIcons(root);
    const input = root.querySelector('#reportsSearch');
    if (input) {
      input.oninput = () => {
        ctx.search = input.value;
        const body = root.querySelector('#reportsLibraryBody');
        const shell = document.createElement('div');
        shell.innerHTML = renderReportLibrary(entries, ctx.search);
        const next = shell.querySelector('#reportsLibraryBody');
        if (body && next) body.innerHTML = next.innerHTML;
        initIcons(body || root);
        bindReportCards();
      };
    }
    bindReportCards();
  }

  function bindReportCards() {
    root.querySelectorAll('[data-open-report]').forEach((btn) => {
      btn.onclick = () => selectReport(btn.dataset.openReport || '');
    });
  }

  function paint() {
    syncChrome();
    const entry = allowedEntry();
    if (!entry) {
      stopCollab();
      paintLibrary();
      return;
    }
    root.innerHTML = `${renderWorkspaceHead(entry)}${renderActiveBody()}`;
    initIcons(root);
    root.querySelector('[data-reports-back]')?.addEventListener('click', () => selectReport(''));
    root.querySelectorAll('[data-report-action]').forEach((btn) => {
      btn.onclick = () => {
        runExport(btn.dataset.reportAction, btn.dataset.reportRecord || '').catch((err) => {
          toast(err.message || 'Export failed', true);
        });
      };
    });
    root.querySelectorAll('[data-menu-scenario]').forEach((box) => {
      box.onchange = () => {
        const id = box.dataset.menuScenario;
        const set = new Set(ctx.menuScenarioIds);
        if (box.checked) set.add(id);
        else set.delete(id);
        ctx.menuScenarioIds = [...set];
        paint();
      };
    });
    const internal = root.querySelector('#reportsInternal');
    if (internal) {
      internal.onchange = () => {
        ctx.includeInternal = internal.checked;
        paint();
      };
    }
    if (isInsight()) insights.bind(root, ctx.reportId);
    else bind();
    if (ctx.reportId === 'clients') startCollab();
    else stopCollab();
    ensureExtras();
  }

  function pushFilterContext() {
    setTableFilterContext('reports', {
      recipients: clientsWithTransfers().map((r) => ({ id: r.id, name: r.name })),
      suppliers: (ctx.suppliers || []).map((s) => ({ value: s.id, label: s.name })),
      locations: insights.locations(),
      bars: (ctx.event?.bars || [])
        .filter((bar) => !isBoneYard(bar))
        .map((bar) => ({ id: bar.id, name: bar.name || 'Bar' })),
      scenarios: (ctx.menuScenarios || []).map((s) => ({ id: s.id, name: s.name || 'Scenario' })),
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

    const [deliveries, transfers, sales, recipes, wastage, closingRows, supplierReturns, mapping, orders, sessions, warehouses, barProducts] = await Promise.all([
      DB.deliveries.forEvent(ctx.eventId),
      DB.transfers.forEvent(ctx.eventId),
      loadSalesBundle(DB, ctx.event),
      loadRecipesFull().catch(() => []),
      DB.wastage.forEvent(ctx.eventId).catch(() => []),
      DB.closing.forEvent(ctx.eventId).catch(() => []),
      DB.supplierReturns.forEvent(ctx.eventId).catch(() => []),
      loadEventCocktailMapping(ctx.eventId).catch(() => ({ cocktails: [], menuItems: [] })),
      listPurchaseOrders(ctx.eventId).catch(() => []),
      DB.stockCounts.forEvent(ctx.eventId).catch(() => []),
      DB.warehouses.list().catch(() => []),
      DB.barProducts.forEvent(ctx.eventId).catch(() => []),
    ]);
    if (ctx.abort) return;
    const linePairs = await Promise.all((sessions || []).map(async (session) => {
      const lines = await DB.stockCounts.lines(session.id).catch(() => []);
      return [session.id, lines || []];
    }));
    if (ctx.abort) return;
    ctx.deliveries = deliveries || [];
    ctx.transfers = transfers || [];
    ctx.tillRows = sales.active.tillRows;
    ctx.modifierRows = sales.active.modifierRows;
    ctx.recipes = recipes || [];
    ctx.cocktails = mapping.cocktails;
    ctx.menuItems = mapping.menuItems;
    ctx.products = productsFromEvent(event);
    ctx.wastageBatches = wastage || [];
    ctx.closingRows = closingRows || [];
    ctx.supplierReturns = supplierReturns || [];
    ctx.orders = orders || [];
    ctx.countSessions = sessions || [];
    ctx.countLines = new Map(linePairs);
    ctx.warehouses = warehouses || [];
    ctx.barProducts = barProducts || [];
    ctx.detailLoaded = true;
    pushFilterContext();
    compute();
    paint();
  }

  async function loadMenuExport() {
    if (ctx.menuLoaded || ctx.menuLoading) return;
    ctx.menuLoading = true;
    try {
      const [event, items, products, cocktails, scenarios] = await Promise.all([
        loadEventPricing(ctx.eventId),
        listEventMenu(ctx.eventId),
        loadLibraryProducts(),
        listEventCocktails(ctx.eventId).catch((err) => (isCocktailSchemaMissing(err) ? [] : Promise.reject(err))),
        listScenarios(ctx.eventId).catch(() => []),
      ]);
      if (ctx.abort) return;
      const productById = new Map((products || []).map((p) => [p.id, p]));
      const grouped = groupMenuItems(items || []);
      const baseMap = new Map();
      grouped.forEach((list, pid) => {
        const base = baseMenuItem(list);
        if (base) baseMap.set(pid, { ...base, portion: 1 });
      });
      const lines = (items || []).map((item) => resolveMenuLine(item, {
        product: productById.get(item.product_id), event, caseSizes: ctx.caseSizes,
      }));
      (cocktails || []).forEach((cocktail) => {
        lines.push(resolveCocktailLine(cocktail, cocktail.ingredients, {
          productById, items: baseMap, caseSizes: ctx.caseSizes, event,
        }));
      });
      ctx.menuLines = lines;
      ctx.menuScenarios = scenarios || [];
      ctx.menuVatRate = lines.find((line) => line.included)?.vatRate ?? 0.2;
      if (!ctx.menuScenarioInit) {
        ctx.menuScenarioIds = (scenarios || []).filter((s) => s.client_visible).map((s) => s.id);
        ctx.menuScenarioInit = true;
      }
      ctx.menuLoaded = true;
    } catch (err) {
      ctx.menuLines = [];
      ctx.menuLoaded = true;
      toast(err.message || 'Couldn’t load the menu', true);
    } finally {
      ctx.menuLoading = false;
    }
  }

  async function loadAudit() {
    if (ctx.auditLoaded || ctx.auditLoading) return;
    ctx.auditLoading = true;
    ctx.auditError = null;
    const DB = getDB();
    try {
      const [
        event, caseSizes, products, suppliers, closing, sales,
        recipes, wastage, transfers, supplierReturns, deliveries, distRows, syncQueueStats,
        mapping,
      ] = await Promise.all([
        loadEventFull(ctx.eventId),
        loadCaseSizes(),
        loadLibraryProducts(),
        loadSuppliers(),
        DB.closing.forEvent(ctx.eventId),
        loadSalesBundle(DB, ctx.event),
        loadRecipesFull().catch(() => []),
        DB.wastage.forEvent(ctx.eventId).catch(() => []),
        DB.transfers.forEvent(ctx.eventId).catch(() => []),
        DB.supplierReturns.forEvent(ctx.eventId).catch(() => []),
        DB.deliveries.forEvent(ctx.eventId).catch(() => []),
        DB.distribution.forEvent(ctx.eventId).catch(() => []),
        getQueueStats().catch(() => ({ pending: 0, failed: 0, total: 0 })),
        loadEventCocktailMapping(ctx.eventId).catch(() => ({ cocktails: [], menuItems: [] })),
      ]);
      if (ctx.abort) return;
      const report = runEventAudit({
        event,
        eventId: ctx.eventId,
        caseSizes,
        products,
        suppliers,
        closingRows: closing || [],
        tillRows: sales.active.tillRows,
        modifierRows: sales.active.modifierRows,
        recipes: recipes || [],
        wastageBatches: wastage || [],
        transfers: transfers || [],
        supplierReturns: supplierReturns || [],
        deliveries: deliveries || [],
        distRows: distRows || [],
        bars: event?.bars || [],
        isBoneYard,
        syncQueueStats,
        cocktails: mapping.cocktails,
        menuItems: mapping.menuItems,
      });
      ctx.auditReport = {
        eventId: report.eventId,
        ranAt: report.ranAt,
        summary: report.summary,
        findings: report.findings,
      };
      ctx.auditLoaded = true;
    } catch (err) {
      ctx.auditError = err.message || 'Audit failed';
      ctx.auditLoaded = true;
    } finally {
      ctx.auditLoading = false;
    }
  }

  async function ensureExtras() {
    const id = ctx.reportId;
    if (!id || ctx.abort) return;
    let changed = false;
    if (id.startsWith('menu-') && !ctx.menuLoaded && !ctx.menuLoading) {
      await loadMenuExport();
      changed = true;
    }
    if (id === 'audit' && !ctx.auditLoaded && !ctx.auditLoading) {
      await loadAudit();
      changed = true;
    }
    if (id === 'orders' && !ctx.libraryLoaded) {
      ctx.libraryLoaded = true;
      try {
        ctx.libraryProducts = await loadLibraryProducts() || [];
        changed = true;
      } catch { /* names fall back to the event list */ }
    }
    if (ctx.abort || ctx.reportId !== id || !changed) return;
    pushFilterContext();
    paint();
  }

  function printTarget() {
    const raw = ctx.printScope || 'all';
    if (raw.startsWith('bar:')) return { scope: 'bar', barId: raw.slice(4) };
    return { scope: raw === 'event' ? 'event' : 'all', barId: '' };
  }

  async function runMenuExport(format) {
    if (!ctx.menuLoaded) {
      toast('Menu is still loading', true);
      return;
    }
    const model = menuModel();
    if (!model.count) {
      toast('Nothing on the menu to export', true);
      return;
    }
    const spec = await commitMenuExport({
      type: menuExportType(),
      format,
      model,
      scenarioIds: ctx.menuScenarioIds,
      rateSource: ctx.rateSource,
      event: ctx.event,
      eventId: ctx.eventId,
      vatRate: ctx.menuVatRate,
    });
    toast(`${spec.label} exported`);
  }

  async function runPurchaseOrderPdf(id) {
    const row = (currentRegister()?.rows || []).find((item) => item.id === id);
    if (!row?.po) {
      toast('That order is not in this report', true);
      return;
    }
    const supplier = (ctx.suppliers || []).find((s) => s.id === row.po.supplier_id) || null;
    const lines = (row.po.purchase_order_lines || []).map((line) => {
      const product = productRecord(line.product_id);
      const offer = findOfferForSupplier(product, row.po.supplier_id);
      return {
        name: product?.name || names().get(line.product_id) || 'Product',
        pack: offer?.pack_size || product?.case_size || '',
        qty_cases: line.qty_cases,
        case_price: line.case_price,
      };
    });
    await generatePurchaseOrderPDF({ po: row.po, supplier, event: ctx.event, lines });
    toast('Purchase order downloaded');
  }

  async function runDeliveryNote(id) {
    const transfer = (ctx.transfers || []).find((item) => item.id === id);
    if (!transfer) {
      toast('That transfer is not in this report', true);
      return;
    }
    const ends = transferEnds(transfer, ctx.event, ctx.warehouses);
    await generateDeliveryNotePDF({
      eventName: ctx.event?.name || '',
      recipientName: ends.to,
      date: transfer.transferred_at ? new Date(transfer.transferred_at) : new Date(),
      lines: (transfer.lines || []).map((line) => ({
        productId: line.product_id,
        cases: Number(line.qty) || 0,
        singles: Number(line.singles) || 0,
      })),
      productInfo: (productId) => {
        const product = productRecord(productId);
        return { name: product?.name || 'Product', size: product?.case_size || '' };
      },
    });
    toast('Delivery note downloaded');
  }

  async function runPalletSticker(id) {
    const row = (currentRegister()?.rows || []).find((item) => item.id === id);
    const sticker = row?.sticker;
    if (!sticker?.cases) {
      toast('No closing cases to print', true);
      return;
    }
    await generatePalletStickerPDF({
      destinationLabel: 'Warehouse',
      productName: sticker.productName,
      caseSize: sticker.caseSize,
      pallets: [sticker.cases],
    });
    toast('Pallet sticker downloaded');
  }

  function runPrintSheets() {
    if (!ctx.event) {
      toast('Event is still loading', true);
      return;
    }
    const { scope, barId } = printTarget();
    const run = ctx.reportId === 'closing-sheets' ? printClosingCountSheet : printCountSheets;
    const result = run({
      event: ctx.event,
      barProducts: ctx.barProducts,
      caseSizes: ctx.caseSizes,
      scope,
      barId,
    });
    if (result?.error) {
      toast(result.error, true);
      return;
    }
    toast('Print window opened');
  }

  async function runExport(action, recordId = '') {
    if (action === 'export-csv' || action === 'export-reports') {
      if (ctx.reportId === 'recon') {
        const rows = reconRows().filter((row) => !row.reconHidden);
        downloadBlob(`${fileStem('Post Event Recon')}.csv`, reconCsv(rows));
        toast('CSV downloaded');
        return;
      }
      if (isInsight()) {
        insights.exportCsv(ctx.reportId, insightFilters());
        return;
      }
      if (String(ctx.reportId).startsWith('menu-')) {
        await runMenuExport('csv');
        return;
      }
      exportCsv();
      return;
    }
    if (action === 'export-pdf' || action === 'export-report-pdf') {
      if (isInsight()) {
        await insights.exportPdf(ctx.reportId, insightFilters());
        return;
      }
      if (String(ctx.reportId).startsWith('menu-')) await runMenuExport('pdf');
      return;
    }
    if (action === 'export-xlsx' || action === 'export-volume') {
      if (ctx.reportId === 'volume') {
        exportVolumeExcel();
        return;
      }
      if (String(ctx.reportId).startsWith('menu-')) await runMenuExport('xlsx');
    }
    if (action === 'export-invoice') {
      await exportInvoice(recordId || currentRecipientFilter());
      return;
    }
    if (action === 'export-json') {
      if (!ctx.auditReport) {
        toast('Audit is still running', true);
        return;
      }
      downloadBlob(
        auditExportFilename(ctx.auditReport, ctx.eventId),
        JSON.stringify(auditExportDocument(ctx.auditReport), null, 2),
        'application/json',
      );
      toast('JSON downloaded');
      return;
    }
    if (action === 'export-print') {
      runPrintSheets();
      return;
    }
    if (action === 'po-pdf') {
      await runPurchaseOrderPdf(recordId);
      return;
    }
    if (action === 'delivery-note') {
      await runDeliveryNote(recordId);
      return;
    }
    if (action === 'pallet-sticker') await runPalletSticker(recordId);
  }

  function onToolbar(e) {
    const action = e.detail?.action;
    const known = new Set([
      'export-csv', 'export-pdf', 'export-xlsx', 'export-invoice', 'export-json', 'export-print',
      'export-reports', 'export-report-pdf', 'export-volume',
    ]);
    if (!known.has(action)) return;
    e.detail.handled = true;
    runExport(action).catch((err) => toast(err.message || 'Export failed', true));
  }

  function onTableFilter(e) {
    if (e.detail?.panel !== 'reports') return;
    const values = e.detail?.values;
    if (!values) return;
    const nextId = values.reportId || '';
    ctx.reportId = nextId && visibleReports(can).some((entry) => entry.id === nextId) ? nextId : '';
    ctx.supplierId = values.supplierId || '';
    ctx.recipientId = values.recipientId || '';
    ctx.dateFrom = values.dates?.from || '';
    ctx.dateTo = values.dates?.to || '';
    ctx.qtyMode = values.qtyMode || 'received';
    ctx.supplierView = values.supplierView || 'suppliers';
    ctx.salesGroup = values.salesGroup || 'item';
    ctx.location = values.location || '';
    ctx.printScope = values.printScope || 'all';
    ctx.rateSource = values.rateSource || 'menu';
    compute();
    paint();
  }

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  syncChrome();
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
    setTopbarToolbarStrips(null);
    setTopbarFilterSuppressed(false);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
