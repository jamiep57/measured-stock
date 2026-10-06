/**
 * Loose stock: opened-case singles left at close, charged to the event
 * above any agreed allowance, reconciled against payments received.
 *
 * Allowances (units) are per product or per category. A product allowance
 * covers that product only; a category allowance is pooled across the
 * category's products that have no product allowance of their own.
 * Excess is valued at the recon cost per single (row price ÷ units per case).
 */

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const qty = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {{ reconRows: object[], allowances: object[], payments?: object[] }} input
 *   reconRows: from computeReconRows (uses pid, p, ups, closingSingles, rowPrice)
 *   allowances: loose_stock_allowances rows
 *   payments: loose_stock_payments rows
 */
export function computeLooseStock({ reconRows = [], allowances = [], payments = [] }) {
  const byProduct = new Map();
  const byCategory = new Map();
  allowances.forEach((a) => {
    if (a.product_id) byProduct.set(a.product_id, a);
    else if (a.category_id) byCategory.set(a.category_id, a);
  });

  const lines = reconRows
    .map((r) => {
      const ups = Number(r.ups) || 0;
      const units = Number(r.closingSingles) || 0;
      const unitValue = ups > 0 && Number(r.rowPrice) > 0 ? Number(r.rowPrice) / ups : null;
      return {
        productId: r.pid,
        name: r.p?.name || 'Unknown',
        categoryId: r.p?.category?.id || r.p?.category_id || null,
        categoryName: r.p?.category?.name || 'Uncategorised',
        looseUnits: qty(units),
        unitValue,
        looseValue: unitValue != null ? money(units * unitValue) : null,
      };
    })
    .filter((l) => l.looseUnits > 0 || byProduct.has(l.productId));

  const groups = [];
  const pooled = new Map();

  lines.forEach((l) => {
    const pa = byProduct.get(l.productId);
    if (pa) {
      const allowance = Number(pa.allowance_units) || 0;
      const excessUnits = qty(Math.max(0, l.looseUnits - allowance));
      groups.push({
        scope: 'product',
        allowanceId: pa.id,
        key: `p:${l.productId}`,
        label: l.name,
        categoryName: l.categoryName,
        allowance,
        looseUnits: l.looseUnits,
        excessUnits,
        looseValue: l.looseValue,
        excessValue: l.unitValue != null ? money(excessUnits * l.unitValue) : null,
        unpriced: l.unitValue == null && excessUnits > 0 ? 1 : 0,
        lines: [l],
      });
      return;
    }
    const ca = l.categoryId ? byCategory.get(l.categoryId) : null;
    const key = ca ? `c:${l.categoryId}` : `n:${l.productId}`;
    if (!ca) {
      groups.push({
        scope: 'none',
        allowanceId: null,
        key,
        label: l.name,
        categoryName: l.categoryName,
        allowance: 0,
        looseUnits: l.looseUnits,
        excessUnits: l.looseUnits,
        looseValue: l.looseValue,
        excessValue: l.looseValue,
        unpriced: l.unitValue == null && l.looseUnits > 0 ? 1 : 0,
        lines: [l],
      });
      return;
    }
    if (!pooled.has(key)) {
      pooled.set(key, {
        scope: 'category',
        allowanceId: ca.id,
        key,
        label: `${l.categoryName} (pooled)`,
        categoryName: l.categoryName,
        allowance: Number(ca.allowance_units) || 0,
        lines: [],
      });
    }
    pooled.get(key).lines.push(l);
  });

  pooled.forEach((g) => {
    const looseUnits = qty(g.lines.reduce((s, l) => s + l.looseUnits, 0));
    const excessUnits = qty(Math.max(0, looseUnits - g.allowance));
    const priced = g.lines.filter((l) => l.unitValue != null);
    const pricedUnits = priced.reduce((s, l) => s + l.looseUnits, 0);
    const pricedValue = priced.reduce((s, l) => s + l.looseValue, 0);
    // Pool excess is valued at the pool's average cost per single.
    const avg = pricedUnits > 0 ? pricedValue / pricedUnits : null;
    groups.push({
      ...g,
      looseUnits,
      excessUnits,
      looseValue: priced.length ? money(pricedValue) : null,
      excessValue: avg != null ? money(excessUnits * avg) : null,
      unpriced: g.lines.length - priced.length,
    });
  });

  groups.sort((a, b) => (b.excessValue || 0) - (a.excessValue || 0) || a.label.localeCompare(b.label));

  const chargeable = money(groups.reduce((s, g) => s + (g.excessValue || 0), 0));
  const paid = money(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  return {
    groups,
    totals: {
      looseUnits: qty(groups.reduce((s, g) => s + g.looseUnits, 0)),
      looseValue: money(groups.reduce((s, g) => s + (g.looseValue || 0), 0)),
      excessUnits: qty(groups.reduce((s, g) => s + g.excessUnits, 0)),
      chargeable,
      paid,
      outstanding: money(chargeable - paid),
      overAllowance: groups.filter((g) => g.excessUnits > 0).length,
      unpriced: groups.reduce((s, g) => s + g.unpriced, 0),
    },
  };
}

/** Validate a payment form → { ok, errors, value }. */
export function validateLoosePayment(form) {
  const errors = {};
  const raw = String(form?.amount ?? '').replace(/[£,\s]/g, '');
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount === 0) errors.amount = 'Enter an amount (negative for a refund)';
  else if (Math.abs(amount) > 10000000) errors.amount = 'Amount is too large';
  const paidOn = String(form?.paid_on || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) errors.paid_on = 'Choose the payment date';
  const reference = String(form?.reference || '').trim();
  if (reference.length > 120) errors.reference = 'Reference is too long';
  const notes = String(form?.notes || '').trim();
  if (notes.length > 500) errors.notes = 'Notes are too long';
  const ok = !Object.keys(errors).length;
  return {
    ok,
    errors,
    value: ok ? {
      amount: Math.round(amount * 100) / 100,
      paid_on: paidOn,
      reference: reference || null,
      notes: notes || null,
    } : null,
  };
}
