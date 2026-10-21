/**
 * Presentational pieces for the Reports library and report workspace.
 */

import { escapeHtml } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { emptyState } from '../components/empty-state.js';
import { REPORT_GROUPS, formatSpec } from './report-catalog.js';

function formatLabels(formats) {
  return (formats || [])
    .map((key) => formatSpec(key)?.label)
    .filter(Boolean)
    .join(' · ');
}

export function renderReportLibrary(entries, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const matched = (entries || []).filter((entry) => {
    if (!q) return true;
    return `${entry.title} ${entry.description} ${entry.group}`.toLowerCase().includes(q);
  });
  const groups = REPORT_GROUPS
    .map((group) => ({ group, entries: matched.filter((entry) => entry.group === group) }))
    .filter((group) => group.entries.length);

  const body = groups.length
    ? groups.map((group) => `
        <section class="reports-group">
          <h2 class="reports-group-title">${escapeHtml(group.group)}</h2>
          <div class="reports-card-grid">
            ${group.entries.map((entry) => `
              <button type="button" class="reports-card" data-open-report="${escapeHtml(entry.id)}">
                <span class="reports-card-title">${escapeHtml(entry.title)}</span>
                <span class="reports-card-copy">${escapeHtml(entry.description)}</span>
                <span class="reports-card-formats">${escapeHtml(formatLabels(entry.formats))}</span>
              </button>`).join('')}
          </div>
        </section>`).join('')
    : emptyState({
      iconHtml: icon('search', { size: 22 }),
      title: q ? 'No matching reports' : 'No reports available',
      copy: q ? 'Try a different name.' : 'Nothing on this page is enabled for your role.',
      variant: 'admin',
    });

  return `
    <div class="reports-library">
      <div class="reports-library-head">
        <div>
          <h2 class="reports-library-title">Reports</h2>
          <p class="projections-lead muted">Pick a report, set its filters, then download it. The export buttons on other pages are unchanged.</p>
        </div>
        <label class="reports-search">
          <span class="admin-label">Search</span>
          <input type="search" class="admin-input" id="reportsSearch" value="${escapeHtml(query)}" placeholder="Search reports" autocomplete="off">
        </label>
      </div>
      <div id="reportsLibraryBody">${body}</div>
    </div>`;
}

export function renderWorkspaceHead(entry) {
  const actions = (entry.formats || []).map((key) => {
    const spec = formatSpec(key);
    if (!spec) return '';
    return `<button type="button" class="topbar-tool topbar-tool--label" data-report-action="${escapeHtml(spec.action)}" title="${escapeHtml(spec.menu)}">
      ${icon(spec.icon, { size: 16 })}
      <span>${escapeHtml(spec.menu)}</span>
    </button>`;
  }).join('');
  return `
    <div class="reports-workspace-head">
      <button type="button" class="reports-back" data-reports-back>
        ${icon('arrow-left', { size: 16 })}
        <span>All reports</span>
      </button>
      <div class="reports-workspace-copy">
        <h2 class="reports-workspace-title">${escapeHtml(entry.title)}</h2>
        <p class="projections-lead muted">${escapeHtml(entry.description)}</p>
      </div>
      <div class="reports-export-actions">${actions}</div>
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

function tableCell(col, value, footer = false) {
  const empty = value == null || value === '';
  const cls = [col.num ? 'num' : '', col.money ? 'reports-cost' : ''].filter(Boolean).join(' ');
  const attr = cls ? ` class="${cls}"` : '';
  if (empty) {
    return footer ? `<td${attr}></td>` : `<td${attr}><span class="muted">—</span></td>`;
  }
  return `<td${attr}>${escapeHtml(String(value))}</td>`;
}

function actionLabel(action) {
  if (action === 'po-pdf') return 'PDF';
  if (action === 'delivery-note') return 'Delivery note';
  if (action === 'pallet-sticker') return 'Pallet sticker';
  return 'Download';
}
