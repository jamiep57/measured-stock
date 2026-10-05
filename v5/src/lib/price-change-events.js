/**
 * Library price edits vs the price already copied onto events for recon.
 * A change only matters when the preferred supplier price (the one recon
 * captured) is different, and an event still has the old copy.
 */

function money(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

export function sameMoney(a, b) {
  return money(a) === money(b);
}

/** Preferred offer, else the first row. Form rows use `price`; saved rows use case/unit. */
export function reconPricesFromOffers(offers, unitsPerCase, { fromForm = false } = {}) {
  const rows = offers || [];
  const preferred = rows.find((o) => o.is_preferred) || rows[0] || null;
  if (!preferred) return { casePrice: null, unitPrice: null };
  const upc = Number(unitsPerCase) > 0 ? Number(unitsPerCase) : 1;
  if (fromForm) {
    if (preferred.price == null || preferred.price === '') return { casePrice: null, unitPrice: null };
    const n = money(preferred.price);
    if (n == null) return { casePrice: null, unitPrice: null };
    return { casePrice: n, unitPrice: money(n / upc) };
  }
  return {
    casePrice: money(preferred.case_price),
    unitPrice: money(preferred.unit_price),
  };
}

export function reconPriceChanged(before, after) {
  return !sameMoney(before?.casePrice, after?.casePrice)
    || !sameMoney(before?.unitPrice, after?.unitPrice);
}

/** Events whose captured recon price is not already the new library price. Archived events stay as filed. */
export function eventsAffectedByPriceChange(rows, next) {
  return (rows || []).filter((ep) => {
    const status = ep.event?.status;
    if (!ep.event?.name || status === 'archived') return false;
    return !sameMoney(ep.case_price_snapshot, next?.casePrice)
      || !sameMoney(ep.unit_price_snapshot, next?.unitPrice);
  }).sort((a, b) => a.event.name.localeCompare(b.event.name));
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function priceChangeCopy(events) {
  const names = (events || []).map((ep) => ep.event.name);
  const one = names.length === 1;
  const list = joinNames(names);
  return {
    message: `This price change will update on ${list} and affect the reconciliation.`,
    keepLabel: `Update product price and don't change ${one ? 'event' : 'events'}`,
    applyLabel: one
      ? `Update product and update ${names[0]}`
      : `Update product and update ${names.length} events`,
    cancelLabel: 'Do not update',
  };
}
