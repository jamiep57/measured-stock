/**
 * Supplier-facing purchase order PDF. Shows what we are buying and the
 * agreed case prices — never selling prices or GP.
 */

import { createBrandDoc, expandLines, formatDocDate, formatMoney, safeFilePart } from './brand-pdf.js';
import { deliveryTimeLabel, factSheetKind, formatWhat3Words } from './delivery-details.js';
import { orderLinesTotal } from './order-compare.js';

const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
let pdfLibPromise;

const STATUS_LABEL = {
  draft: 'Draft',
  sent: 'Sent',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

function addressLines(value) {
  return expandLines([value]).map((line) => line.replace(/,\s*$/, ''));
}

function eventWhen(event) {
  if (!event?.start_date) return null;
  const start = formatDocDate(event.start_date);
  if (!event.end_date || event.end_date === event.start_date) return `Event ${start}`;
  return `Event ${start} – ${formatDocDate(event.end_date)}`;
}

function deliverToLines(event) {
  const words = formatWhat3Words(event?.what3words);
  const contact = [event?.delivery_contact_name, event?.delivery_contact_phone].filter(Boolean);
  return [
    ...addressLines(event?.venue),
    event?.venue_postcode,
    words || null,
    contact.length ? `On site  ${contact.join(' · ')}` : null,
    eventWhen(event),
  ];
}

function loadPdfLib() {
  if (typeof window !== 'undefined' && window.PDFLib?.PDFDocument) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_LIB_URL;
      script.async = true;
      script.onload = () => {
        if (window.PDFLib?.PDFDocument) resolve(window.PDFLib);
        else reject(new Error('Could not attach the delivery fact sheet'));
      };
      script.onerror = () => reject(new Error('Could not attach the delivery fact sheet'));
      document.head.appendChild(script);
    });
  }
  return pdfLibPromise;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the delivery fact sheet'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the delivery fact sheet'));
    img.src = src;
  });
}

async function fetchFactSheet(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load the delivery fact sheet');
  const blob = await res.blob();
  return {
    kind: factSheetKind(name || url, blob.type || ''),
    blob,
    bytes: await blob.arrayBuffer(),
  };
}

async function embedFactSheetImage(ctx, blob) {
  const dataUrl = await blobToDataUrl(blob);
  const img = await loadImage(dataUrl);
  const maxPx = 1800;
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Could not attach the delivery fact sheet');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.drawImage(img, 0, 0, width, height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.85);

  ctx.doc.addPage();
  ctx.continuationHeader();
  ctx.sectionTitle('Delivery fact sheet');
  ctx.paragraph('For the driver — how to find the address.', { size: 8.5 });
  const maxW = ctx.contentW;
  const maxH = ctx.pageH - ctx.y - 24;
  const aspect = width / height;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  ctx.doc.addImage(jpeg, 'JPEG', ctx.ml, ctx.y, w, h);
}

async function appendFactSheetPdf(poBytes, factBytes) {
  const { PDFDocument } = await loadPdfLib();
  const merged = await PDFDocument.create();
  const po = await PDFDocument.load(poBytes);
  const fact = await PDFDocument.load(factBytes);
  (await merged.copyPages(po, po.getPageIndices())).forEach((page) => merged.addPage(page));
  (await merged.copyPages(fact, fact.getPageIndices())).forEach((page) => merged.addPage(page));
  return merged.save();
}

function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * @param {{
 *   po: { reference: string, status: string, order_date?: string, delivery_date?: string, delivery_time?: string, supplier_ref?: string, notes?: string },
 *   supplier: { name: string, contact_name?: string, email?: string, phone?: string, address?: string }|null,
 *   event: { name: string, venue?: string, venue_postcode?: string, start_date?: string, end_date?: string, what3words?: string, delivery_contact_name?: string, delivery_contact_phone?: string, delivery_fact_sheet_url?: string, delivery_fact_sheet_name?: string }|null,
 *   lines: Array<{ name: string, pack?: string, qty_cases: number, case_price: number|null }>,
 *   contact?: { name?: string, email?: string, phone?: string }|null,
 * }} input
 */
export async function generatePurchaseOrderPDF({ po, supplier, event, lines = [], contact = null }) {
  if (!lines.length) throw new Error('This order has no lines to print.');

  let fact = null;
  let factMissing = false;
  if (event?.delivery_fact_sheet_url) {
    try {
      fact = await fetchFactSheet(event.delivery_fact_sheet_url, event.delivery_fact_sheet_name);
    } catch {
      factMissing = true;
    }
  }

  const ctx = await createBrandDoc({ title: 'Purchase order' });
  ctx.continuationNote = po.reference;

  const status = STATUS_LABEL[po.status] || po.status;
  const time = deliveryTimeLabel(po.delivery_time);
  ctx.header({
    meta: [
      { value: po.reference, size: 12 },
      { label: 'Order date', value: po.order_date ? formatDocDate(po.order_date) : '—' },
      po.delivery_date ? { label: 'Deliver by', value: formatDocDate(po.delivery_date), strong: true } : null,
      time ? { label: 'Delivery time', value: time, strong: true } : null,
      po.supplier_ref ? { label: 'Your ref', value: po.supplier_ref } : null,
      status !== 'Confirmed' && status !== 'Sent' ? { label: 'Status', value: status } : null,
    ],
    parties: [
      {
        label: 'Supplier',
        width: 1.15,
        lines: [
          supplier?.name || '—',
          ...addressLines(supplier?.address),
          supplier?.contact_name,
          supplier?.email,
          supplier?.phone,
        ],
      },
      {
        label: 'Deliver to',
        width: 1.35,
        lines: [event?.name || '—', ...deliverToLines(event)],
      },
      {
        label: 'Order contact',
        width: 1,
        lines: contact ? [contact.name, contact.email, contact.phone] : ['Measured', 'live@measured.events'],
      },
    ],
  });

  const anyPrice = lines.some((l) => l.case_price != null);
  const columns = [
    { label: 'Product', width: 46 },
    { label: 'Pack', width: 22, muted: true },
    { label: 'Cases', width: 12, align: 'right' },
  ];
  if (anyPrice) {
    columns.push({ label: 'Case price', width: 16, align: 'right' });
    columns.push({ label: 'Amount', width: 18, align: 'right', strong: true });
  }
  const rows = lines.map((l, i) => {
    const cells = [l.name, l.pack || '', String(l.qty_cases)];
    if (anyPrice) {
      cells.push(l.case_price == null ? '—' : formatMoney(Number(l.case_price)));
      cells.push(l.case_price == null ? '—' : formatMoney(Number(l.case_price) * Number(l.qty_cases)));
    }
    return { cells, band: i % 2 === 1 };
  });
  ctx.table(columns, rows, { rowH: 8, size: 9.5 });

  const totalCases = lines.reduce((s, l) => s + (Number(l.qty_cases) || 0), 0);
  const pairs = [['Total cases', String(totalCases)]];
  if (anyPrice) {
    const { total, priced, lines: count } = orderLinesTotal(lines);
    if (priced < count) pairs.push(['Unpriced lines', String(count - priced)]);
    pairs.push(['Order value (ex VAT)', formatMoney(total), true]);
  }
  ctx.totals(pairs);

  if (po.notes) {
    ctx.y += 6;
    ctx.sectionTitle('Notes');
    ctx.paragraph(po.notes);
  }
  ctx.y += 8;
  ctx.ensureSpace(14);
  ctx.hairline(ctx.y, 0.25);
  ctx.y += 6;
  const confirmWhen = time ? `the ${time} delivery` : 'the delivery date';
  ctx.paragraph(
    `Please confirm the quantities, prices and ${confirmWhen} by reply, quoting ${po.reference}.`,
    { size: 8.5 },
  );

  if (fact?.kind === 'pdf' || fact?.kind === 'image') {
    ctx.paragraph('A delivery fact sheet for the driver follows this order.', { size: 8.5 });
  } else if (factMissing && event?.delivery_fact_sheet_url) {
    ctx.paragraph(`Delivery fact sheet: ${event.delivery_fact_sheet_url}`, { size: 8.5 });
  }
  if (fact?.kind === 'image') await embedFactSheetImage(ctx, fact.blob);

  const filename = `${safeFilePart(po.reference)}_${safeFilePart(supplier?.name)}.pdf`;
  if (fact?.kind === 'pdf') {
    const { doc } = ctx.finish(filename, { download: false });
    try {
      downloadPdf(await appendFactSheetPdf(doc.output('arraybuffer'), fact.bytes), filename);
    } catch {
      doc.save(filename);
    }
    return { filename, doc };
  }
  return ctx.finish(filename);
}
