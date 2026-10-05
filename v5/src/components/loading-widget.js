/**
 * Shared loading spinner + label for admin tables and panels.
 * Spinner matches Cursor’s 2×2 status dots.
 * Also: skeleton placeholders for perceived-performance polish.
 */

import { escapeHtml } from '../lib/util.js';

const SPINNER_DOTS = '<span></span><span></span><span></span><span></span>';

/**
 * @param {string} [message]
 * @param {{ className?: string }} [opts]
 */
export function loadingWidget(message = 'Loading…', opts = {}) {
  const className = opts.className ? ` ${opts.className}` : '';
  return `
    <div class="admin-loading${className}" role="status" aria-live="polite" aria-busy="true">
      <span class="admin-loading-spinner" aria-hidden="true">${SPINNER_DOTS}</span>
      <span class="admin-loading-label">${escapeHtml(message)}</span>
    </div>`;
}

/**
 * Full-width table row with the loading widget.
 * @param {number} colSpan
 * @param {string} [message]
 */
export function loadingTableRow(colSpan, message = 'Loading…') {
  const span = Math.max(1, Number(colSpan) || 1);
  return `<tr><td colspan="${span}" class="admin-loading-cell">${loadingWidget(message)}</td></tr>`;
}

/**
 * Skeleton block for lists / cards (avoids layout jump vs spinner-only).
 * @param {object} [opts]
 * @param {number} [opts.rows]
 * @param {string} [opts.className]
 */
export function skeletonList(opts = {}) {
  const rows = Math.max(1, Math.min(12, Number(opts.rows) || 4));
  const className = opts.className ? ` ${opts.className}` : '';
  const items = Array.from({ length: rows }, (_, i) => {
    const w = 55 + ((i * 17) % 35);
    return `
      <div class="skel-row" aria-hidden="true">
        <span class="skel-line skel-line--title" style="width:${w}%"></span>
        <span class="skel-line skel-line--meta" style="width:${Math.max(30, w - 20)}%"></span>
      </div>`;
  }).join('');
  return `
    <div class="skel-list${className}" role="status" aria-busy="true" aria-label="Loading">
      ${items}
    </div>`;
}

/**
 * Skeleton table body rows.
 * @param {number} colSpan
 * @param {object} [opts]
 * @param {number} [opts.rows]
 */
export function skeletonTableRows(colSpan, opts = {}) {
  const span = Math.max(1, Number(colSpan) || 1);
  const rows = Math.max(1, Math.min(16, Number(opts.rows) || 6));
  return Array.from({ length: rows }, (_, i) => {
    const cells = Array.from({ length: span }, (__, c) => {
      const w = 40 + (((i + c) * 13) % 50);
      return `<td class="skel-td"><span class="skel-line" style="width:${w}%"></span></td>`;
    }).join('');
    return `<tr class="skel-tr" aria-hidden="true">${cells}</tr>`;
  }).join('');
}

/**
 * Full skeleton table wrapped in a tbody-ready fragment for empty tables.
 * @param {number} colSpan
 * @param {object} [opts]
 */
export function skeletonTableBody(colSpan, opts = {}) {
  return skeletonTableRows(colSpan, opts);
}
