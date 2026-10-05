/**
 * Recipe / COGS quantity input — fractions stay as typed (no eval-to-decimal on blur).
 *
 * v2 evalMathInput() converts 1/24 → 0.0417 which is hard to audit.
 * This component keeps display text; callers parse to number only when calculating totals.
 */

import { escapeHtml } from '../lib/util.js';

/** Parse fraction or decimal for calculations only. */
export function parseFractionQty(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  if (/^[0-9.]+$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (!/^[0-9+\-*/.()\s/]+$/.test(s)) return 0;
  try {
    const val = Function('"use strict";return (' + s + ')')();
    return typeof val === 'number' && isFinite(val) && val >= 0 ? val : 0;
  } catch {
    return 0;
  }
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Best-effort decimal → vulgar fraction for display (e.g. 0.041666… → 1/24).
 * @param {number} qty
 * @param {number} maxDenom
 */
export function formatQtyAsFraction(qty, maxDenom = 72) {
  const v = Number(qty);
  if (!Number.isFinite(v) || v <= 0) return '1';
  if (Math.abs(v - 1) < 1e-9) return '1';
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));

  let best = null;
  for (let d = 1; d <= maxDenom; d += 1) {
    const n = Math.round(v * d);
    if (n <= 0) continue;
    const approx = n / d;
    const err = Math.abs(v - approx);
    if (err < 1e-6) {
      if (!best || err < best.err - 1e-12 || (Math.abs(err - best.err) < 1e-12 && d < best.d)) {
        best = { n, d, err };
      }
    }
  }

  if (best) {
    const g = gcd(best.n, best.d);
    return `${best.n / g}/${best.d / g}`;
  }

  return v.toLocaleString('en-GB', { maximumFractionDigits: 6 });
}

/** Prefer stored author text; otherwise infer a fraction from numeric qty. */
export function displayFractionQty({ qty, qty_text: qtyText } = {}) {
  const text = String(qtyText ?? '').trim();
  if (text) return text;
  return formatQtyAsFraction(qty);
}

/**
 * @returns {{ root: HTMLElement, getValue: () => string, getNumeric: () => number }}
 */
export function mountFractionInput(container, options = {}) {
  const { value = '', placeholder = 'e.g. 1/24', id = '' } = options;
  const root = document.createElement('div');
  root.className = 'fraction-input-wrap';
  root.innerHTML = `<input type="text" inputmode="text" class="fraction-input num-math" placeholder="${escapeHtml(placeholder)}"${id ? ` id="${escapeHtml(id)}"` : ''} autocomplete="off">`;
  const input = root.querySelector('input');
  input.value = value;

  container.innerHTML = '';
  container.appendChild(root);

  return {
    root,
    getValue: () => input.value.trim(),
    getNumeric: () => parseFractionQty(input.value),
    setValue: (v) => { input.value = v; },
  };
}
