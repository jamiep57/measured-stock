/**
 * Post-event recon CSV. Shared by the Recon page and the Reports library
 * so both downloads stay the same file.
 */

const STATUS_TITLES = {
  red: 'Action needed',
  yellow: 'Review',
  green: 'Done',
  blue: 'None returned',
};

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {object[]} rows recon rows (hidden rows already removed)
 * @returns {string}
 */
export function reconCsv(rows) {
  const headers = [
    'Status', 'Item', 'Case Size', 'ABV', 'Price', 'Supplier', 'Units per case',
    'Delivered', 'Invoiced', 'Closing (Cases)', 'Closing (Singles)',
    'Returned to supplier', 'Transferred', 'Wastage', 'Consumption', 'PLU', 'Variance', 'Variance %',
    'Consumption Charge', 'Loose Charge', 'PLU Charge', 'Invoice Charge', 'Budget Cost', 'Notes',
  ];
  const lines = [headers.map(csvEscape).join(',')];
  let totBudget = 0;
  (rows || []).forEach((r) => {
    totBudget += r.budgetCost || 0;
    lines.push([
      STATUS_TITLES[r.reconStatus] || '',
      r.p?.name, r.p?.case_size || '',
      r.p?.abv != null ? `${Number(r.p.abv).toFixed(2)}%` : '',
      r.rowPrice ? r.rowPrice.toFixed(2) : '',
      r.supplierName, r.ups || '',
      r.delivered, r.invoiced, r.closingCases, r.closingSingles,
      r.supplierReturns, r.transferred, r.wastage, r.consumption, r.plu,
      r.variance, r.variancePct != null ? `${r.variancePct}%` : '',
      r.consumptionCharge, r.consumptionLooseCharge, r.pluCharge, r.invoiceCharge,
      r.budgetCost, r.reconNote,
    ].map(csvEscape).join(','));
  });
  lines.push(Array(headers.length - 1).fill('').concat([totBudget.toFixed(2)]).map(csvEscape).join(','));
  return lines.join('\r\n');
}
