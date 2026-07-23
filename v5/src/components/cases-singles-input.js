import { escapeHtml } from '../lib/util.js';
import { countEntryMode, entryMode } from '../pack-metrics.js';
import { inputAttrsPrimary, inputAttrsForSecondary } from '../stock-entry.js';

/**
 * Build HTML for primary + optional secondary qty inputs.
 */
export function renderQtyInputs({
  productId,
  product,
  caseSizes,
  form,
  context,
  prefix,
}) {
  const mode = context === 'delivery'
    ? entryMode(product, caseSizes)
    : countEntryMode(product, caseSizes);

  const primaryId = `${prefix}-cases-${productId}`;
  const secondaryId = `${prefix}-singles-${productId}`;
  const primaryAttrs = inputAttrsPrimary();
  const secondaryAttrs = inputAttrsForSecondary(mode);

  let html = `<div class="count-inputs qty-inputs" data-pid="${escapeHtml(productId)}">`;

  html += `<div class="cell"><label>${escapeHtml(mode.columnLabels.primary)}</label>`;
  html += `<input id="${primaryId}" class="qty-primary" data-pid="${escapeHtml(productId)}"`;
  html += ` type="${primaryAttrs.type}" inputmode="${primaryAttrs.inputMode}" step="${primaryAttrs.step}" min="${primaryAttrs.min}"`;
  html += ` value="${escapeHtml(form.cases)}" placeholder="0"></div>`;

  if (mode.columnLabels.secondary && secondaryAttrs) {
    html += `<div class="cell"><label>${escapeHtml(mode.columnLabels.secondary)}</label>`;
    html += `<input id="${secondaryId}" class="qty-secondary" data-pid="${escapeHtml(productId)}"`;
    html += ` type="${secondaryAttrs.type}" inputmode="${secondaryAttrs.inputMode}" step="${secondaryAttrs.step}" min="${secondaryAttrs.min}"`;
    if (secondaryAttrs.max) html += ` max="${secondaryAttrs.max}"`;
    html += ` value="${escapeHtml(form.singles)}" placeholder="0"></div>`;
  }

  html += '</div>';
  return { html, mode };
}

export function readQtyInputs(container, productId) {
  const primary = container.querySelector(`#cnt-cases-${productId}, #del-cases-${productId}, [id$="-cases-${productId}"]`);
  const secondary = container.querySelector(`#cnt-singles-${productId}, #del-singles-${productId}, [id$="-singles-${productId}"]`);
  return {
    cases: primary?.value ?? '',
    singles: secondary?.value ?? '',
  };
}
