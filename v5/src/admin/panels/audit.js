/**
 * Forensic Audit — software integrity checks (dual-writes, formula drift, sync).
 */

import { $, escapeHtml, toast, isBoneYard } from '../../lib/util.js';
import { initIcons } from '../../lib/icons.js';
import {
  getDB, loadEventFull, loadCaseSizes, loadLibraryProducts, loadSuppliers,
} from '../../db.js';
import { getQueueStats } from '../../sync-queue.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
} from '../table-filter.js';
import { hrefForRoute } from '../router.js';
import {
  CHECK_META,
  filterFindings,
  runEventAudit,
} from '../../lib/forensics.js';

function fmtVal(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return String(v);
}

function severityLabel(s) {
  if (s === 'error') return 'Error';
  if (s === 'warn') return 'Warn';
  return 'Info';
}

function downloadJson(report, eventId) {
  const payload = {
    eventId: report.eventId,
    ranAt: report.ranAt,
    summary: report.summary,
    findings: report.findings.map((f) => ({
      id: f.id,
      checkId: f.checkId,
      severity: f.severity,
      productId: f.productId,
      productName: f.productName,
      expected: f.expected,
      actual: f.actual,
      delta: f.delta,
      message: f.message,
      fixHint: f.fixHint,
      relatedPanel: f.relatedPanel,
      detail: f.detail,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `forensic-audit-${eventId || 'event'}-${(report.ranAt || '').slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function renderAuditShell() {
  return `
    <div class="admin-page audit-page" id="auditPanel">
      ${loadingWidget('Loading forensic audit…')}
    </div>`;
}

export function mountAuditPanel(route) {
  const root = $('auditPanel');
  if (!root) return () => {};

  const eventId = route.eventId || '';
  if (!eventId) {
    root.innerHTML = `
      <div class="admin-surface admin-not-found">
        <h2>Pick an event first</h2>
        <p class="muted">Software integrity audit for the active event workspace.</p>
        <a class="admin-drawer-btn admin-drawer-btn--primary" href="${escapeHtml(hrefForRoute({ view: 'home' }))}">Back to events</a>
        <a class="admin-drawer-btn admin-drawer-btn--solid" href="${escapeHtml(hrefForRoute({ view: 'dev' }))}">Dev tools</a>
      </div>`;
    return () => {};
  }

  const ctx = {
    eventId,
    abort: false,
    report: null,
    severity: '',
    checkId: '',
    query: '',
    expanded: new Set(),
  };

  const seeded = getTableFilterValues('audit');
  if (seeded) {
    ctx.severity = seeded.severity || '';
    ctx.checkId = seeded.check || '';
    ctx.query = seeded.query || '';
  }

  function summaryChips(summary) {
    const s = summary || { errors: 0, warns: 0, infos: 0 };
    return `
      <div class="audit-summary" role="status">
        <span class="audit-chip audit-chip--error" title="Errors">${s.errors} error${s.errors === 1 ? '' : 's'}</span>
        <span class="audit-chip audit-chip--warn" title="Warnings">${s.warns} warn${s.warns === 1 ? '' : 's'}</span>
        <span class="audit-chip audit-chip--info" title="Info">${s.infos} info</span>
      </div>`;
  }

  function panelHref(panel, productId) {
    const href = hrefForRoute({ view: 'event', eventId: ctx.eventId, panel });
    if (productId) return `${href}?product=${encodeURIComponent(productId)}`;
    return href;
  }

  function detailBlock(f) {
    if (!f.detail) return '<p class="muted audit-detail-empty">No extra inputs.</p>';
    const rows = Object.entries(f.detail).map(([k, v]) => `
      <tr><th>${escapeHtml(k)}</th><td>${escapeHtml(fmtVal(v))}</td></tr>`).join('');
    return `<table class="audit-detail-table"><tbody>${rows}</tbody></table>`;
  }

  function renderRows(findings) {
    if (!findings.length) {
      return `<tr><td colspan="8" class="dist-empty">No findings for the current filters.</td></tr>`;
    }
    return findings.map((f) => {
      const open = ctx.expanded.has(f.id);
      const meta = CHECK_META[f.checkId]?.label || f.checkId;
      const panel = f.relatedPanel || 'dashboard';
      return `
        <tr class="audit-row audit-row--${escapeHtml(f.severity)}${open ? ' is-expanded' : ''}"
          data-audit-id="${escapeHtml(f.id)}">
          <td class="audit-col-sev">
            <span class="audit-sev audit-sev--${escapeHtml(f.severity)}">${escapeHtml(severityLabel(f.severity))}</span>
          </td>
          <td class="audit-col-check">${escapeHtml(meta)}</td>
          <td class="audit-col-product">${escapeHtml(f.productName || '—')}</td>
          <td class="audit-col-num">${escapeHtml(fmtVal(f.expected))}</td>
          <td class="audit-col-num">${escapeHtml(fmtVal(f.actual))}</td>
          <td class="audit-col-num">${escapeHtml(fmtVal(f.delta))}</td>
          <td class="audit-col-msg">
            <button type="button" class="audit-msg-btn" data-audit-toggle="${escapeHtml(f.id)}">
              ${escapeHtml(f.message)}
            </button>
            <div class="audit-detail" ${open ? '' : 'hidden'}>
              <p class="muted">${escapeHtml(f.fixHint || '')}</p>
              ${detailBlock(f)}
            </div>
          </td>
          <td class="audit-col-link">
            <a class="audit-open-link" href="${escapeHtml(panelHref(panel, f.productId))}">
              Open ${escapeHtml(panel)}
            </a>
          </td>
        </tr>`;
    }).join('');
  }

  function render() {
    const report = ctx.report;
    if (!report) {
      root.innerHTML = loadingWidget('Running forensic audit…');
      return;
    }
    const findings = filterFindings(report.findings, {
      severity: ctx.severity,
      checkId: ctx.checkId,
      query: ctx.query,
    });
    root.innerHTML = `
      <div class="audit-header admin-surface">
        <div class="audit-header-top">
          <div>
            <p class="admin-eyebrow">Forensics</p>
            <h2 class="audit-title">Event audit</h2>
            <p class="muted audit-lead">Software integrity checks — dual-writes, formula drift, sync failures. Not stock variance or mapping completeness.</p>
            <p class="muted audit-ran">Last run ${escapeHtml(report.ranAt ? new Date(report.ranAt).toLocaleString() : '—')}</p>
          </div>
          ${summaryChips(report.summary)}
        </div>
        <p class="muted audit-count">${findings.length} shown · ${report.findings.length} total</p>
      </div>
      <div class="admin-surface audit-table-wrap">
        <table class="admin-table audit-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Check</th>
              <th>Product</th>
              <th class="audit-col-num">Expected</th>
              <th class="audit-col-num">Actual</th>
              <th class="audit-col-num">Delta</th>
              <th>Message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${renderRows(findings)}</tbody>
        </table>
      </div>`;
    initIcons(root);
  }

  async function runAudit() {
    const DB = getDB();
    root.innerHTML = loadingWidget('Loading event data…');
    try {
      const [
        event, caseSizes, products, suppliers, closing, tillImport, modImport,
        recipes, wastage, transfers, supplierReturns, deliveries, distRows, syncQueueStats,
      ] = await Promise.all([
        loadEventFull(ctx.eventId),
        loadCaseSizes(),
        loadLibraryProducts(),
        loadSuppliers(),
        DB.closing.forEvent(ctx.eventId),
        DB.tillImports.forEvent(ctx.eventId).catch(() => null),
        DB.modifierImports.forEvent(ctx.eventId).catch(() => null),
        DB.recipes.listFull().catch(() => []),
        DB.wastage.forEvent(ctx.eventId).catch(() => []),
        DB.transfers.forEvent(ctx.eventId).catch(() => []),
        DB.supplierReturns.forEvent(ctx.eventId).catch(() => []),
        DB.deliveries.forEvent(ctx.eventId).catch(() => []),
        DB.distribution.forEvent(ctx.eventId).catch(() => []),
        getQueueStats().catch(() => ({ pending: 0, failed: 0, total: 0 })),
      ]);
      if (ctx.abort) return;

      const report = runEventAudit({
        event,
        eventId: ctx.eventId,
        caseSizes,
        products,
        suppliers,
        closingRows: closing || [],
        tillRows: tillImport?.rows || [],
        modifierRows: modImport?.rows || [],
        recipes: recipes || [],
        wastageBatches: wastage || [],
        transfers: transfers || [],
        supplierReturns: supplierReturns || [],
        deliveries: deliveries || [],
        distRows: distRows || [],
        bars: event?.bars || [],
        isBoneYard,
        syncQueueStats,
      });
      // Drop heavy ctx before keeping report in memory / export.
      ctx.report = {
        eventId: report.eventId,
        ranAt: report.ranAt,
        summary: report.summary,
        findings: report.findings,
      };
      render();
      const { errors, warns } = report.summary;
      if (errors) toast(`${errors} error${errors === 1 ? '' : 's'} found`, true);
      else if (warns) toast(`${warns} warning${warns === 1 ? '' : 's'} found`);
      else toast('Audit clean — no errors');
    } catch (err) {
      if (ctx.abort) return;
      reportError(err, { source: 'admin.audit.run', silent: true });
      root.innerHTML = errorState({
        title: 'Audit failed',
        copy: err?.message || String(err),
        variant: 'admin',
      });
      bindEmptyRetry(root, () => { runAudit(); });
    }
  }

  function onClick(e) {
    const toggle = e.target.closest('[data-audit-toggle]');
    if (toggle) {
      const id = toggle.getAttribute('data-audit-toggle');
      if (ctx.expanded.has(id)) ctx.expanded.delete(id);
      else ctx.expanded.add(id);
      render();
      return;
    }
  }

  function onToolbar(e) {
    const id = e.detail?.id;
    if (id === 'audit-run') runAudit();
    if (id === 'audit-export') {
      if (!ctx.report) {
        toast('Run the audit first');
        return;
      }
      downloadJson(ctx.report, ctx.eventId);
      toast('Audit JSON exported');
    }
  }

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'audit') return;
    const values = e.detail?.values;
    if (!values) return;
    ctx.severity = values.severity || '';
    ctx.checkId = values.check || '';
    ctx.query = values.query || '';
    if (ctx.report) render();
  };

  root.addEventListener('click', onClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  runAudit();

  return () => {
    ctx.abort = true;
    root.removeEventListener('click', onClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbar);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
