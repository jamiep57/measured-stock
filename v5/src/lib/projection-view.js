/**
 * Shared UI for stock run-out projection tables (dashboard + projections page).
 */

import { escapeHtml, formatMoney } from './util.js';
import { sortProjectionItems, projectionStatus, formatQtyCell } from './stock-projection.js';
import { hrefForRoute } from '../admin/router.js';

export function renderProjectionStats(projection) {
  const p = projection;
  if (!p.rows.length || !p.target || !(p.mappedNet > 0)) return '';

  const unmapped = p.baselineNet - p.mappedNet;
  const unmappedPct = p.baselineNet > 0 ? (unmapped / p.baselineNet) * 100 : 0;
  const runOutCount = p.items.filter((it) =>
    it.inEvent && it.runOutRevenue != null && it.runOutRevenue < p.target).length;
  const mappedInEvent = p.items.filter((it) => it.inEvent).length;

  function card(label, value, sub, valueClass = '') {
    return `
      <div class="dash-stat">
        <span class="dash-stat-label">${escapeHtml(label)}</span>
        <span class="dash-stat-value${valueClass ? ` ${valueClass}` : ''}">${value}</span>
        ${sub ? `<span class="dash-stat-sub muted">${escapeHtml(sub)}</span>` : ''}
      </div>`;
  }

  return `
    <div class="dash-stats">
      ${card('Target revenue', formatMoney(p.target), 'Projection scaled to this')}
      ${card('Imported sales', formatMoney(p.baselineNet), p.factor ? `× ${p.factor.toFixed(2)} to hit target` : '')}
      ${card(
        'Will run out',
        String(runOutCount),
        `of ${mappedInEvent} stocked items`,
        runOutCount ? 'dash-stat-value--danger' : 'dash-stat-value--ok',
      )}
      ${card(
        'Unmapped sales',
        `${Math.round(unmappedPct)}%`,
        `${formatMoney(unmapped)} not attributed`,
        unmappedPct > 10 ? 'dash-stat-value--warn' : '',
      )}
    </div>`;
}

export function renderProjectionTable({
  projection,
  eventId,
  sortKey = null,
  sortDir = 1,
  tableId = 'projectionTable',
  filter = 'all',
}) {
  const p = projection;
  if (!p.rows.length) {
    return `
      <div class="dash-empty admin-surface">
        <p><strong>No item sales imported yet.</strong></p>
        <p class="muted">Import a Square Item Sales report on the Square &amp; modifiers page to see what will run out.</p>
        <a class="dash-link dash-link--primary" href="${escapeHtml(hrefForRoute({ view: 'event', eventId, panel: 'sales' }))}">Go to Square &amp; modifiers</a>
      </div>`;
  }

  if (!p.target) {
    return `
      <div class="dash-empty admin-surface">
        <p><strong>No target revenue set.</strong></p>
        <p class="muted">Set a target revenue in Event Setup to project which products run out before you reach it.</p>
        <a class="dash-link dash-link--primary" href="${escapeHtml(hrefForRoute({ view: 'event', eventId, panel: 'setup' }))}">Open Event Setup</a>
      </div>`;
  }

  if (!(p.mappedNet > 0) || !p.items.length) {
    return `
      <div class="dash-empty admin-surface">
        <p><strong>Nothing mapped yet.</strong></p>
        <p class="muted">Map till items to products on the Square &amp; modifiers page so consumption can be projected.</p>
        <a class="dash-link dash-link--primary" href="${escapeHtml(hrefForRoute({ view: 'event', eventId, panel: 'sales' }))}">Map item sales</a>
      </div>`;
  }

  let items = sortProjectionItems(p.items, sortKey, sortDir, p.target);
  if (filter === 'runout') {
    items = items.filter((it) =>
      it.inEvent && it.runOutRevenue != null && it.runOutRevenue < p.target);
  }

  const th = (key, label, cls = '') => {
    const active = sortKey === key;
    const arrow = active ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="dash-sort${cls ? ` ${cls}` : ''}" data-sort="${key}">${escapeHtml(label)}${arrow}</th>`;
  };

  const body = items.length ? items.map((it) => {
    const st = projectionStatus(it, p.target);
    let statusHtml;
    if (!it.inEvent) {
      statusHtml = `<span class="dash-badge dash-badge--warn" title="${escapeHtml(it.stockHint || '')}">${escapeHtml(st.label)}</span>`;
      if (it.stockHint) {
        statusHtml += `<div class="dash-hint muted">${escapeHtml(it.stockHint)}</div>`;
      }
    } else {
      statusHtml = `<span class="dash-badge dash-badge--${st.tone}">${escapeHtml(st.label)}</span>`;
    }

    const pct = st.pct;
    const pctHtml = pct != null
      ? `<span class="dash-pct dash-pct--${st.tone}">${Math.round(pct)}%</span>`
      : '<span class="muted">—</span>';

    const runOutHtml = it.runOutRevenue != null
      ? formatMoney(it.runOutRevenue)
      : '<span class="muted">—</span>';

    const servingsHtml = it.servingsSold != null
      ? Math.round(it.servingsSold).toLocaleString('en-GB')
      : '<span class="muted">—</span>';

    return `
      <tr${it.pid ? ` data-pid="${escapeHtml(it.pid)}"` : ''}>
        <td class="dash-prod">${escapeHtml(it.name)}</td>
        <td class="num">${servingsHtml}</td>
        <td class="num">${formatQtyCell(it.baselineCases)}</td>
        <td class="num">${formatQtyCell(it.projectedCases)}</td>
        <td class="num">${it.delivered != null ? formatQtyCell(it.delivered) : '<span class="muted">—</span>'}</td>
        <td class="num">${it.wastage != null ? formatQtyCell(it.wastage) : '<span class="muted">—</span>'}</td>
        <td class="num">${it.available != null ? formatQtyCell(it.available) : '<span class="muted">—</span>'}</td>
        <td class="num">${runOutHtml}</td>
        <td class="num">${pctHtml}</td>
        <td>${statusHtml}</td>
      </tr>`;
  }).join('') : `
      <tr><td colspan="10" class="muted" style="padding:16px;text-align:center">No products run out before target revenue with this filter.</td></tr>`;

  return `
    <div class="catalog-table-wrap dash-table-wrap">
      <table class="catalog-table dash-table" id="${escapeHtml(tableId)}">
        <thead>
          <tr>
            ${th('name', 'Product')}
            ${th('servingsSold', 'Sold (Square)', 'num')}
            ${th('baselineCases', 'Sold (cases)', 'num')}
            ${th('projectedCases', 'Use at target', 'num')}
            ${th('delivered', 'Total delivered', 'num')}
            ${th('wastage', 'Wastage', 'num')}
            ${th('available', 'Stock', 'num')}
            ${th('runOutRevenue', 'Runs dry at', 'num')}
            ${th('pct', '% of target', 'num')}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
