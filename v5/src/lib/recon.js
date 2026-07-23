/**
 * Financial recon calculations — ported from v2 Financial Recon panel.
 * Consumption = Delivered + pre-event on hand − closing − transferred − wastage.
 * Variance = PLU − Consumption.
 */

import { productStockPack, findOfferForSupplier } from '../pack-metrics.js';
import { productStockUnit, eventProductStockKey, recipeProductByName, pluStockKeyForRecipeIngredient, recipeQtyToStockUnits, normProductName } from './recipe-stock.js';
import { findRecipe } from './square-recipes.js';
import { parseQty, storedToForm, totalUnitsForProduct } from '../stock-entry.js';
import { round1 } from './opening-stock.js';

export function roundN(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

export function formatReconMoney(n) {
  const v = Number(n) || 0;
  if (!v) return '—';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatReconQty(n) {
  const v = Number(n) || 0;
  if (!v) return '—';
  return Number.isInteger(v) ? String(v) : roundN(v, 2).toString();
}

export const RECON_COLS = [
  { id: 'status', label: 'Status' },
  { id: 'item', label: 'Item' },
  { id: 'abv', label: 'ABV' },
  { id: 'case_price', label: 'Price' },
  { id: 'supplier', label: 'Supplier' },
  { id: 'units_per_case', label: 'Units per case' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'invoiced', label: 'Invoiced' },
  { id: 'closing_cases', label: 'Closing (cases)' },
  { id: 'closing_units', label: 'Closing (singles)' },
  { id: 'returned_to_supplier', label: 'Returned to supplier' },
  { id: 'transferred', label: 'Transferred' },
  { id: 'wastage', label: 'Wastage' },
  { id: 'consumption', label: 'Consumption' },
  { id: 'plu', label: 'PLU' },
  { id: 'variance', label: 'Variance' },
  { id: 'consumption_charge', label: 'Consumption charge' },
  { id: 'consumption_loose', label: 'Consumption + loose' },
  { id: 'plu_charge', label: 'PLU charge' },
  { id: 'invoice_charge', label: 'Invoice charge' },
  { id: 'budget_cost', label: 'Budget cost' },
];

export function loadReconColVisibility() {
  const defaults = Object.fromEntries(RECON_COLS.map((c) => [c.id, true]));
  try {
    const raw = localStorage.getItem('v5ReconColVisibility');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    RECON_COLS.forEach((c) => {
      if (typeof parsed[c.id] === 'boolean') defaults[c.id] = parsed[c.id];
    });
  } catch { /* ignore */ }
  return defaults;
}

export function saveReconColVisibility(map) {
  try { localStorage.setItem('v5ReconColVisibility', JSON.stringify(map)); } catch { /* ignore */ }
}

export function preferredSupplierId(product) {
  if (!product) return null;
  const offer = findOfferForSupplier(product, null);
  return offer?.supplier_id || product.supplier_id || null;
}

export function supplierName(suppliers, supplierId) {
  if (!supplierId) return '—';
  const hit = (suppliers || []).find((s) => s.id === supplierId);
  return hit?.name || '—';
}

export function reconUnitsPerCase(product, caseSizes = []) {
  const pack = productStockPack(product, caseSizes);
  if (productStockUnit(product, caseSizes) === 'bottle') {
    return pack.unitsPerCase > 0 ? pack.unitsPerCase : 1;
  }
  return pack.unitsPerCase > 0 ? pack.unitsPerCase : Number(product?.units_per_case) || 1;
}

export function reconUsesBottlePrice(product, caseSizes = []) {
  return productStockUnit(product, caseSizes) === 'bottle';
}

function defaultCasePrice(ep, suppliers, caseSizes) {
  const p = ep?.product;
  if (!p) return 0;
  if (ep.order_price_override != null) return Number(ep.order_price_override) || 0;
  const sid = preferredSupplierId(p);
  const offer = findOfferForSupplier(p, sid);
  if (offer?.case_price != null) return Number(offer.case_price) || 0;
  if (p.case_price != null) return Number(p.case_price) || 0;
  return 0;
}

function defaultUnitPrice(ep, suppliers, caseSizes) {
  const p = ep?.product;
  if (!p) return null;
  if (ep.order_unit_price_override != null) return Number(ep.order_unit_price_override) || 0;
  if (ep.order_price_override != null) {
    const upc = reconUnitsPerCase(p, caseSizes) || 1;
    return upc > 0 ? (Number(ep.order_price_override) || 0) / upc : null;
  }
  const sid = preferredSupplierId(p);
  const offer = findOfferForSupplier(p, sid);
  if (offer?.unit_price != null) return Number(offer.unit_price) || 0;
  if (offer?.case_price != null) {
    const upc = reconUnitsPerCase(p, caseSizes) || 1;
    return upc > 0 ? Number(offer.case_price) / upc : null;
  }
  if (p.unit_price != null) return Number(p.unit_price) || 0;
  if (p.case_price != null) {
    const upc = reconUnitsPerCase(p, caseSizes) || 1;
    return upc > 0 ? Number(p.case_price) / upc : null;
  }
  return null;
}

export function reconCasePrice(ep, draft, caseSizes = []) {
  if (draft?.casePrice !== '' && draft?.casePrice != null) return Number(draft.casePrice) || 0;
  if (draft?.unitPrice !== '' && draft?.unitPrice != null) {
    const upc = reconUnitsPerCase(ep?.product, caseSizes) || 1;
    return (Number(draft.unitPrice) || 0) * upc;
  }
  return defaultCasePrice(ep, [], caseSizes);
}

export function reconUnitPrice(ep, draft, caseSizes = []) {
  if (draft?.unitPrice !== '' && draft?.unitPrice != null) return Number(draft.unitPrice) || 0;
  if (draft?.casePrice !== '' && draft?.casePrice != null) {
    const upc = reconUnitsPerCase(ep?.product, caseSizes) || 1;
    return upc > 0 ? (Number(draft.casePrice) || 0) / upc : null;
  }
  return defaultUnitPrice(ep, [], caseSizes);
}

export function reconRowPrice(ep, draft, caseSizes = []) {
  if (reconUsesBottlePrice(ep?.product, caseSizes)) {
    return reconUnitPrice(ep, draft, caseSizes) || 0;
  }
  return reconCasePrice(ep, draft, caseSizes);
}

export function closingInvoiceQty(ep) {
  const v = ep?.invoice_qty != null ? ep.invoice_qty : (ep?.qty_ordered != null ? ep.qty_ordered : 0);
  return Number(v) || 0;
}

export function reconClosingTotal(product, closingCases, closingSingles, caseSizes = []) {
  if (!product) return Number(closingCases) || 0;
  return totalUnitsForProduct(closingCases, closingSingles, product, caseSizes);
}

export function resolveClosingCounts(cl, draft) {
  cl = cl || {};
  if (draft?.fromDrawer) {
    return {
      closingCases: draft.closingCases != null ? Number(draft.closingCases) : 0,
      closingSingles: draft.closingSingles != null ? Number(draft.closingSingles) : 0,
    };
  }
  if (draft && (draft.closingCases != null || draft.closingSingles != null)) {
    return {
      closingCases: draft.closingCases != null ? Number(draft.closingCases) : 0,
      closingSingles: draft.closingSingles != null ? Number(draft.closingSingles) : 0,
    };
  }
  if (cl.closing_cases != null || cl.closing_singles != null) {
    return {
      closingCases: cl.closing_cases != null ? Number(cl.closing_cases) : 0,
      closingSingles: cl.closing_singles != null ? Number(cl.closing_singles) : 0,
    };
  }
  if (cl.close_count != null) {
    return { closingCases: Number(cl.close_count) || 0, closingSingles: 0 };
  }
  return { closingCases: 0, closingSingles: 0 };
}

function stockRemaining(cl, closingTotal) {
  const hasClose = cl && (cl.closing_cases != null || cl.closing_singles != null || cl.close_count != null);
  if (hasClose || closingTotal > 0) return roundN(closingTotal, 2);
  if (cl?.carried_over != null && cl?.return_amount != null) {
    return roundN((Number(cl.carried_over) || 0) + (Number(cl.return_amount) || 0), 2);
  }
  if (cl?.return_amount != null) return roundN(Number(cl.return_amount) || 0, 2);
  return 0;
}

export function wastageByProduct(wastageBatches, event, caseSizes) {
  const map = {};
  (wastageBatches || []).forEach((b) => {
    (b.lines || []).forEach((l) => {
      if (!l.product_id) return;
      const p = event?.event_products?.find((ep) => ep.product_id === l.product_id)?.product;
      const form = storedToForm(l);
      const cases = totalUnitsForProduct(form.cases, form.singles, p, caseSizes);
      map[l.product_id] = roundN((map[l.product_id] || 0) + cases, 2);
    });
  });
  return map;
}

export function transferOutByProduct(transfers, eventId) {
  const map = {};
  if (!eventId) return map;
  (transfers || []).forEach((t) => {
    if (t.from_event_id !== eventId) return;
    const leaves = !!t.recipient_id || !!t.to_warehouse_id || (t.to_event_id && t.to_event_id !== eventId);
    if (!leaves) return;
    (t.lines || []).forEach((l) => {
      if (!l.product_id) return;
      const form = storedToForm(l);
      const p = null; // resolved by caller via totalUnits with product from event
      map[l.product_id] = map[l.product_id] || { cases: 0, singles: 0, lines: [] };
      map[l.product_id].lines.push(l);
      map[l.product_id].cases += parseQty(form.cases);
      map[l.product_id].singles += parseQty(form.singles);
    });
  });
  return map;
}

export function transferOutCases(transferMap, pid, event, caseSizes) {
  const entry = transferMap[pid];
  if (!entry) return 0;
  const p = event?.event_products?.find((ep) => ep.product_id === pid)?.product;
  return roundN(totalUnitsForProduct(entry.cases, entry.singles, p, caseSizes), 2);
}

export function supplierReturnCases(supplierReturns, pid, event, caseSizes) {
  const lines = (supplierReturns || []).filter((r) => r.product_id === pid);
  if (lines.length) {
    return roundN(lines.reduce((sum, r) => {
      const p = event?.event_products?.find((ep) => ep.product_id === pid)?.product;
      const form = storedToForm(r);
      return sum + totalUnitsForProduct(form.cases ?? form.qty, form.singles, p, caseSizes);
    }, 0), 2);
  }
  return 0;
}

/** PLU consumption in stock units (cases / kegs / bottle-equivalent cases). */
export function computePluByProductId(eps, tillRows, recipes, products, caseSizes) {
  const byName = {};
  const byPool = {};

  (tillRows || []).forEach((r) => {
    const recipe = findRecipe(recipes, r.name, r.variation);
    if (!recipe) return;
    const sold = Number(r.items_sold) || 0;
    (recipe.ingredients || []).forEach((ig) => {
      const qty = Number(ig.qty) || 0;
      if (!(qty > 0)) return;
      if (ig.pool_name) {
        const key = normProductName(ig.pool_name);
        if (!key) return;
        byPool[key] = (byPool[key] || 0) + sold * qty;
        return;
      }
      const p = recipeProductByName(ig.product_name, qty, products);
      const key = pluStockKeyForRecipeIngredient(ig.product_name, qty, eps, products, caseSizes);
      if (!key) return;
      byName[key] = (byName[key] || 0) + recipeQtyToStockUnits(p, qty, sold, caseSizes);
    });
  });

  const pluByPid = {};
  (eps || []).forEach((ep) => {
    if (!ep.product?.name) return;
    pluByPid[ep.product_id] = byName[eventProductStockKey(ep)] || 0;
  });

  Object.keys(byPool).forEach((poolKey) => {
    const servings = byPool[poolKey];
    const poolEps = (eps || []).filter((ep) => {
      const p = ep.product;
      return p?.pool_name && normProductName(p.pool_name) === poolKey;
    });
    if (!poolEps.length) return;
    let totalWeight = 0;
    const weights = poolEps.map((ep) => {
      const p = ep.product;
      const spu = Number(p.pool_servings_per_unit) || 0;
      const opening = Number(ep.delivered_qty ?? ep.qty_ordered ?? 0) - Number(ep.damaged_qty || 0);
      const pack = productStockPack(p, caseSizes);
      const bpc = pack.unitsPerCase || 1;
      const w = opening * bpc * spu;
      totalWeight += w;
      return { ep, w, spu, bpc };
    });
    poolEps.forEach((ep, i) => {
      const { w, spu, bpc } = weights[i];
      if (!(totalWeight > 0 && spu > 0 && bpc > 0)) return;
      const allocServings = servings * (w / totalWeight);
      const cases = allocServings / (spu * bpc);
      pluByPid[ep.product_id] = (pluByPid[ep.product_id] || 0) + cases;
    });
  });

  Object.keys(pluByPid).forEach((pid) => {
    pluByPid[pid] = roundN(pluByPid[pid], 2);
  });
  return pluByPid;
}

export function reconBudgetCost(row, cl) {
  const method = cl?.budget_method || 'auto';
  if (method === 'manual' && cl?.budget_override != null) return Number(cl.budget_override) || 0;
  if (method === 'consumption_loose') return row.consumptionLooseCharge;
  if (method === 'consumption') return row.consumptionCharge;
  if (method === 'plu') return row.pluCharge;
  if (method === 'invoice') return row.invoiceCharge;
  if (row.invoiced > 0) return row.consumptionLooseCharge;
  return Math.max(row.consumptionLooseCharge || 0, row.pluCharge || 0);
}

export function varianceClass(consumption, plu, variance) {
  if (consumption === 0 && plu === 0) return '';
  const denom = Math.max(Math.abs(consumption), Math.abs(plu), 0.01);
  const absPct = Math.abs(variance) / denom * 100;
  if (absPct < 8) return 'recon-var-good';
  if (absPct < 15) return 'recon-var-warn';
  return 'recon-var-bad';
}

export function buildReconRow(ctx) {
  const {
    ep,
    closingRow: cl = {},
    pluByPid = {},
    draft = null,
    suppliers = [],
    caseSizes = [],
    wastageMap = {},
    transferMap = {},
    supplierReturns = [],
    event,
  } = ctx;

  const pid = ep.product_id;
  const p = ep.product || {};
  const ups = reconUnitsPerCase(p, caseSizes);
  const delivered = ep.delivered_qty != null ? Number(ep.delivered_qty) || 0 : 0;

  let invoiced;
  if (draft?.invoiceSet != null) {
    invoiced = draft.invoiceSet ? Number(draft.invoiced) || 0 : closingInvoiceQty(ep);
  } else {
    invoiced = closingInvoiceQty(ep);
  }

  const { closingCases, closingSingles } = resolveClosingCounts(cl, draft);
  const preEventOnHand = ep.already_in_stock != null ? Number(ep.already_in_stock) || 0 : 0;
  const supplierReturnsQty = draft?.returnSet != null
    ? roundN(Number(draft.returnStored) || 0, 2)
    : (supplierReturnCases(supplierReturns, pid, event, caseSizes)
      || (cl.return_amount != null ? roundN(Number(cl.return_amount) || 0, 2) : 0));

  const closingTotal = reconClosingTotal(p, closingCases, closingSingles, caseSizes);
  const stockRem = stockRemaining(cl, closingTotal);
  const transferred = transferOutCases(transferMap, pid, event, caseSizes);
  const wastage = wastageMap[pid] || 0;
  const consumption = roundN(delivered + preEventOnHand - stockRem - transferred - wastage, 2);
  const plu = pluByPid[pid] || 0;

  const casePrice = reconCasePrice(ep, draft, caseSizes);
  const unitPrice = reconUnitPrice(ep, draft, caseSizes);
  const rowPrice = reconRowPrice(ep, draft, caseSizes);
  const consumptionCharge = consumption * rowPrice;
  const consumptionLooseCharge = consumption * rowPrice;
  const pluCharge = plu * casePrice;
  const invoiceCharge = invoiced * casePrice;

  const budgetCl = {
    budget_method: draft?.budgetMethod != null ? draft.budgetMethod : cl.budget_method,
    budget_override: draft?.budgetOverride != null ? draft.budgetOverride : cl.budget_override,
  };

  const charges = {
    ep, pid, p, ups, delivered, invoiced, closingCases, closingSingles,
    supplierReturns: supplierReturnsQty, transferred, wastage, consumption, plu,
    casePrice, unitPrice, rowPrice, consumptionCharge, consumptionLooseCharge,
    pluCharge, invoiceCharge,
  };

  const budgetCost = reconBudgetCost(charges, budgetCl);
  const sid = preferredSupplierId(p);
  const supplierNameStr = supplierName(suppliers, sid);
  const variance = roundN(plu - consumption, 2);
  const denom = Math.max(Math.abs(consumption), Math.abs(plu), 0.01);
  const variancePct = (consumption !== 0 || plu !== 0)
    ? roundN((variance / denom) * 100, 1) : 0;
  const investigate = (consumption !== 0 || plu !== 0)
    && Math.abs(variance) / denom > 0.08;

  const reconNote = (draft?.reconNote != null ? draft.reconNote : cl.recon_note) || '';
  const reconStatus = draft?.reconStatus !== undefined
    ? (draft.reconStatus || null)
    : (cl.recon_status || null);
  const reconHidden = draft?.reconHidden !== undefined
    ? !!draft.reconHidden
    : !!ep.recon_hidden;

  return {
    ...charges,
    variance,
    variancePct,
    budgetCost,
    supplierName: supplierNameStr,
    supplierId: sid,
    investigate,
    reconNote,
    reconStatus,
    reconHidden,
    budgetMethod: budgetCl.budget_method || 'auto',
  };
}

export function productAbv(product) {
  const v = product?.abv;
  if (v == null || v === '') return '—';
  return `${Number(v).toFixed(2)}%`;
}

export function closingRowFor(closingRows, pid) {
  return (closingRows || []).find((c) => c.product_id === pid) || null;
}

export function computeReconRows(state) {
  const {
    event,
    closingRows,
    tillRows,
    recipes,
    products,
    caseSizes,
    suppliers,
    wastageBatches,
    transfers,
    supplierReturns,
    showHidden,
    drafts = {},
  } = state;

  const eps = (event?.event_products || [])
    .filter((ep) => ep.product?.name)
    .filter((ep) => (showHidden ? ep.recon_hidden : !ep.recon_hidden));

  const pluByPid = computePluByProductId(eps, tillRows, recipes, products, caseSizes);
  const wastageMap = wastageByProduct(wastageBatches, event, caseSizes);
  const transferMap = transferOutByProduct(transfers, event?.id);

  return eps.map((ep) => buildReconRow({
    ep,
    closingRow: closingRowFor(closingRows, ep.product_id) || {},
    pluByPid,
    draft: drafts[ep.product_id] || null,
    suppliers,
    caseSizes,
    wastageMap,
    transferMap,
    supplierReturns,
    event,
  }));
}

export function filterReconRows(rows, { statusFilter = '', categoryFilter = '' } = {}) {
  return rows.filter((r) => {
    if (statusFilter) {
      const s = r.reconStatus || '';
      if (statusFilter === 'none') { if (s) return false; }
      else if (s !== statusFilter) return false;
    }
    if (categoryFilter) {
      const cid = r.p?.category?.id;
      if (cid !== categoryFilter) return false;
    }
    return true;
  });
}

export function reconTotals(rows) {
  let totBudget = 0;
  let totConsLoose = 0;
  let totInvoice = 0;
  let totPlu = 0;
  let totConsumption = 0;
  let totPluCases = 0;
  let totVariance = 0;
  let totWastage = 0;
  const statusCounts = { red: 0, yellow: 0, green: 0, blue: 0, none: 0 };

  rows.forEach((r) => {
    totBudget += r.budgetCost || 0;
    totConsLoose += r.consumptionLooseCharge || 0;
    totInvoice += r.invoiceCharge || 0;
    totPlu += r.pluCharge || 0;
    totConsumption += r.consumption || 0;
    totPluCases += r.plu || 0;
    totVariance += r.variance || 0;
    totWastage += r.wastage || 0;
    const s = r.reconStatus || 'none';
    if (statusCounts[s] != null) statusCounts[s] += 1;
    else statusCounts.none += 1;
  });

  return {
    totBudget, totConsLoose, totInvoice, totPlu,
    totConsumption, totPluCases, totVariance, totWastage,
    statusCounts,
  };
}
