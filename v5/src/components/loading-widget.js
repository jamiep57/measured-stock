/**
 * Shared loading spinner + label for admin tables and panels.
 * Spinner matches Cursor’s 2×2 status dots.
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
