/**
 * Client transfer invoice PDF — layout inspired by a clean commercial
 * invoice template (left title/meta, right from-address, hairline sections).
 */

import { loadJsPdf, loadLogoForPdf } from './delivery-note-pdf.js';

export const INVOICE_FROM = {
  name: 'Measured',
  addressLines: [
    '124 City Road',
    'London, EC1V 2NX',
  ],
  email: 'live@measured.events',
  website: 'measured.events',
};

/** UK standard VAT rate applied to invoice totals. */
export const INVOICE_VAT_RATE = 0.2;

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * @param {number} subtotal ex-VAT amount
 * @param {number} [vatRate]
 * @returns {{ net: number, vat: number, total: number, vatRate: number }}
 */
export function invoiceVatBreakdown(subtotal, vatRate = INVOICE_VAT_RATE) {
  const rate = Number.isFinite(vatRate) ? vatRate : INVOICE_VAT_RATE;
  const net = roundMoney(subtotal);
  const vat = roundMoney(net * rate);
  return { net, vat, total: roundMoney(net + vat), vatRate: rate };
}

export function formatInvoiceMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatInvoiceDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'short' }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function buildInvoiceNumber({ eventName = '', recipientName = '', date = new Date() } = {}) {
  const eventSlug = String(eventName || 'event')
    .replace(/[^a-z0-9]+/gi, '')
    .slice(0, 8)
    .toUpperCase() || 'EVENT';
  const recipSlug = String(recipientName || 'client')
    .replace(/[^a-z0-9]+/gi, '')
    .slice(0, 6)
    .toUpperCase() || 'CLIENT';
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `INV-${eventSlug}-${recipSlug}-${y}${m}${day}`;
}

function safeFilePart(s) {
  return String(s || 'export').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'export';
}

function logoSize(logo, maxW, maxH) {
  const aspect = logo.width / logo.height;
  let logoW = maxW;
  let logoH = logoW / aspect;
  if (logoH > maxH) {
    logoH = maxH;
    logoW = logoH * aspect;
  }
  return { logoW, logoH };
}

/**
 * @param {object} options
 * @param {string} options.eventName
 * @param {Date} [options.date]
 * @param {Array<{
 *   recipientName: string,
 *   products: Array<{
 *     productName: string,
 *     qtyLabel: string,
 *     unitPrice: number|null,
 *     cost: number,
 *     missingPrice?: boolean,
 *   }>,
 *   totalCost?: number,
 *   transferCount?: number,
 *   invoiceNumber?: string,
 * }>} options.invoices
 */
export async function generateRecipientInvoicePDF({
  eventName = '',
  date = new Date(),
  invoices = [],
} = {}) {
  const sections = (invoices || []).filter((inv) => inv && (inv.products?.length || inv.recipientName));
  if (!sections.length) {
    throw new Error('Nothing to invoice — no client transfers match these filters.');
  }

  const [jspdf, logo] = await Promise.all([
    loadJsPdf(),
    loadLogoForPdf(),
  ]);
  const { jsPDF } = jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  const pageW = 210;
  const pageH = 297;
  const ml = 18;
  const mr = 18;
  const contentW = pageW - ml - mr;
  const bottomMargin = 18;
  const black = [17, 17, 17];
  const grey = [90, 90, 90];
  const muted = [130, 130, 130];
  const rule = [200, 200, 200];
  const colDesc = contentW * 0.46;
  const colQty = contentW * 0.18;
  const colUnit = contentW * 0.18;
  const colAmt = contentW - colDesc - colQty - colUnit;
  const rowH = 7.5;
  const invoiceDate = date instanceof Date ? date : new Date(date);
  const dateStr = formatInvoiceDate(invoiceDate);

  function setFont(style, size, color) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor.apply(doc, color || black);
  }

  function hairline(y, weight = 0.35) {
    doc.setDrawColor.apply(doc, rule);
    doc.setLineWidth(weight);
    doc.line(ml, y, pageW - mr, y);
  }

  function stampPages() {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      setFont('normal', 7.5, muted);
      doc.text(`${p} / ${total}`, pageW / 2, pageH - 8, { align: 'center' });
    }
  }

  function drawInvoiceHeader(inv, isContinuation) {
    if (isContinuation) {
      setFont('bold', 18, black);
      doc.text('INVOICE', ml, 18);
      setFont('normal', 9, muted);
      doc.text('continued', ml, 24);
      setFont('normal', 9, grey);
      doc.text(inv.recipientName || '—', ml, 34);
      doc.text(inv.invoiceNumber || '', pageW - mr, 34, { align: 'right' });
      hairline(38);
      return 46;
    }

    // Left: title + meta
    setFont('bold', 32, black);
    doc.text('INVOICE', ml, 22);

    setFont('bold', 10, black);
    doc.text(dateStr, ml, 32);
    doc.text(inv.invoiceNumber || '—', ml, 37.5);

    // Right: logo + from block (address / contact — no name under logo)
    let rightY = 14;
    if (logo) {
      const { logoW, logoH } = logoSize(logo, 34, 11);
      doc.addImage(
        logo.dataUrl,
        logo.format || 'JPEG',
        pageW - mr - logoW,
        rightY,
        logoW,
        logoH,
        'invoice-logo',
      );
      rightY += logoH + 5;
    }

    setFont('normal', 9, grey);
    for (const line of INVOICE_FROM.addressLines) {
      doc.text(line, pageW - mr, rightY, { align: 'right' });
      rightY += 4.2;
    }
    doc.text(INVOICE_FROM.email, pageW - mr, rightY, { align: 'right' });
    rightY += 4.2;
    doc.text(INVOICE_FROM.website, pageW - mr, rightY, { align: 'right' });
    rightY += 4.2;

    const yRule = Math.max(50, rightY + 2);
    hairline(yRule);

    // Customer / event row — one combined bill (no transfer split)
    let y = yRule + 8;
    setFont('bold', 7.5, muted);
    doc.text('CUSTOMER', ml, y);
    doc.text('EVENT', pageW - mr, y, { align: 'right' });
    y += 5.5;
    setFont('bold', 11, black);
    doc.text(inv.recipientName || '—', ml, y);
    setFont('normal', 10, black);
    doc.text(eventName || '—', pageW - mr, y, { align: 'right' });

    hairline(y + 5);
    return y + 12;
  }

  function drawTableHeader(startY) {
    let y = startY;
    setFont('bold', 7.5, muted);
    doc.text('DESCRIPTION', ml, y);
    doc.text('QUANTITY', ml + colDesc + colQty, y, { align: 'right' });
    doc.text('UNIT PRICE', ml + colDesc + colQty + colUnit, y, { align: 'right' });
    doc.text('AMOUNT', pageW - mr, y, { align: 'right' });
    return y + 5;
  }

  function drawRow(product, y) {
    if (!product) return;
    setFont('normal', 9.5, black);
    doc.text(String(product.productName || '').slice(0, 48), ml, y + 4.5);
    doc.text(product.qtyLabel || '—', ml + colDesc + colQty, y + 4.5, { align: 'right' });
    const unitText = product.missingPrice || product.unitPrice == null
      ? '—'
      : formatInvoiceMoney(product.unitPrice);
    doc.text(unitText, ml + colDesc + colQty + colUnit, y + 4.5, { align: 'right' });
    const costText = product.missingPrice
      ? '—'
      : formatInvoiceMoney(product.cost);
    doc.text(costText, pageW - mr, y + 4.5, { align: 'right' });
  }

  function drawTotals(inv, startY) {
    let y = startY + 2;
    hairline(y, 0.45);
    y += 1.2;
    hairline(y, 0.45);
    y += 8;

    const subtotal = Number.isFinite(inv.totalCost)
      ? inv.totalCost
      : (inv.products || []).reduce((s, p) => s + (Number(p.cost) || 0), 0);
    const { net, vat, total, vatRate } = invoiceVatBreakdown(subtotal);
    const vatPctLabel = `${Math.round(vatRate * 100)}%`;
    const labelX = ml + colDesc + colQty + colUnit - 8;

    setFont('normal', 9.5, grey);
    doc.text('SUBTOTAL', labelX, y, { align: 'right' });
    doc.text(formatInvoiceMoney(net), pageW - mr, y, { align: 'right' });
    y += 6;
    doc.text(`VAT (${vatPctLabel})`, labelX, y, { align: 'right' });
    doc.text(formatInvoiceMoney(vat), pageW - mr, y, { align: 'right' });
    y += 7;

    setFont('bold', 10, black);
    doc.text('TOTAL', labelX, y, { align: 'right' });
    doc.text(formatInvoiceMoney(total), pageW - mr, y, { align: 'right' });
    return y + 4;
  }

  function ensureSpace(needed, inv, state) {
    if (state.y + needed <= pageH - bottomMargin) return;
    doc.addPage();
    state.y = drawTableHeader(drawInvoiceHeader(inv, true));
  }

  sections.forEach((raw, sectionIndex) => {
    const inv = {
      ...raw,
      invoiceNumber: raw.invoiceNumber || buildInvoiceNumber({
        eventName,
        recipientName: raw.recipientName,
        date: invoiceDate,
      }),
    };
    if (sectionIndex > 0) doc.addPage();

    const state = { y: drawTableHeader(drawInvoiceHeader(inv, false)) };
    const products = inv.products || [];

    const totalsH = 36;
    if (!products.length) {
      ensureSpace(rowH + totalsH, inv, state);
      state.y += rowH;
    } else {
      for (let i = 0; i < products.length; i++) {
        ensureSpace(rowH + (i === products.length - 1 ? totalsH : 0), inv, state);
        drawRow(products[i], state.y);
        state.y += rowH;
      }
    }

    ensureSpace(totalsH, inv, state);
    drawTotals(inv, state.y);
  });

  stampPages();

  const dateTag = invoiceDate.toLocaleDateString('en-GB').replace(/\//g, '-');
  const fileStem = sections.length === 1
    ? `invoice_${safeFilePart(sections[0].recipientName)}_${dateTag}`
    : `invoices_${safeFilePart(eventName)}_${dateTag}`;
  doc.save(`${fileStem}.pdf`);
  return { filename: `${fileStem}.pdf`, invoiceCount: sections.length };
}
