/**
 * Closing stock — physical end-of-event counts, SOR returns, carried over.
 */

import { parseQty, totalUnitsForProduct } from '../stock-entry.js';
import { productStockPack } from '../pack-metrics.js';
import {
  closingInvoiceQty,
  preferredSupplierId,
  resolveClosingCounts,
  roundN,
  supplierName,
  supplierReturnCases,
} from './recon.js';

export { closingInvoiceQty, resolveClosingCounts };

export function closingSorPct(ep, suppliers = []) {
  if (ep?.sor_pct_override != null && ep.sor_pct_override !== '') {
    return Number(ep.sor_pct_override) || 0;
  }
  const sid = preferredSupplierId(ep?.product);
  const sup = (suppliers || []).find((s) => s.id === sid);
  return Number(sup?.default_sor_pct) || 0;
}

/** Invoice qty × SOR % (1 d.p.). Null when SOR unset or invoice is 0 (no soft-cap). */
export function maxReturnable(invoiceQty, sorPct) {
  const sor = Number(sorPct) || 0;
  if (sor <= 0) return null;
  const inv = Number(invoiceQty) || 0;
  if (inv <= 0) return null;
  return roundN(inv * sor / 100, 1);
}

export function closeCountTotal(product, cases, singles, caseSizes = []) {
  return roundN(totalUnitsForProduct(cases, singles, product, caseSizes), 4);
}

export function carriedOver(closeCount, returnAmount) {
  return roundN(Math.max(0, (Number(closeCount) || 0) - (Number(returnAmount) || 0)), 1);
}

/**
 * Display strings for a stored return_amount.
 * DB only stores a single total — show it in the primary column (no silent split).
 */
export function returnAmountToForm(returnAmount) {
  const n = Number(returnAmount);
  if (!Number.isFinite(n) || n <= 0) return { cases: '', singles: '' };
  return { cases: String(n), singles: '' };
}

export function hasClosingCount(cl) {
  return !!(cl && (
    cl.closing_cases != null || cl.closing_singles != null || cl.close_count != null
  ));
}

export function closingCountToForm(cl) {
  const { closingCases, closingSingles } = resolveClosingCounts(cl, null);
  if (!hasClosingCount(cl)) return { cases: '', singles: '' };
  // Keep explicit zeros visible — blank means not counted, "0" means counted as none.
  return {
    cases: String(closingCases ?? 0),
    singles: String(closingSingles ?? 0),
  };
}

export function formatQtyLabel(product, cases, singles, caseSizes = []) {
  const c = parseQty(cases);
  const s = parseQty(singles);
  if (!c && !s) return '—';
  const pack = productStockPack(product, caseSizes);
  const unit = pack?.stockUnit === 'bottle' ? 'bottle'
    : pack?.stockUnit === 'keg' ? 'keg'
      : 'case';
  const unitPl = (n) => (n === 1 ? unit : `${unit}s`);
  const parts = [];
  if (c || !s) {
    const shown = roundN(c, 2);
    parts.push(`${shown} ${unitPl(shown)}`);
  }
  if (s) {
    const shown = roundN(s, 2);
    parts.push(`${shown} ${shown === 1 ? 'single' : 'singles'}`);
  }
  return parts.join(' · ') || '—';
}

export function buildClosingRow({
  ep,
  closingRow: cl = {},
  suppliers = [],
  caseSizes = [],
  draft = null,
  event = null,
  supplierReturns = [],
}) {
  const p = ep?.product || {};
  const pid = ep?.product_id;
  const sid = preferredSupplierId(p);
  const invQty = closingInvoiceQty(ep);
  const sor = closingSorPct(ep, suppliers);
  const maxRet = maxReturnable(invQty, sor);

  const counts = resolveClosingCounts(cl, draft);
  const closingCases = draft?.closingCases != null ? Number(draft.closingCases) : counts.closingCases;
  const closingSingles = draft?.closingSingles != null ? Number(draft.closingSingles) : counts.closingSingles;
  const closeCount = closeCountTotal(p, closingCases, closingSingles, caseSizes);
  const hasClosing = hasClosingCount(cl)
    || !!(draft && (draft.closingCases != null || draft.closingSingles != null));

  // Same priority as recon: supplier_return_lines win over closing_stock.return_amount.
  const fromReturnLines = supplierReturnCases(
    supplierReturns,
    pid,
    event || { event_products: ep ? [ep] : [] },
    caseSizes,
  );
  const storedReturn = fromReturnLines > 0
    ? fromReturnLines
    : (cl.return_amount != null ? Number(cl.return_amount) || 0 : 0);
  const storedForm = returnAmountToForm(storedReturn);

  const returnCases = draft?.returnCases != null
    ? Number(draft.returnCases)
    : parseQty(storedForm.cases);
  const returnSingles = draft?.returnSingles != null
    ? Number(draft.returnSingles)
    : parseQty(storedForm.singles);
  const returnAmt = draft
    ? closeCountTotal(p, returnCases, returnSingles, caseSizes)
    : (storedReturn || closeCountTotal(p, returnCases, returnSingles, caseSizes));

  const carried = carriedOver(closeCount, returnAmt);
  const pack = productStockPack(p, caseSizes);

  return {
    pid,
    ep,
    p,
    packLabel: pack?.label || p.case_size || '—',
    supplierId: sid,
    supplierName: supplierName(suppliers, sid),
    category: p.category?.name || 'Uncategorised',
    sor,
    invoiceQty: invQty,
    invoiceLabel: formatQtyLabel(p, invQty, 0, caseSizes),
    hasClosing,
    closingCases,
    closingSingles,
    closeCount,
    maxReturnable: maxRet,
    returnCases,
    returnSingles,
    returnAmount: roundN(returnAmt, 2),
    carriedOver: carried,
    carriedLabel: formatQtyLabel(p, carried, 0, caseSizes),
  };
}

export function computeClosingRows({
  event,
  closingRows = [],
  suppliers = [],
  caseSizes = [],
  drafts = {},
  supplierReturns = [],
}) {
  const eps = (event?.event_products || []).filter((ep) => ep.product?.name);
  return eps.map((ep) => buildClosingRow({
    ep,
    closingRow: (closingRows || []).find((c) => c.product_id === ep.product_id) || {},
    suppliers,
    caseSizes,
    draft: drafts[ep.product_id] || null,
    event,
    supplierReturns,
  }));
}

/** Status / category / supplier filters for the Closing grid. */
export function filterClosingRows(rows, {
  statusFilter = '',
  categoryFilter = '',
  supplierFilter = '',
} = {}) {
  return (rows || []).filter((r) => {
    if (categoryFilter && (r.category || 'Uncategorised') !== categoryFilter) return false;
    if (supplierFilter) {
      const sid = r.supplierId || '';
      const sname = r.supplierName || '';
      if (supplierFilter === '__none__') {
        if (sid || sname) return false;
      } else if (sid !== supplierFilter && sname !== supplierFilter) {
        return false;
      }
    }
    const status = statusFilter || '';
    if (status === 'uncounted') return !r.hasClosing;
    if (status === 'counted') return !!r.hasClosing;
    if (status === 'returning') return (Number(r.returnAmount) || 0) > 0;
    if (status === 'carried') return (Number(r.carriedOver) || 0) > 0;
    if (status === 'over_sor') {
      return exceedsMaxReturnable(r.returnAmount, r.maxReturnable);
    }
    return true;
  });
}

function nameCmp(a, b) {
  return (a?.p?.name || '').localeCompare(b?.p?.name || '');
}

/** Sort within a category group. Default is name A–Z. */
export function sortClosingList(list, sortKey = 'name') {
  const key = sortKey || 'name';
  return (list || []).slice().sort((a, b) => {
    if (key === 'invoice') {
      return (Number(b.invoiceQty) || 0) - (Number(a.invoiceQty) || 0) || nameCmp(a, b);
    }
    if (key === 'closing') {
      return (Number(b.closeCount) || 0) - (Number(a.closeCount) || 0) || nameCmp(a, b);
    }
    if (key === 'return') {
      return (Number(b.returnAmount) || 0) - (Number(a.returnAmount) || 0) || nameCmp(a, b);
    }
    if (key === 'carried') {
      return (Number(b.carriedOver) || 0) - (Number(a.carriedOver) || 0) || nameCmp(a, b);
    }
    if (key === 'sor') {
      return (Number(b.sor) || 0) - (Number(a.sor) || 0) || nameCmp(a, b);
    }
    return nameCmp(a, b);
  });
}

export function groupClosingByCategory(rows, sortKey = 'name') {
  const grouped = {};
  (rows || []).forEach((r) => {
    const cat = r.category || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(r);
  });
  Object.keys(grouped).forEach((cat) => {
    grouped[cat] = sortClosingList(grouped[cat], sortKey);
  });
  return grouped;
}

/** True when return amount is above a positive max-returnable (SOR) limit. */
export function exceedsMaxReturnable(returnAmount, maxRet) {
  const max = maxRet != null ? Number(maxRet) : null;
  return max != null && max > 0 && Number(returnAmount) > max;
}

export function closingPatchFromDraft(product, draft, caseSizes = [], opts = {}) {
  const cases = Math.max(0, Number(draft?.closingCases) || 0);
  const singles = Math.max(0, Number(draft?.closingSingles) || 0);
  const returnCases = Math.max(0, Number(draft?.returnCases) || 0);
  const returnSingles = Math.max(0, Number(draft?.returnSingles) || 0);
  const closeCount = closeCountTotal(product, cases, singles, caseSizes);
  let returnAmount = roundN(closeCountTotal(product, returnCases, returnSingles, caseSizes), 2);
  const maxRet = opts.maxReturnable != null ? Number(opts.maxReturnable) : null;
  const caps = [];
  // Soft-cap only when there is a positive max and the caller has not allowed overage
  // (invoice 0 → no max → allow overwrite; UI can confirm and pass allowOverMaxReturnable).
  if (
    exceedsMaxReturnable(returnAmount, maxRet)
    && !opts.allowOverMaxReturnable
  ) {
    returnAmount = roundN(maxRet, 2);
    caps.push('max returnable');
  }
  if (returnAmount > closeCount) {
    returnAmount = roundN(closeCount, 2);
    caps.push('closing count');
  }
  return {
    closing_cases: cases,
    closing_singles: singles,
    close_count: closeCount,
    return_amount: returnAmount,
    carried_over: carriedOver(closeCount, returnAmount),
    capped: caps,
  };
}
