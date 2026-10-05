/**
 * Shared Measured document layout for jsPDF exports (orders, SOR, client
 * and designer packs). Same hairline commercial style as the client
 * invoice: big title + meta left, logo + from-address right, small-caps
 * section labels, ruled tables with repeating headers and page numbers.
 */

import { loadJsPdf, loadLogoForPdf } from './delivery-note-pdf.js';
import { INVOICE_FROM, formatInvoiceDate, formatInvoiceMoney } from './recipient-invoice-pdf.js';

export const BRAND = {
  ink: [24, 24, 27],
  grey: [82, 82, 91],
  muted: [130, 130, 138],
  rule: [212, 212, 216],
  band: [244, 244, 245],
  accent: [180, 83, 9],
  gold: [232, 196, 124],
};

export { formatInvoiceMoney as formatMoney, formatInvoiceDate as formatDocDate };

export function safeFilePart(s) {
  return String(s || 'export').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'export';
}

function logoSize(logo, maxW, maxH) {
  const aspect = logo.width / logo.height;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w, h };
}

/**
 * Truncate text so it fits a column width at the current font.
 * @param {object} doc jsPDF
 */
export function fitText(doc, text, maxW) {
  const s = String(text ?? '');
  if (!s || doc.getTextWidth(s) <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(`${s.slice(0, mid)}…`) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/**
 * @param {{ orientation?: 'portrait'|'landscape', title: string, typeface?: 'helvetica'|'outfit' }} opts
 */
export async function createBrandDoc({ orientation = 'portrait', title = '', typeface = 'helvetica' } = {}) {
  const [jspdf, logo] = await Promise.all([loadJsPdf(), loadLogoForPdf()]);
  const doc = new jspdf.jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
  let family = 'helvetica';
  if (typeface === 'outfit') {
    try {
      const { registerOutfit } = await import('./pdf-fonts.js');
      family = await registerOutfit(doc);
    } catch {
      family = 'helvetica';
    }
  }
  const pageW = orientation === 'landscape' ? 297 : 210;
  const pageH = orientation === 'landscape' ? 210 : 297;
  const ml = 18;
  const mr = 18;
  const bottom = 20;
  const contentW = pageW - ml - mr;
  const ctx = {
    doc, pageW, pageH, ml, mr, contentW, y: 18, title, logo, family,
    footerNote: '', footerLeft: '', continuationNote: '', pageLabel: null,
  };

  ctx.setFont = (style, size, color = BRAND.ink) => {
    const weight = style === 'bold' ? 'bold' : (family === 'helvetica' ? style : 'normal');
    doc.setFont(family, weight || 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };

  ctx.hairline = (y, weight = 0.3, color = BRAND.rule) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(weight);
    doc.line(ml, y, pageW - mr, y);
  };

  /**
   * Title block. `meta` lines sit under the title (date, reference…);
   * `parties` is a row of labelled blocks beneath the first rule.
   */
  ctx.header = ({ meta = [], parties = [] } = {}) => {
    ctx.setFont('bold', 28, BRAND.ink);
    doc.text(String(title).toUpperCase(), ml, 24);
    doc.setFillColor(...BRAND.gold);
    doc.rect(ml, 27.5, 14, 0.9, 'F');

    let my = 35;
    meta.filter(Boolean).forEach((line, i) => {
      ctx.setFont(i === 0 ? 'bold' : 'normal', 9.5, i === 0 ? BRAND.ink : BRAND.grey);
      doc.text(String(line), ml, my);
      my += 5;
    });

    let ry = 14;
    if (logo) {
      const { w, h } = logoSize(logo, 34, 11);
      doc.addImage(logo.dataUrl, logo.format || 'JPEG', pageW - mr - w, ry, w, h, 'brand-logo');
      ry += h + 5;
    }
    ctx.setFont('normal', 8.5, BRAND.grey);
    [...INVOICE_FROM.addressLines, INVOICE_FROM.email, INVOICE_FROM.website].forEach((line) => {
      doc.text(line, pageW - mr, ry, { align: 'right' });
      ry += 4;
    });

    let y = Math.max(my, ry) + 3;
    ctx.hairline(y);
    if (parties.length) {
      y += 7;
      const colW = contentW / parties.length;
      let maxLines = 0;
      parties.forEach((p, i) => {
        const x = ml + colW * i;
        ctx.setFont('bold', 7, BRAND.muted);
        doc.text(String(p.label || '').toUpperCase(), x, y);
        const lines = (p.lines || []).filter(Boolean);
        lines.forEach((line, li) => {
          ctx.setFont(li === 0 ? 'bold' : 'normal', li === 0 ? 10.5 : 9, li === 0 ? BRAND.ink : BRAND.grey);
          doc.text(fitText(doc, line, colW - 4), x, y + 5.5 + li * 4.6);
        });
        maxLines = Math.max(maxLines, lines.length);
      });
      y += 5.5 + Math.max(1, maxLines) * 4.6;
      ctx.hairline(y);
    }
    ctx.y = y + 9;
    return ctx.y;
  };

  ctx.continuationHeader = () => {
    ctx.setFont('bold', 14, BRAND.ink);
    doc.text(String(title).toUpperCase(), ml, 18);
    ctx.setFont('normal', 8.5, BRAND.muted);
    doc.text(ctx.continuationNote || 'continued', ml, 23);
    ctx.hairline(27);
    ctx.y = 35;
  };

  ctx.ensureSpace = (needed, onBreak) => {
    if (ctx.y + needed <= pageH - bottom) return false;
    doc.addPage();
    ctx.continuationHeader();
    if (onBreak) onBreak();
    return true;
  };

  ctx.sectionTitle = (label, note = '') => {
    ctx.ensureSpace(16);
    ctx.setFont('bold', 11, BRAND.ink);
    doc.text(label, ml, ctx.y);
    if (note) {
      ctx.setFont('normal', 8.5, BRAND.muted);
      doc.text(note, pageW - mr, ctx.y, { align: 'right' });
    }
    ctx.y += 6;
  };

  ctx.paragraph = (text, { size = 9, color = BRAND.grey } = {}) => {
    if (!text) return;
    ctx.setFont('normal', size, color);
    const lines = doc.splitTextToSize(String(text), contentW);
    lines.forEach((line) => {
      ctx.ensureSpace(5);
      doc.text(line, ml, ctx.y);
      ctx.y += size * 0.5;
    });
    ctx.y += 2;
  };

  /**
   * Ruled table. columns: [{ label, width (fraction of content), align }].
   * rows: arrays of cell strings, or { cells, bold, band, group } objects.
   */
  ctx.table = (columns, rows, { rowH = 7, size = 9 } = {}) => {
    const total = columns.reduce((s, c) => s + (c.width || 1), 0);
    const widths = columns.map((c) => ((c.width || 1) / total) * contentW);
    const xs = [];
    let x = ml;
    widths.forEach((w) => { xs.push(x); x += w; });

    const drawHead = () => {
      ctx.setFont('bold', 7, BRAND.muted);
      columns.forEach((c, i) => {
        const right = c.align === 'right';
        doc.text(String(c.label || '').toUpperCase(), right ? xs[i] + widths[i] - 1 : xs[i], ctx.y, right ? { align: 'right' } : undefined);
      });
      ctx.y += 2.5;
      ctx.hairline(ctx.y, 0.4, BRAND.ink);
      ctx.y += 1;
    };

    ctx.ensureSpace(rowH * 3);
    drawHead();
    rows.forEach((raw) => {
      const row = Array.isArray(raw) ? { cells: raw } : raw;
      if (row.group) {
        ctx.ensureSpace(rowH * 2.2, drawHead);
        ctx.y += 2;
        ctx.setFont('bold', 8, BRAND.accent);
        doc.text(String(row.group).toUpperCase(), ml, ctx.y + 4.2);
        ctx.y += rowH - 1;
        return;
      }
      ctx.ensureSpace(rowH, drawHead);
      if (row.band) {
        doc.setFillColor(...BRAND.band);
        doc.rect(ml, ctx.y, contentW, rowH, 'F');
      }
      columns.forEach((c, i) => {
        ctx.setFont(row.bold ? 'bold' : 'normal', size, c.muted ? BRAND.grey : BRAND.ink);
        const text = fitText(doc, row.cells[i] ?? '', widths[i] - 2);
        const right = c.align === 'right';
        doc.text(text, right ? xs[i] + widths[i] - 1 : xs[i], ctx.y + rowH * 0.64, right ? { align: 'right' } : undefined);
      });
      ctx.y += rowH;
      doc.setDrawColor(...BRAND.rule);
      doc.setLineWidth(0.15);
      doc.line(ml, ctx.y, pageW - mr, ctx.y);
    });
    ctx.y += 4;
  };

  /** Right-aligned label/value pairs (totals). */
  ctx.totals = (pairs) => {
    ctx.ensureSpace(pairs.length * 6 + 8);
    ctx.y += 2;
    const labelX = pageW - mr - 42;
    pairs.forEach(([label, value, strong], i) => {
      const isLast = i === pairs.length - 1;
      ctx.setFont(strong || isLast ? 'bold' : 'normal', strong || isLast ? 10.5 : 9, strong || isLast ? BRAND.ink : BRAND.grey);
      doc.text(String(label).toUpperCase(), labelX, ctx.y, { align: 'right' });
      doc.text(String(value), pageW - mr, ctx.y, { align: 'right' });
      ctx.y += 6;
    });
  };

  /** Big-number KPI tiles across the page. */
  ctx.kpis = (items) => {
    if (!items.length) return;
    ctx.ensureSpace(22);
    const gap = 4;
    const w = (contentW - gap * (items.length - 1)) / items.length;
    items.forEach((k, i) => {
      const x = ml + i * (w + gap);
      doc.setFillColor(...BRAND.band);
      doc.roundedRect(x, ctx.y, w, 17, 1.5, 1.5, 'F');
      ctx.setFont('bold', 6.8, BRAND.muted);
      doc.text(String(k.label).toUpperCase(), x + 4, ctx.y + 5.5);
      ctx.setFont('bold', 13, BRAND.ink);
      doc.text(fitText(doc, k.value, w - 8), x + 4, ctx.y + 13);
    });
    ctx.y += 24;
  };

  ctx.finish = (filename, { download = true } = {}) => {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      ctx.setFont('normal', 7, BRAND.muted);
      const left = ctx.footerLeft || `${INVOICE_FROM.name} · ${INVOICE_FROM.website}`;
      doc.text(fitText(doc, left, contentW - 28), ml, pageH - 9);
      if (ctx.footerNote) doc.text(ctx.footerNote, pageW / 2, pageH - 9, { align: 'center' });
      const pageText = ctx.pageLabel ? ctx.pageLabel(p, pages) : `${p} / ${pages}`;
      doc.text(pageText, pageW - mr, pageH - 9, { align: 'right' });
    }
    if (download) doc.save(filename);
    return { filename, pages, doc };
  };

  return ctx;
}
