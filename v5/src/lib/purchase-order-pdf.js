/**
 * Supplier-facing purchase order PDF. Shows what we are buying and the
 * agreed case prices — never selling prices or GP.
 */

import { createBrandDoc, formatDocDate, formatMoney, safeFilePart } from './brand-pdf.js';
import { orderLinesTotal } from './order-compare.js';

const STATUS_LABEL = {
  draft: 'Draft',
  sent: 'Sent',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

/**
 * @param {{
 *   po: { reference: string, status: string, order_date?: string, delivery_date?: string, supplier_ref?: string, notes?: string },
 *   supplier: { name: string, contact_name?: string, email?: string, phone?: string, address?: string }|null,
 *   event: { name: string, venue?: string, venue_postcode?: string, start_date?: string, end_date?: string }|null,
 *   lines: Array<{ name: string, pack?: string, qty_cases: number, case_price: number|null }>,
 *   contact?: { name?: string, email?: string, phone?: string }|null,
 * }} input
 */
export async function generatePurchaseOrderPDF({ po, supplier, event, lines = [], contact = null }) {
  if (!lines.length) throw new Error('This order has no lines to print.');
  const ctx = await createBrandDoc({ title: 'Purchase order' });
  ctx.continuationNote = po.reference;

  const status = STATUS_LABEL[po.status] || po.status;
  ctx.header({
    meta: [
      po.reference,
      `Order date  ${po.order_date ? formatDocDate(po.order_date) : '—'}`,
      po.delivery_date ? `Deliver by  ${formatDocDate(po.delivery_date)}` : null,
      po.supplier_ref ? `Your ref  ${po.supplier_ref}` : null,
      status !== 'Confirmed' && status !== 'Sent' ? `Status  ${status}` : null,
    ],
    parties: [
      {
        label: 'Supplier',
        lines: [supplier?.name || '—', supplier?.contact_name, supplier?.email, supplier?.phone],
      },
      {
        label: 'Deliver to',
        lines: [
          event?.name || '—',
          event?.venue,
          event?.venue_postcode,
          event?.start_date ? formatDocDate(event.start_date) : null,
        ],
      },
      {
        label: 'Order contact',
        lines: contact ? [contact.name, contact.email, contact.phone] : ['Measured', 'live@measured.events'],
      },
    ],
  });

  const anyPrice = lines.some((l) => l.case_price != null);
  const columns = [
    { label: 'Product', width: 46 },
    { label: 'Pack', width: 20, muted: true },
    { label: 'Cases', width: 11, align: 'right' },
  ];
  if (anyPrice) {
    columns.push({ label: 'Case price', width: 14, align: 'right' });
    columns.push({ label: 'Amount', width: 14, align: 'right' });
  }
  const rows = lines.map((l, i) => {
    const cells = [l.name, l.pack || '', String(l.qty_cases)];
    if (anyPrice) {
      cells.push(l.case_price == null ? '—' : formatMoney(Number(l.case_price)));
      cells.push(l.case_price == null ? '—' : formatMoney(Number(l.case_price) * Number(l.qty_cases)));
    }
    return { cells, band: i % 2 === 1 };
  });
  ctx.table(columns, rows);

  const totalCases = lines.reduce((s, l) => s + (Number(l.qty_cases) || 0), 0);
  const pairs = [['Total cases', String(totalCases)]];
  if (anyPrice) {
    const { total, priced, lines: count } = orderLinesTotal(lines);
    if (priced < count) pairs.push(['Unpriced lines', String(count - priced)]);
    pairs.push(['Order value (ex VAT)', formatMoney(total), true]);
  }
  ctx.totals(pairs);

  if (po.notes) {
    ctx.y += 4;
    ctx.sectionTitle('Notes');
    ctx.paragraph(po.notes);
  }
  ctx.y += 2;
  ctx.paragraph('Please confirm quantities, prices and delivery date by reply quoting the order reference above.', { size: 8.5 });

  return ctx.finish(`${safeFilePart(po.reference)}_${safeFilePart(supplier?.name)}.pdf`);
}
