/**
 * Reports — supplier delivery cost + internal transfers by client.
 */

import { $, escapeHtml, toast, formatMoney, fmtDateTime } from '../../lib/util.js';
import { getDB, loadEventFull, loadCaseSizes, loadSuppliers } from '../../db.js';
import {
  buildSupplierDeliveryCostReport,
  supplierDeliveryCostCsv,
} from '../../lib/supplier-delivery-cost.js';
import {
  buildRecipientTransferReport,
  recipientTransferCsv,
} from '../../lib/recipient-transfer-report.js';
import { generateRecipientInvoicePDF } from '../../lib/recipient-invoice-pdf.js';
import { icon, initIcons } from '../../lib/icons.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';

function fmtQty(n) {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

function fmtCost(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function supplierOptions(suppliers, selected) {
  return `<option value="">All suppliers</option>${
    (suppliers || []).map((s) => `
      <option value="${escapeHtml(s.id)}"${s.id === selected ? ' selected' : ''}>
        ${escapeHtml(s.name)}
      </option>`).join('')
  }`;
}

function recipientOptions(recipients, selected) {
  return `<option value="">All clients</option>${
    (recipients || []).map((r) => `
      <option value="${escapeHtml(r.id)}"${r.id === selected ? ' selected' : ''}>
        ${escapeHtml(r.name)}
      </option>`).join('')
  }`;
}

export function renderReportsShell() {
  return `
    <div class="admin-page reports-page" id="reportsPanel">
      <div class="mod-loading muted">Loading reports…</div>
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
    clientReport: null,
  };

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
    ctx.clientReport = buildRecipientTransferReport({
      transfers: ctx.transfers,
      event: ctx.event,
      caseSizes: ctx.caseSizes,
      recipientId: ctx.recipientId,
      dateFrom: ctx.dateFrom,
      dateTo: ctx.dateTo,
    });
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

  function downloadBlob(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
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

  async function exportInvoice(recipientId = '') {
    if (ctx.reportKind !== 'clients') {
      toast('Switch to Clients to export invoices', true);
      return;
    }
    const report = ctx.clientReport;
    if (!report?.recipientRows?.length) {
      toast('No client transfers to invoice', true);
      return;
    }
    const rows = recipientId
      ? report.recipientRows.filter((r) => r.recipientId === recipientId)
      : report.recipientRows;
    if (!rows.length) {
      toast('Client not found in this report', true);
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
    return `
      <div class="wst-stats reports-stats">
        <div class="wst-stat">
          <span class="wst-stat-label">Total cost</span>
          <span class="wst-stat-value">${escapeHtml(formatMoney(report.totalCost || 0))}</span>
          <span class="wst-stat-label muted">at event / offer price</span>
        </div>
        <div class="wst-stat">
          <span class="wst-stat-label">Clients</span>
          <span class="wst-stat-value">${report.recipientCount}</span>
          <span class="wst-stat-label muted">with transfers out</span>
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
      return '<div class="del-empty">No supplier deliveries match these filters.</div>';
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
      return '<div class="del-empty">No supplier deliveries match these filters.</div>';
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

  function renderClientList(report) {
    if (!report.recipientRows.length) {
      return `<div class="del-empty">No internal transfers to clients yet. Log a transfer to a recipient (Artist Liaison, Production, etc.) on the Transfers page.</div>`;
    }

    return report.recipientRows.map((r) => `
      <article class="del-card reports-client-card">
        <div class="del-card-main del-card-main--stacked">
          <div class="del-card-head">
            <div class="del-card-body">
              <h3 class="del-card-title">${escapeHtml(r.recipientName)}</h3>
              <p class="del-card-meta">
                ${r.transferCount} transfer${r.transferCount !== 1 ? 's' : ''}
                · ${r.products.length} product${r.products.length !== 1 ? 's' : ''}
                · ${escapeHtml(fmtQty(r.totalQty))} total qty
              </p>
            </div>
            <div class="reports-client-cost">
              <span class="reports-client-cost-value">${escapeHtml(fmtCost(r.totalCost))}</span>
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
                  <th class="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                ${r.products.map((p) => `
                  <tr>
                    <td>${escapeHtml(p.productName)}</td>
                    <td class="num">${escapeHtml(p.qtyLabel)}</td>
                    <td class="num reports-cost">${
                      p.missingPrice
                        ? '<span class="reports-miss">No price</span>'
                        : escapeHtml(fmtCost(p.cost))
                    }</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${r.transfers.length ? `
            <details class="reports-client-transfers">
              <summary>Transfer history (${r.transferCount})</summary>
              <ul class="reports-xfer-list">
                ${r.transfers.map((t) => `
                  <li>
                    <span class="reports-xfer-date">${escapeHtml(fmtDateTime(t.transferredAt))} · ${escapeHtml(fmtCost(t.totalCost))}</span>
                    <span class="reports-xfer-items">${escapeHtml(
                      t.lines.map((l) => `${l.productName} (${fmtQty(l.qty)})`).join(', '),
                    )}</span>
                  </li>`).join('')}
              </ul>
            </details>` : ''}
        </div>
      </article>`).join('');
  }

  function bind() {
    const supplier = $('rptSupplier');
    const recipient = $('rptRecipient');
    const dateFrom = $('rptDateFrom');
    const dateTo = $('rptDateTo');

    if (supplier) {
      supplier.onchange = () => {
        ctx.supplierId = supplier.value || '';
        compute();
        paint();
      };
    }
    if (recipient) {
      recipient.onchange = () => {
        ctx.recipientId = recipient.value || '';
        compute();
        paint();
      };
    }
    if (dateFrom) {
      dateFrom.onchange = () => {
        ctx.dateFrom = dateFrom.value || '';
        compute();
        paint();
      };
    }
    if (dateTo) {
      dateTo.onchange = () => {
        ctx.dateTo = dateTo.value || '';
        compute();
        paint();
      };
    }

    root.querySelectorAll('.projections-filter-btn[data-report-kind]').forEach((btn) => {
      btn.onclick = () => {
        ctx.reportKind = btn.dataset.reportKind || 'clients';
        paint();
      };
    });
    root.querySelectorAll('.projections-filter-btn[data-qty-mode]').forEach((btn) => {
      btn.onclick = () => {
        ctx.qtyMode = btn.dataset.qtyMode || 'received';
        compute();
        paint();
      };
    });
    root.querySelectorAll('.projections-filter-btn[data-supplier-view]').forEach((btn) => {
      btn.onclick = () => {
        ctx.supplierView = btn.dataset.supplierView || 'suppliers';
        paint();
      };
    });
    root.querySelectorAll('[data-invoice-recipient]').forEach((btn) => {
      btn.onclick = () => {
        exportInvoice(btn.dataset.invoiceRecipient || '');
      };
    });
  }

  function paint() {
    const isClients = ctx.reportKind === 'clients';
    const recipients = (ctx.event?.recipients || [])
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    let body = '';
    let lead = '';
    let filters = '';

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
      lead = 'Cost of stock transferred out to clients (Artist Liaison, Production, etc.), priced from each product’s event override or preferred supplier offer.';
      filters = `
        <label class="reports-filter-field">
          <span class="admin-label">Client</span>
          <select id="rptRecipient" class="admin-select lib-filter">${recipientOptions(recipients, ctx.recipientId)}</select>
        </label>
        <label class="reports-filter-field">
          <span class="admin-label">From</span>
          <input type="date" id="rptDateFrom" class="admin-input reports-date" value="${escapeHtml(ctx.dateFrom)}">
        </label>
        <label class="reports-filter-field">
          <span class="admin-label">To</span>
          <input type="date" id="rptDateTo" class="admin-input reports-date" value="${escapeHtml(ctx.dateTo)}">
        </label>`;
      body = `
        ${renderClientStats(report)}
        <div class="del-list reports-client-list">${renderClientList(report)}</div>`;
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
      const invoiced = ctx.qtyMode === 'invoiced';
      lead = 'Total cost of stock transferred in from suppliers (deliveries), priced from each delivery’s supplier offer or event price override.';
      filters = `
        <label class="reports-filter-field">
          <span class="admin-label">Supplier</span>
          <select id="rptSupplier" class="admin-select lib-filter">${supplierOptions(ctx.suppliers, ctx.supplierId)}</select>
        </label>
        <label class="reports-filter-field">
          <span class="admin-label">From</span>
          <input type="date" id="rptDateFrom" class="admin-input reports-date" value="${escapeHtml(ctx.dateFrom)}">
        </label>
        <label class="reports-filter-field">
          <span class="admin-label">To</span>
          <input type="date" id="rptDateTo" class="admin-input reports-date" value="${escapeHtml(ctx.dateTo)}">
        </label>
        <div class="projections-filter" role="tablist" aria-label="Quantity basis">
          <button type="button" class="projections-filter-btn${invoiced ? '' : ' is-active'}" data-qty-mode="received" role="tab" aria-selected="${!invoiced}">Received</button>
          <button type="button" class="projections-filter-btn${invoiced ? ' is-active' : ''}" data-qty-mode="invoiced" role="tab" aria-selected="${invoiced}">Invoiced</button>
        </div>
        <div class="projections-filter" role="tablist" aria-label="Report view">
          <button type="button" class="projections-filter-btn${bySupplier ? ' is-active' : ''}" data-supplier-view="suppliers" role="tab" aria-selected="${bySupplier}">By supplier</button>
          <button type="button" class="projections-filter-btn${bySupplier ? '' : ' is-active'}" data-supplier-view="deliveries" role="tab" aria-selected="${!bySupplier}">By delivery</button>
        </div>`;
      body = `
        ${renderSupplierStats(report)}
        <section class="admin-surface projections-table-section">
          ${bySupplier ? renderSupplierTable(report) : renderDeliveryTable(report)}
        </section>`;
    }

    root.innerHTML = `
      <div class="projections-filter reports-kind" role="tablist" aria-label="Report type">
        <button type="button" class="projections-filter-btn${isClients ? ' is-active' : ''}" data-report-kind="clients" role="tab" aria-selected="${isClients}">Transfers by client</button>
        <button type="button" class="projections-filter-btn${isClients ? '' : ' is-active'}" data-report-kind="suppliers" role="tab" aria-selected="${!isClients}">Supplier delivery cost</button>
      </div>
      <p class="projections-lead muted">${escapeHtml(lead)}</p>
      <div class="projections-toolbar reports-toolbar">${filters}</div>
      ${body}`;
    initIcons(root);
    bind();
  }

  async function reload() {
    const DB = getDB();
    const [event, deliveries, transfers, caseSizes, suppliers] = await Promise.all([
      loadEventFull(ctx.eventId),
      DB.deliveries.forEvent(ctx.eventId),
      DB.transfers.forEvent(ctx.eventId),
      loadCaseSizes(),
      loadSuppliers(),
    ]);
    if (ctx.abort) return;
    ctx.event = event;
    ctx.deliveries = deliveries || [];
    ctx.transfers = transfers || [];
    ctx.caseSizes = caseSizes || [];
    ctx.suppliers = (suppliers || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
      exportInvoice();
    }
  }

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);

  reload().catch((err) => {
    root.innerHTML = `<div class="dist-empty del-empty--err">${escapeHtml(err.message || 'Failed to load reports')}</div>`;
    toast(err.message || 'Failed to load reports', true);
  });

  return () => {
    ctx.abort = true;
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
  };
}
