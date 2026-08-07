/**
 * Event forensic audit — software integrity only (dual-writes, formula drift, sync).
 * Not recon quality, stock variance, or mapping completeness.
 * Panel loads data; this module only analyses a context object.
 */

import {
  buildReconRow,
  closingRowFor,
  computePluByProductId,
  resolveClosingCounts,
  reconClosingTotal,
  roundN,
  supplierReturnCases,
  transferOutByProduct,
  transferOutCases,
  wastageByProduct,
} from './recon.js';
import {
  buildClosingRow,
  hasClosingCount,
} from './closing-stock.js';
import {
  countedInFromDeliveries,
  damagedFromDeliveries,
  distAllocatedToBars,
  epDeliveredQty,
  epOpeningFromSources,
  epOpeningStock,
  leftToAllocate,
} from './opening-stock.js';

const EPS = 0.05;

export const CHECK_META = {
  delivered_consistency: {
    label: 'Delivered consistency',
    relatedPanel: 'deliveries',
    fixHint: 'Re-sync deliveries so event product delivered_qty matches delivery lines.',
  },
  opening_identity: {
    label: 'Opening identity',
    relatedPanel: 'products',
    fixHint: 'Opening should be live delivered − damaged; re-sync deliveries if aggregates lag.',
  },
  closing_identity: {
    label: 'Closing identity',
    relatedPanel: 'closing',
    fixHint: 'carried_over should equal max(0, close_count − return_amount). Returns may exceed close when sourced from a credit note without a full onsite count.',
  },
  recon_consumption: {
    label: 'Recon consumption rebuild',
    relatedPanel: 'recon',
    fixHint: 'Consumption must equal delivered + already_in − damaged − closing − transfers − wastage.',
  },
  damaged_semantics: {
    label: 'Damaged in consumption',
    relatedPanel: 'recon',
    fixHint: 'Damaged must be subtracted from recon consumption (same as opening).',
  },
  return_dual_write: {
    label: 'Return dual-write',
    relatedPanel: 'closing',
    fixHint: 'supplier_return_lines total should match closing_stock.return_amount.',
  },
  distribution_overalloc: {
    label: 'Distribution overallocation',
    relatedPanel: 'distribution',
    fixHint: 'Bar allocations must not exceed opening stock.',
  },
  sync_queue_backlog: {
    label: 'Sync queue backlog',
    relatedPanel: 'counts',
    fixHint: 'Mobile write queue has pending or failed saves — flush or retry.',
  },
  stale_aggregate: {
    label: 'Stale aggregates',
    relatedPanel: 'deliveries',
    fixHint: 'event_products aggregates diverge from live delivery line sums.',
  },
};

export const ALL_CHECK_IDS = Object.keys(CHECK_META);

function nearlyEqual(a, b, eps = EPS) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
}

function productName(ep) {
  return ep?.product?.name || ep?.product_id || 'Unknown';
}

function finding(partial) {
  const meta = CHECK_META[partial.checkId] || {};
  return {
    id: partial.id || `${partial.checkId}:${partial.productId || 'event'}`,
    checkId: partial.checkId,
    severity: partial.severity || 'warn',
    productId: partial.productId || null,
    productName: partial.productName || null,
    expected: partial.expected,
    actual: partial.actual,
    delta: partial.delta != null
      ? partial.delta
      : (partial.expected != null && partial.actual != null
        ? roundN((Number(partial.actual) || 0) - (Number(partial.expected) || 0), 2)
        : null),
    message: partial.message,
    fixHint: partial.fixHint || meta.fixHint || '',
    relatedPanel: partial.relatedPanel || meta.relatedPanel || 'dashboard',
    detail: partial.detail || null,
  };
}

/**
 * Normalise raw panel inputs into a shared audit context with derived maps.
 */
export function buildAuditContext(raw = {}) {
  const event = raw.event || { id: raw.eventId || null, event_products: [] };
  const eventId = event.id || raw.eventId || null;
  const caseSizes = raw.caseSizes || [];
  const eps = event.event_products || [];
  const deliveries = raw.deliveries || [];
  const hasDeliveryLines = deliveries.some((d) => (d.lines || []).length);
  const countedIn = hasDeliveryLines
    ? countedInFromDeliveries(deliveries, eps, caseSizes)
    : null;
  const damagedFromLines = hasDeliveryLines
    ? damagedFromDeliveries(deliveries)
    : {};
  const closingRows = raw.closingRows || [];
  const supplierReturns = raw.supplierReturns || [];
  const transfers = raw.transfers || [];
  const wastageBatches = raw.wastageBatches || [];
  const tillRows = raw.tillRows || [];
  const modifierRows = raw.modifierRows || [];
  const recipes = raw.recipes || [];
  const products = raw.products || eps.map((ep) => ep.product).filter(Boolean);
  const suppliers = raw.suppliers || [];
  const distRows = raw.distRows || [];
  const bars = raw.bars || event.bars || [];
  const isBoneYard = typeof raw.isBoneYard === 'function'
    ? raw.isBoneYard
    : () => false;
  const syncQueueStats = raw.syncQueueStats || null;

  const wastageMap = wastageByProduct(wastageBatches, event, caseSizes);
  const transferMap = transferOutByProduct(transfers, eventId);
  const pluByPid = computePluByProductId(
    eps, tillRows, recipes, products, caseSizes, countedIn, modifierRows,
  );

  const reconRows = eps
    .filter((ep) => ep.product?.name)
    .map((ep) => buildReconRow({
      ep,
      closingRow: closingRowFor(closingRows, ep.product_id) || {},
      pluByPid,
      suppliers,
      caseSizes,
      wastageMap,
      transferMap,
      supplierReturns,
      event,
      countedIn,
      deliveries,
    }));

  return {
    event,
    eventId,
    caseSizes,
    eps,
    deliveries,
    hasDeliveryLines,
    countedIn,
    damagedFromLines,
    closingRows,
    supplierReturns,
    transfers,
    wastageBatches,
    wastageMap,
    transferMap,
    tillRows,
    modifierRows,
    recipes,
    products,
    suppliers,
    distRows,
    bars,
    isBoneYard,
    syncQueueStats,
    pluByPid,
    reconRows,
  };
}

function checkDeliveredConsistency(ctx) {
  if (!ctx.hasDeliveryLines || !ctx.countedIn) return [];
  const out = [];
  for (const ep of ctx.eps) {
    const pid = ep.product_id;
    if (ctx.countedIn[pid] == null) continue;
    const fromLines = Number(ctx.countedIn[pid]) || 0;
    const fromEp = ep.delivered_qty != null ? Number(ep.delivered_qty) || 0 : 0;
    if (nearlyEqual(fromLines, fromEp)) continue;
    out.push(finding({
      checkId: 'delivered_consistency',
      severity: 'error',
      productId: pid,
      productName: productName(ep),
      expected: fromLines,
      actual: fromEp,
      message: `delivered_qty (${fromEp}) ≠ Σ delivery lines (${fromLines})`,
      detail: { countedIn: fromLines, delivered_qty: fromEp },
    }));
  }
  return out;
}

function checkOpeningIdentity(ctx) {
  const out = [];
  for (const ep of ctx.eps) {
    if (!ep.product?.name) continue;
    const pid = ep.product_id;
    const liveOpening = epOpeningFromSources(ep, ctx.countedIn, ctx.damagedFromLines);
    const storedOpening = epOpeningStock(ep);
    const damagedLive = ctx.damagedFromLines?.[pid] != null
      ? Number(ctx.damagedFromLines[pid]) || 0
      : Number(ep.damaged_qty || 0);
    const deliveredLive = epDeliveredQty(ep, ctx.countedIn);

    if (damagedLive > deliveredLive + EPS) {
      out.push(finding({
        checkId: 'opening_identity',
        id: `opening_identity:over-damage:${pid}`,
        severity: 'warn',
        productId: pid,
        productName: productName(ep),
        expected: deliveredLive,
        actual: damagedLive,
        message: `Damaged (${damagedLive}) exceeds delivered (${deliveredLive})`,
      }));
    }

    // Stored aggregates out of sync with live delivery sums → opening would drift
    // if a panel still used event_products only.
    if (
      ctx.hasDeliveryLines
      && ctx.countedIn
      && !nearlyEqual(liveOpening, storedOpening)
    ) {
      out.push(finding({
        checkId: 'opening_identity',
        id: `opening_identity:stale:${pid}`,
        severity: 'warn',
        productId: pid,
        productName: productName(ep),
        expected: liveOpening,
        actual: storedOpening,
        message: `Stored opening ${storedOpening} ≠ live delivery opening ${liveOpening}`,
        detail: {
          countedIn: ctx.countedIn[pid],
          delivered_qty: ep.delivered_qty,
          damaged_live: damagedLive,
          damaged_qty: ep.damaged_qty,
        },
        fixHint: 'Re-save deliveries to sync event_products, or rely on live delivery sums.',
      }));
    }
  }
  return out;
}

function checkClosingIdentity(ctx) {
  const out = [];
  for (const ep of ctx.eps) {
    if (!ep.product?.name) continue;
    const pid = ep.product_id;
    const cl = closingRowFor(ctx.closingRows, pid);
    if (!cl || !hasClosingCount(cl)) continue;

    // Same row model as the Closing panel — avoids false positives from
    // re-deriving return/close with a different unit path.
    const row = buildClosingRow({
      ep,
      closingRow: cl,
      suppliers: ctx.suppliers,
      caseSizes: ctx.caseSizes,
      event: ctx.event,
      supplierReturns: ctx.supplierReturns,
    });
    const closeCount = Number(row.closeCount) || 0;
    const returnAmt = Number(row.returnAmount) || 0;
    const expectedCarried = Number(row.carriedOver) || 0;
    const fromLines = supplierReturnCases(ctx.supplierReturns, pid, ctx.event, ctx.caseSizes);
    const detail = {
      closeCases: row.closingCases,
      closeSingles: row.closingSingles,
      closeCount,
      returnCases: row.returnCases,
      returnSingles: row.returnSingles,
      returnAmount: returnAmt,
      returnFromLines: fromLines,
      returnStored: cl.return_amount != null ? Number(cl.return_amount) || 0 : null,
      carriedOver: expectedCarried,
      carriedStored: cl.carried_over != null ? Number(cl.carried_over) || 0 : null,
    };

    // Do not flag return > close: onsite often skips a full close and records
    // return qty from the supplier credit note (close may be 0 / partial).
    if (cl.carried_over != null && !nearlyEqual(cl.carried_over, expectedCarried)) {
      out.push(finding({
        checkId: 'closing_identity',
        severity: 'error',
        productId: pid,
        productName: productName(ep),
        expected: expectedCarried,
        actual: Number(cl.carried_over) || 0,
        message: `Stored carried_over ≠ max(0, close − return)`,
        detail,
      }));
    }
    if (cl.close_count != null && !nearlyEqual(cl.close_count, closeCount, 0.01)) {
      out.push(finding({
        checkId: 'closing_identity',
        id: `closing_identity:close-count:${pid}`,
        severity: 'warn',
        productId: pid,
        productName: productName(ep),
        expected: closeCount,
        actual: Number(cl.close_count) || 0,
        message: `Stored close_count ≠ cases+singles total`,
        detail,
      }));
    }
  }
  return out;
}

function checkReconConsumption(ctx) {
  const out = [];
  for (const row of ctx.reconRows) {
    const ep = row.ep;
    const pid = row.pid;
    const cl = closingRowFor(ctx.closingRows, pid) || {};
    const { closingCases, closingSingles } = resolveClosingCounts(cl, null);
    const closingTotal = reconClosingTotal(ep.product, closingCases, closingSingles, ctx.caseSizes);
    const hasClose = hasClosingCount(cl) || closingTotal > 0;
    let stockRem = 0;
    if (hasClose || closingTotal > 0) stockRem = roundN(closingTotal, 2);
    else if (cl.carried_over != null && cl.return_amount != null) {
      stockRem = roundN((Number(cl.carried_over) || 0) + (Number(cl.return_amount) || 0), 2);
    } else if (cl.return_amount != null) {
      stockRem = roundN(Number(cl.return_amount) || 0, 2);
    }
    const preEvent = ep.already_in_stock != null ? Number(ep.already_in_stock) || 0 : 0;
    const damaged = Number(ep.damaged_qty || 0);
    const transferred = transferOutCases(ctx.transferMap, pid, ctx.event, ctx.caseSizes);
    const wastage = ctx.wastageMap[pid] || 0;
    const delivered = epDeliveredQty(ep, ctx.countedIn);
    const rebuilt = roundN(
      delivered + preEvent - damaged - stockRem - transferred - wastage,
      2,
    );
    if (!nearlyEqual(rebuilt, row.consumption, 0.01)) {
      out.push(finding({
        checkId: 'recon_consumption',
        severity: 'error',
        productId: pid,
        productName: productName(ep),
        expected: rebuilt,
        actual: row.consumption,
        message: `Recon consumption ${row.consumption} ≠ rebuilt formula ${rebuilt}`,
        detail: {
          delivered, preEvent, damaged, stockRem, transferred, wastage,
        },
      }));
    }
  }
  return out;
}

function checkDamagedSemantics(ctx) {
  const out = [];
  for (const ep of ctx.eps) {
    const damaged = Number(ep.damaged_qty || 0);
    if (!(damaged > 0)) continue;
    const row = ctx.reconRows.find((r) => r.pid === ep.product_id);
    if (!row) continue;

    if (!nearlyEqual(Number(row.damaged) || 0, damaged, 0.01)) {
      out.push(finding({
        checkId: 'damaged_semantics',
        severity: 'error',
        productId: ep.product_id,
        productName: productName(ep),
        expected: damaged,
        actual: row.damaged,
        message: `Recon row damaged (${row.damaged ?? '—'}) ≠ event damaged_qty (${damaged})`,
      }));
    }
  }
  return out;
}

function checkReturnDualWrite(ctx) {
  const out = [];
  const pids = new Set([
    ...ctx.closingRows.map((c) => c.product_id),
    ...ctx.supplierReturns.map((r) => r.product_id),
  ].filter(Boolean));

  for (const pid of pids) {
    const ep = ctx.eps.find((e) => e.product_id === pid);
    const cl = closingRowFor(ctx.closingRows, pid);
    const linesQty = supplierReturnCases(ctx.supplierReturns, pid, ctx.event, ctx.caseSizes);
    const stored = cl?.return_amount != null ? Number(cl.return_amount) || 0 : null;
    const hasLines = (ctx.supplierReturns || []).some((r) => r.product_id === pid);
    if (!hasLines && stored == null) continue;
    if (hasLines && stored != null && !nearlyEqual(linesQty, stored)) {
      out.push(finding({
        checkId: 'return_dual_write',
        severity: 'error',
        productId: pid,
        productName: productName(ep) || pid,
        expected: linesQty,
        actual: stored,
        message: `supplier_return_lines (${linesQty}) ≠ closing return_amount (${stored})`,
      }));
    } else if (hasLines && stored == null && linesQty > 0) {
      out.push(finding({
        checkId: 'return_dual_write',
        severity: 'warn',
        productId: pid,
        productName: productName(ep) || pid,
        expected: linesQty,
        actual: null,
        message: `Return lines exist (${linesQty}) but closing_stock.return_amount is empty`,
      }));
    } else if (!hasLines && stored > 0) {
      out.push(finding({
        checkId: 'return_dual_write',
        id: `return_dual_write:closing-only:${pid}`,
        severity: 'info',
        productId: pid,
        productName: productName(ep) || pid,
        expected: stored,
        actual: 0,
        message: `Return only on closing_stock (${stored}) — no supplier_return_lines`,
      }));
    }
  }
  return out;
}

function checkDistributionOveralloc(ctx) {
  const out = [];
  if (!(ctx.distRows || []).length) return out;
  for (const ep of ctx.eps) {
    if (!ep.product?.name) continue;
    const pid = ep.product_id;
    const opening = epOpeningFromSources(ep, ctx.countedIn, ctx.damagedFromLines);
    const allocated = distAllocatedToBars(ctx.distRows, pid, ctx.bars, ctx.isBoneYard);
    const left = leftToAllocate(opening, allocated);
    if (left < -EPS) {
      out.push(finding({
        checkId: 'distribution_overalloc',
        severity: 'error',
        productId: pid,
        productName: productName(ep),
        expected: opening,
        actual: allocated,
        message: `Allocated ${allocated} exceeds opening ${opening} (over by ${roundN(-left, 1)})`,
        detail: { left },
      }));
    }
  }
  return out;
}

function checkSyncQueueBacklog(ctx) {
  const stats = ctx.syncQueueStats;
  if (!stats) return [];
  const pending = Number(stats.pending) || 0;
  const failed = Number(stats.failed) || 0;
  if (pending + failed <= 0) return [];
  return [finding({
    checkId: 'sync_queue_backlog',
    severity: failed > 0 ? 'error' : 'warn',
    productId: null,
    productName: null,
    expected: 0,
    actual: pending + failed,
    message: `Write queue: ${pending} pending, ${failed} failed`,
    detail: stats,
  })];
}

function checkStaleAggregate(ctx) {
  if (!ctx.hasDeliveryLines || !ctx.countedIn) return [];
  const out = [];
  // Delivered qty drift (same as consistency but also covers invoice when present on lines).
  for (const ep of ctx.eps) {
    const pid = ep.product_id;
    if (ctx.countedIn[pid] == null) continue;
    const fromLines = Number(ctx.countedIn[pid]) || 0;
    const fromEp = ep.delivered_qty != null ? Number(ep.delivered_qty) || 0 : null;
    if (fromEp != null && !nearlyEqual(fromLines, fromEp)) {
      // Prefer delivered_consistency for the primary message; only emit stale if
      // invoice also looks off or we want a deliveries-panel hint already covered.
      continue;
    }
    const lineDamaged = ctx.damagedFromLines[pid];
    if (lineDamaged != null) {
      const epDamaged = Number(ep.damaged_qty || 0);
      if (!nearlyEqual(lineDamaged, epDamaged)) {
        out.push(finding({
          checkId: 'stale_aggregate',
          severity: 'error',
          productId: pid,
          productName: productName(ep),
          expected: lineDamaged,
          actual: epDamaged,
          message: `damaged_qty (${epDamaged}) ≠ Σ delivery line damaged (${lineDamaged})`,
        }));
      }
    }
  }
  // Also flag when countedIn has products missing from event_products delivered entirely.
  for (const [pid, qty] of Object.entries(ctx.countedIn)) {
    if (!(Number(qty) > 0)) continue;
    const ep = ctx.eps.find((e) => String(e.product_id) === String(pid));
    if (!ep) {
      out.push(finding({
        checkId: 'stale_aggregate',
        id: `stale_aggregate:orphan-line:${pid}`,
        severity: 'warn',
        productId: pid,
        productName: pid,
        expected: Number(qty) || 0,
        actual: null,
        message: `Delivery lines for product not on event catalogue`,
      }));
    }
  }
  return out;
}

export const CHECKS = [
  { id: 'delivered_consistency', run: checkDeliveredConsistency },
  { id: 'opening_identity', run: checkOpeningIdentity },
  { id: 'closing_identity', run: checkClosingIdentity },
  { id: 'recon_consumption', run: checkReconConsumption },
  { id: 'damaged_semantics', run: checkDamagedSemantics },
  { id: 'return_dual_write', run: checkReturnDualWrite },
  { id: 'distribution_overalloc', run: checkDistributionOveralloc },
  { id: 'sync_queue_backlog', run: checkSyncQueueBacklog },
  { id: 'stale_aggregate', run: checkStaleAggregate },
];

/**
 * @param {object} rawOrCtx — raw audit inputs or result of buildAuditContext
 * @param {{ checkIds?: string[] }} [opts]
 * @returns {{ eventId, ranAt, summary, findings, ctx }}
 */
export function runEventAudit(rawOrCtx = {}, opts = {}) {
  const ctx = rawOrCtx.reconRows && rawOrCtx.eps
    ? rawOrCtx
    : buildAuditContext(rawOrCtx);

  const allow = opts.checkIds
    ? new Set(opts.checkIds)
    : null;

  const findings = [];
  for (const check of CHECKS) {
    if (allow && !allow.has(check.id)) continue;
    try {
      findings.push(...(check.run(ctx) || []));
    } catch (err) {
      findings.push(finding({
        checkId: check.id,
        severity: 'error',
        expected: 'ok',
        actual: 'threw',
        delta: null,
        message: `Check “${check.id}” threw: ${err?.message || err}`,
        fixHint: 'Bug in audit engine — see console.',
      }));
    }
  }

  const summary = { errors: 0, warns: 0, infos: 0 };
  for (const f of findings) {
    if (f.severity === 'error') summary.errors += 1;
    else if (f.severity === 'warn') summary.warns += 1;
    else summary.infos += 1;
  }

  return {
    eventId: ctx.eventId,
    ranAt: new Date().toISOString(),
    summary,
    findings,
    ctx,
  };
}

export function filterFindings(findings, {
  severity = '',
  checkId = '',
  query = '',
} = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (findings || []).filter((f) => {
    if (severity && f.severity !== severity) return false;
    if (checkId && f.checkId !== checkId) return false;
    if (q) {
      const hay = [
        f.productName, f.message, f.checkId, f.fixHint, CHECK_META[f.checkId]?.label,
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
