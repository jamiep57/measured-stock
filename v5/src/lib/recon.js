/**
 * Financial recon calculations — ported from v2 Financial Recon panel.
 * Consumption = Delivered + pre-event on hand − closing − transferred − wastage.
 * Variance = PLU − Consumption.
 */

import { productStockPack, findOfferForSupplier } from '../pack-metrics.js';
import { productStockUnit, eventProductStockKey, recipeProductByName, pluStockKeyForRecipeIngredient, recipeQtyToStockUnits, normProductName } from './recipe-stock.js';
import { findRecipe } from './square-recipes.js';
import { parseQty, storedToForm, totalUnitsForProduct } from '../stock-entry.js';
import {
  round1,
  countedInFromDeliveries,
  epDeliveredQty,
} from './opening-stock.js';
import { costDeliveryLine } from './supplier-delivery-cost.js';

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
  { id: 'item', label: 'Item' },
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
  { id: 'consumption_loose', label: 'Loose charge' },
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
export function computePluByProductId(eps, tillRows, recipes, products, caseSizes, countedIn = null) {
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
      const p = recipeProductByName(ig.product_name, qty, products, caseSizes);
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
      const delivered = epDeliveredQty(ep, countedIn);
      const opening = delivered - Number(ep.damaged_qty || 0);
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

/** Cons £ + Loose £ — used by the consumption_loose / auto budget methods. */
export function consumptionPlusLooseCharge(row) {
  return (Number(row?.consumptionCharge) || 0) + (Number(row?.consumptionLooseCharge) || 0);
}

export function reconBudgetCost(row, cl) {
  const method = cl?.budget_method || 'auto';
  if (method === 'manual') return Number(cl?.budget_override) || 0;
  if (method === 'consumption_loose') return consumptionPlusLooseCharge(row);
  if (method === 'consumption') return row.consumptionCharge;
  if (method === 'plu') return row.pluCharge;
  if (method === 'invoice') return row.invoiceCharge;
  const consPlusLoose = consumptionPlusLooseCharge(row);
  if (row.invoiced > 0) return consPlusLoose;
  return Math.max(consPlusLoose, row.pluCharge || 0);
}

export function varianceClass(consumption, plu, variance) {
  if (consumption === 0 && plu === 0) return '';
  const denom = Math.max(Math.abs(consumption), Math.abs(plu), 0.01);
  const absPct = Math.abs(variance) / denom * 100;
  if (absPct < 8) return 'recon-var-good';
  if (absPct < 15) return 'recon-var-warn';
  return 'recon-var-bad';
}

/**
 * Aggregate this event's delivery lines (and supplier returns) for a product
 * by supplier. Prices come from each delivery's supplier offer (or event
 * override), same as the supplier delivery cost report.
 *
 * When returns exist only as closing_stock.return_amount (no
 * supplier_return_lines), fallbackReturned is attributed to the product's
 * preferred supplier — same heuristic as v2 recon.
 */
export function deliverySourcesForProduct({
  productId,
  deliveries = [],
  supplierReturns = [],
  fallbackReturned = 0,
  event,
  suppliers = [],
  caseSizes = [],
} = {}) {
  if (!productId) return [];
  const bySupplier = new Map();
  const product = event?.event_products?.find((ep) => ep.product_id === productId)?.product;

  const ensure = (sid, nameHint) => {
    const key = sid || '__none__';
    if (!bySupplier.has(key)) {
      const fromList = sid ? supplierName(suppliers, sid) : null;
      bySupplier.set(key, {
        supplierId: sid,
        supplierName: nameHint
          || (fromList && fromList !== '—' ? fromList : null)
          || (sid ? 'Unknown supplier' : 'No supplier'),
        qty: 0,
        returned: 0,
        cost: 0,
        unitPrice: null,
        priceBasis: 'case',
        missingPrice: true,
      });
    }
    return bySupplier.get(key);
  };

  for (const d of deliveries || []) {
    const sid = d.supplier_id || null;
    for (const line of d.lines || []) {
      if (line?.product_id !== productId) continue;
      const priced = costDeliveryLine({
        line,
        supplierId: sid,
        event,
        caseSizes,
        qtyMode: 'received',
      });
      if (!(priced.qty > 0)) continue;

      const fromDelivery = d.supplier?.name;
      const agg = ensure(sid, fromDelivery || null);
      agg.qty = round1(agg.qty + priced.qty);
      agg.cost = roundN(agg.cost + priced.cost, 2);
      if (priced.unitPrice != null) {
        agg.unitPrice = priced.unitPrice;
        agg.priceBasis = priced.priceBasis;
        agg.missingPrice = false;
      }
    }
  }

  for (const r of supplierReturns || []) {
    if (r?.product_id !== productId) continue;
    const form = storedToForm(r);
    const qty = roundN(
      totalUnitsForProduct(form.cases, form.singles, product, caseSizes),
      2,
    );
    if (!(qty > 0)) continue;
    const sid = r.supplier_id || null;
    const agg = ensure(sid, null);
    agg.returned = roundN(agg.returned + qty, 2);
  }

  const attributedReturns = [...bySupplier.values()].reduce((s, x) => s + (x.returned || 0), 0);
  const fallback = Number(fallbackReturned) || 0;
  if (!(attributedReturns > 0) && fallback > 0) {
    const sid = preferredSupplierId(product);
    // Prefer a named delivery supplier on this event when preferred is missing.
    const namedDelivery = [...bySupplier.values()].find((s) => s.supplierId && s.qty > 0);
    const targetId = sid || namedDelivery?.supplierId || null;
    ensure(targetId, null).returned = roundN(fallback, 2);
  }

  return [...bySupplier.values()]
    .filter((s) => s.qty > 0 || s.returned > 0)
    .sort((a, b) => b.qty - a.qty
      || b.returned - a.returned
      || a.supplierName.localeCompare(b.supplierName));
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
    countedIn = null,
    deliveries = null,
  } = ctx;

  const pid = ep.product_id;
  const p = ep.product || {};
  const ups = reconUnitsPerCase(p, caseSizes);
  const delivered = epDeliveredQty(ep, countedIn);

  let invoiced;
  if (draft?.invoiceSet != null) {
    invoiced = draft.invoiceSet ? Number(draft.invoiced) || 0 : closingInvoiceQty(ep);
  } else {
    invoiced = closingInvoiceQty(ep);
  }

  const { closingCases, closingSingles } = resolveClosingCounts(cl, draft);
  const preEventOnHand = ep.already_in_stock != null ? Number(ep.already_in_stock) || 0 : 0;
  const fromReturnLines = supplierReturnCases(supplierReturns, pid, event, caseSizes);
  const supplierReturnsQty = draft?.returnSet != null
    ? roundN(Number(draft.returnStored) || 0, 2)
    : (fromReturnLines
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
  // Loose £ = closing singles ÷ units per case × price (case-equivalent value of leftover singles).
  const consumptionLooseCharge = ups > 0
    ? roundN((Number(closingSingles) || 0) / ups * rowPrice, 2)
    : 0;
  // PLU is already in stock units — charge at the same unit price as consumption.
  const pluCharge = plu * rowPrice;
  const invoiceCharge = invoiced * casePrice;

  const budgetCl = {
    budget_method: draft?.budgetMethod != null ? draft.budgetMethod : cl.budget_method,
    budget_override: draft?.budgetOverride != null ? draft.budgetOverride : cl.budget_override,
  };

  const offers = Array.isArray(p.product_suppliers) ? p.product_suppliers : [];
  const offerPacks = new Set(
    offers.map((o) => String(o.purchase_case_size_id || o.pack_size || o.units_per_case || '')),
  );
  const offerPrices = new Set(
    offers.map((o) => String(o.case_price ?? o.unit_price ?? '')),
  );
  const multiOfferWarn = offers.length > 1 && (offerPacks.size > 1 || offerPrices.size > 1);

  const deliverySources = deliverySourcesForProduct({
    productId: pid,
    deliveries: deliveries || [],
    supplierReturns,
    // Only when there are no per-supplier return lines — closing total alone.
    fallbackReturned: fromReturnLines > 0 ? 0 : supplierReturnsQty,
    event,
    suppliers,
    caseSizes,
  });
  const multiSupplierDelivery = deliverySources.length > 1;
  const sourcePrices = new Set(
    deliverySources
      .map((s) => (s.unitPrice == null ? null : String(s.unitPrice)))
      .filter((v) => v != null),
  );
  const multiSupplierPriceWarn = multiSupplierDelivery && sourcePrices.size > 1;

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
  const hasClosing = !!(cl && (
    cl.closing_cases != null || cl.closing_singles != null || cl.close_count != null
  ));
  const hasInvoice = draft?.invoiceSet != null
    ? !!draft.invoiceSet
    : (ep.invoice_qty != null && ep.invoice_qty !== '');

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
    hasClosing,
    hasInvoice,
    multiOfferWarn,
    deliverySources,
    multiSupplierDelivery,
    multiSupplierPriceWarn,
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
    deliveries,
    showHidden,
    drafts = {},
  } = state;

  const eps = (event?.event_products || [])
    .filter((ep) => ep.product?.name)
    .filter((ep) => (showHidden ? ep.recon_hidden : !ep.recon_hidden));

  const countedIn = deliveries
    ? countedInFromDeliveries(deliveries, event?.event_products, caseSizes)
    : null;
  const pluByPid = computePluByProductId(eps, tillRows, recipes, products, caseSizes, countedIn);
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
    countedIn,
    deliveries,
  }));
}

export function filterReconRows(rows, { statusFilter = '', categoryFilter = '', categories = null } = {}) {
  const catIds = Array.isArray(categories)
    ? categories
    : (categoryFilter ? [categoryFilter] : []);
  return rows.filter((r) => {
    if (statusFilter) {
      const s = r.reconStatus || '';
      if (statusFilter === 'none') { if (s) return false; }
      else if (s !== statusFilter) return false;
    }
    if (catIds.length) {
      const cid = r.p?.category?.id;
      if (!catIds.includes(cid)) return false;
    }
    return true;
  });
}

export function reconTotals(rows) {
  let totBudget = 0;
  let totCons = 0;
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
    totCons += r.consumptionCharge || 0;
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
    totBudget, totCons, totConsLoose, totInvoice, totPlu,
    totConsumption, totPluCases, totVariance, totWastage,
    statusCounts,
  };
}
