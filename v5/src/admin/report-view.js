/**
 * Presentational pieces for the Reports library and report workspace.
 */

import { escapeHtml } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { emptyState } from '../components/empty-state.js';
import { REPORT_GROUPS, formatSpec } from './report-catalog.js';

function formatChips(formats) {
  return (formats || []).map((key) => {
    const spec = formatSpec(key);
    if (!spec) return '';
    return `<span class="reports-format reports-format--${escapeHtml(key)}">${escapeHtml(spec.label)}</span>`;
  }).join('');
}

function readyDot(entry) {
  if (!entry?.ready) return '';
  return `<span class="reports-ready-dot" title="Ready for live" aria-label="Ready for live"></span>`;
}

function reportCard(entry) {
  return `
    <button type="button" class="reports-card" data-open-report="${escapeHtml(entry.id)}">
      <span class="reports-card-icon">${icon(entry.icon || 'file-text', { size: 18 })}</span>
      <span class="reports-card-body">
        <span class="reports-card-title">${escapeHtml(entry.title)}${readyDot(entry)}</span>
        <span class="reports-card-copy">${escapeHtml(entry.description)}</span>
        <span class="reports-card-formats">${formatChips(entry.formats)}</span>
      </span>
      <span class="reports-card-go" aria-hidden="true">${icon('chevron-right', { size: 16 })}</span>
    </button>`;
}

export function renderReportLibrary(entries, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const matched = (entries || []).filter((entry) => {
    if (!q) return true;
    const formats = (entry.formats || []).map((key) => formatSpec(key)?.label || key).join(' ');
    return `${entry.title} ${entry.description} ${entry.group} ${formats}`.toLowerCase().includes(q);
  });
  const groups = REPORT_GROUPS
    .map((group) => ({ group, entries: matched.filter((entry) => entry.group === group) }))
    .filter((group) => group.entries.length);

  const meta = q && matched.length
    ? `<p class="reports-search-meta muted">${matched.length} report${matched.length === 1 ? '' : 's'}</p>`
    : '';
  const body = groups.length
    ? `${meta}${groups.map((group) => `
        <section class="reports-group">
          <header class="reports-group-head">
            <h2 class="reports-group-title">${escapeHtml(group.group)}</h2>
            <span class="reports-group-count">${group.entries.length}</span>
            <span class="reports-group-rule" aria-hidden="true"></span>
          </header>
          <div class="reports-card-grid">
            ${group.entries.map(reportCard).join('')}
          </div>
        </section>`).join('')}`
    : emptyState({
      iconHtml: icon('search', { size: 22 }),
      title: q ? 'No matching reports' : 'No reports available',
      copy: q ? 'Try a different name.' : 'Nothing on this page is enabled for your role.',
      variant: 'admin',
    });

  return `
    <div class="reports-library">
      <div class="reports-library-head">
        <div class="reports-library-intro">
          <h2 class="reports-library-title">Reports</h2>
          <p class="projections-lead muted">Preview a report, adjust its filters, then download it.</p>
        </div>
        <label class="reports-search">
          <span class="reports-search-icon">${icon('search', { size: 15 })}</span>
          <input type="search" class="admin-input" id="reportsSearch" value="${escapeHtml(query)}" placeholder="Search reports" autocomplete="off" aria-label="Search reports" spellcheck="false">
        </label>
      </div>
      <div id="reportsLibraryBody" class="reports-library-body">${body}</div>
    </div>`;
}

export function renderClientPicker(clients, selectedId = '') {
  const list = clients || [];
  if (!list.length) return '';
  const options = [
    '<option value="">Choose a client</option>',
    ...list.map((client) => {
      const id = client.id || '';
      const selected = String(id) === String(selectedId || '') ? ' selected' : '';
      return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(client.name || 'Unnamed')}</option>`;
    }),
  ].join('');
  return `
    <label class="reports-client-picker">
      <span class="admin-label">Client</span>
      <select class="admin-select" id="rptRecipient">${options}</select>
    </label>`;
}

export function renderWorkspaceHead(entry, { controls = '' } = {}) {
  const actions = (entry.formats || []).map((key) => {
    const spec = formatSpec(key);
    if (!spec) return '';
    return `<button type="button" class="topbar-tool topbar-tool--label" data-report-action="${escapeHtml(spec.action)}" title="${escapeHtml(spec.menu)}">
      ${icon(spec.icon, { size: 16 })}
      <span>${escapeHtml(spec.menu)}</span>
    </button>`;
  }).join('');
  return `
    <div class="reports-workspace-head admin-surface">
      <button type="button" class="reports-back" data-reports-back>
        ${icon('arrow-left', { size: 15 })}
        <span>All reports</span>
      </button>
      <div class="reports-workspace-main">
        <span class="reports-card-icon">${icon(entry.icon || 'file-text', { size: 18 })}</span>
        <div class="reports-workspace-copy">
          <h2 class="reports-workspace-title">${escapeHtml(entry.title)}${readyDot(entry)}</h2>
          <p class="projections-lead muted">${escapeHtml(entry.description)}</p>
        </div>
        <div class="reports-workspace-controls">
          ${controls}
          <div class="reports-export-actions">${actions}</div>
        </div>
      </div>
    </div>`;
}

export function renderDataTable(model, empty) {
  const rows = model?.rows || [];
  if (!rows.length) {
    return emptyState({
      iconHtml: icon('search', { size: 22 }),
      title: empty?.title || 'Nothing to show',
      copy: empty?.copy || 'Nothing matches these filters.',
      variant: 'admin',
    });
  }
  const columns = model.columns || [];
  const hasAction = rows.some((row) => row.action);
  return `
    <section class="admin-surface projections-table-section">
      <div class="dash-table-wrap">
        <table class="catalog-table dash-table reports-table">
          <thead>
            <tr>
              ${columns.map((col) => `<th${col.num ? ' class="num"' : ''}>${escapeHtml(col.label)}</th>`).join('')}
              ${hasAction ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${columns.map((col) => tableCell(col, row.cells?.[col.key])).join('')}
                ${row.action ? `<td class="reports-row-action"><button type="button" class="topbar-tool topbar-tool--label" data-report-action="${escapeHtml(row.action)}" data-report-record="${escapeHtml(row.id || '')}">${escapeHtml(actionLabel(row.action))}</button></td>` : (hasAction ? '<td></td>' : '')}
              </tr>`).join('')}
          </tbody>
          ${model.footer ? `
            <tfoot>
              <tr class="reports-total-row">
                ${columns.map((col) => tableCell(col, model.footer[col.key], true)).join('')}
                ${hasAction ? '<td></td>' : ''}
              </tr>
            </tfoot>` : ''}
        </table>
      </div>
    </section>`;
}

function tableCell(col, value, blankEmpty = false) {
  const empty = value == null || value === '';
  const cls = [col.num ? 'num' : '', col.money ? 'reports-cost' : ''].filter(Boolean).join(' ');
  const attr = cls ? ` class="${cls}"` : '';
  if (empty) {
    return blankEmpty ? `<td${attr}></td>` : `<td${attr}><span class="muted">—</span></td>`;
  }
  return `<td${attr}>${escapeHtml(String(value))}</td>`;
}

export function renderTransferTable(model, empty) {
  const rows = model?.rows || [];
  if (!rows.length) {
    return emptyState({
      iconHtml: icon('search', { size: 22 }),
      title: empty?.title || 'Nothing to show',
      copy: empty?.copy || 'Nothing matches these filters.',
      variant: 'admin',
    });
  }
  return `
    <section class="admin-surface projections-table-section">
      <div class="dash-table-wrap">
        <table class="catalog-table dash-table reports-table reports-xfer-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Route</th>
              <th>Product</th>
              <th class="num">Quantity</th>
              <th class="reports-xfer-action"></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, index) => transferGroup(row, index)).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

function transferGroup(row, index) {
  const lines = row.lines?.length ? row.lines : [{ name: '', qty: '' }];
  const span = lines.length;
  const alt = index % 2 === 1 ? ' reports-xfer-alt' : '';
  const count = span > 1
    ? `<div class="reports-xfer-count muted">${span} products${row.totalQty ? ` · ${escapeHtml(row.totalQty)}` : ''}</div>`
    : '';
  const action = row.action
    ? `<button type="button" class="topbar-tool topbar-tool--label" data-report-action="${escapeHtml(row.action)}" data-report-record="${escapeHtml(row.id || '')}">${escapeHtml(actionLabel(row.action))}</button>`
    : '';
  return lines.map((line, i) => {
    const edge = i === lines.length - 1 ? ' reports-xfer-end' : '';
    const kind = i === 0 ? 'reports-xfer-start' : 'reports-xfer-more';
    const product = line.name
      ? escapeHtml(line.name)
      : '<span class="muted">—</span>';
    const qty = line.qty
      ? escapeHtml(line.qty)
      : '<span class="muted">—</span>';
    return `
      <tr class="${kind}${edge}${alt}">
        ${i === 0 ? `
          <td class="reports-xfer-when-cell" rowspan="${span}">
            <div class="reports-xfer-when">${escapeHtml(row.when || '')}</div>
          </td>
          <td class="reports-xfer-route-cell" rowspan="${span}">
            <div class="reports-xfer-route">
              <span class="reports-xfer-from">${escapeHtml(row.from || '')}</span>
              <span class="reports-xfer-arrow" aria-hidden="true">→</span>
              <span class="reports-xfer-to">${escapeHtml(row.to || '')}</span>
            </div>
            ${count}
          </td>` : ''}
        <td class="reports-xfer-product">${product}</td>
        <td class="reports-xfer-qty num">${qty}</td>
        ${i === 0 ? `<td class="reports-row-action" rowspan="${span}">${action}</td>` : ''}
      </tr>`;
  }).join('');
}

function actionLabel(action) {
  if (action === 'po-pdf') return 'PDF';
  if (action === 'delivery-note') return 'Delivery note';
  if (action === 'pallet-sticker') return 'Pallet sticker';
  return 'Download';
}
