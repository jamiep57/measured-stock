/**
 * Gross profit maths for menu planning.
 *
 * Menu prices are VAT-inclusive (what the customer pays). GP is measured on
 * the net (ex-VAT) price:  GP% = (net − cost) / net.
 * Percentages are 0–100 numbers throughout (70 = 70%).
 */

export const DEFAULT_VAT_RATE = 0.2;
export const DEFAULT_TARGET_GP_PCT = 70;
export const DEFAULT_AMBER_BAND = 5;
export const DEFAULT_PRICE_STEP = 0.05;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function vatOf(vatRate) {
  const v = num(vatRate);
  return v != null && v >= 0 && v < 1 ? v : DEFAULT_VAT_RATE;
}

export function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Round up to the next price step (0.05 → £6.83 becomes £6.85). */
export function roundUpToStep(value, step = DEFAULT_PRICE_STEP) {
  const v = num(value);
  if (v == null) return null;
  const s = num(step);
  if (!s || s <= 0) return roundMoney(v);
  const units = Math.ceil(Math.round((v / s) * 1e6) / 1e6);
  return roundMoney(units * s);
}

export function netFromGross(gross, vatRate) {
  const g = num(gross);
  if (g == null) return null;
  return g / (1 + vatOf(vatRate));
}

/** Cost of one serve from cost per stock unit and serves per unit. */
export function costPerServe(unitCost, servesPerUnit) {
  const c = num(unitCost);
  const s = num(servesPerUnit);
  if (c == null || s == null || s <= 0) return null;
  return c / s;
}

/** GP% for a VAT-inclusive price; null when price or cost is unknown. */
export function gpPct(price, servedCost, vatRate) {
  const net = netFromGross(price, vatRate);
  const cost = num(servedCost);
  if (net == null || cost == null || net <= 0) return null;
  return ((net - cost) / net) * 100;
}

/** GP £ per serve (net price − cost). */
export function gpPerServe(price, servedCost, vatRate) {
  const net = netFromGross(price, vatRate);
  const cost = num(servedCost);
  if (net == null || cost == null) return null;
  return net - cost;
}

/**
 * VAT-inclusive selling price needed to hit a target GP%, rounded up to
 * the price step so the rounded price still meets the target.
 */
export function requiredPrice(servedCost, targetGpPct, vatRate, step = DEFAULT_PRICE_STEP) {
  const cost = num(servedCost);
  const target = num(targetGpPct);
  if (cost == null || target == null || target >= 100 || target <= -100) return null;
  const net = cost / (1 - target / 100);
  return roundUpToStep(net * (1 + vatOf(vatRate)), step);
}

/**
 * Traffic-light status against target.
 *   green — at or above target
 *   amber — within `amberBand` percentage points below target
 *   red   — further below
 */
export function gpStatus(gp, targetGpPct, amberBand = DEFAULT_AMBER_BAND) {
  const g = num(gp);
  const t = num(targetGpPct);
  if (g == null || t == null) return null;
  const band = Math.max(0, num(amberBand) ?? DEFAULT_AMBER_BAND);
  if (g >= t - 1e-9) return 'green';
  if (g >= t - band - 1e-9) return 'amber';
  return 'red';
}

/**
 * Aggregate GP across a product mix, weighted by projected serves.
 * Lines missing price, cost or serves are excluded and counted.
 * @param {{ price: number, costPerServe: number, serves: number }[]} lines
 */
export function mixGp(lines, vatRate) {
  let revenueGross = 0;
  let revenueNet = 0;
  let cost = 0;
  let serves = 0;
  let included = 0;
  let excluded = 0;
  (lines || []).forEach((line) => {
    const price = num(line.price);
    const c = num(line.costPerServe);
    const s = num(line.serves);
    if (price == null || c == null || s == null || s <= 0) {
      if (s != null && s > 0) excluded += 1;
      return;
    }
    const net = netFromGross(price, line.vatRate ?? vatRate);
    revenueGross += price * s;
    revenueNet += net * s;
    cost += c * s;
    serves += s;
    included += 1;
  });
  const gpAmount = revenueNet - cost;
  return {
    revenueGross: roundMoney(revenueGross),
    revenueNet: roundMoney(revenueNet),
    cost: roundMoney(cost),
    gpAmount: roundMoney(gpAmount),
    gpPct: revenueNet > 0 ? (gpAmount / revenueNet) * 100 : null,
    serves,
    included,
    excluded,
  };
}

export function formatGpPct(gp) {
  const g = num(gp);
  if (g == null) return '—';
  return `${g.toFixed(1)}%`;
}
