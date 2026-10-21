/**
 * Shared Measured document layout for jsPDF exports (orders, SOR, client
 * and designer packs). Same hairline commercial style as the client
 * invoice: big title + meta left, logo + from-address right, small-caps
 * section labels, ruled tables with repeating headers and page numbers.
 */

import { loadJsPdf, loadLogoForPdf } from './delivery-note-pdf.js';
import { formatInvoiceDate, formatInvoiceMoney } from './recipient-invoice-pdf.js';
import { letterheadLines, loadLetterhead } from './document-from.js';

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

/** Split address and party fields on newlines and drop blank lines. */
export function expandLines(lines) {
  return (lines || []).flatMap((line) => (
    String(line ?? '')
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean)
  ));
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
  const [jspdf, logo, from] = await Promise.all([loadJsPdf(), loadLogoForPdf(), loadLetterhead()]);
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
    doc, pageW, pageH, ml, mr, contentW, y: 18, title, logo, family, from,
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
    doc.setCharSpace(0.4);
    ctx.setFont('bold', 26, BRAND.ink);
    doc.text(String(title).toUpperCase(), ml, 22);
    doc.setCharSpace(0);
    doc.setFillColor(...BRAND.gold);
    doc.rect(ml, 26, 16, 1.1, 'F');

    ctx.setFont('bold', 7.2, BRAND.muted);
    let labelCol = 28;
    meta.filter((line) => line && typeof line === 'object' && line.label).forEach((line) => {
      labelCol = Math.max(labelCol, doc.getTextWidth(String(line.label).toUpperCase()) + 4);
    });

    let my = 35;
    meta.filter(Boolean).forEach((line, i) => {
      if (line && typeof line === 'object') {
        const size = line.size || (line.label ? 9.5 : 11);
        if (line.label) {
          ctx.setFont('bold', 7.2, BRAND.muted);
          doc.text(String(line.label).toUpperCase(), ml, my);
          ctx.setFont(line.strong ? 'bold' : 'normal', size, BRAND.ink);
          doc.text(fitText(doc, line.value ?? '—', 78), ml + labelCol, my);
          my += 5.6;
        } else {
          ctx.setFont('bold', size, BRAND.ink);
          doc.text(fitText(doc, line.value ?? '', 90), ml, my);
          my += 7;
        }
        return;
      }
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
    letterheadLines(from).forEach((line) => {
      doc.text(line, pageW - mr, ry, { align: 'right' });
      ry += 4;
    });

    let y = Math.max(my, ry) + 4;
    ctx.hairline(y, 0.35, BRAND.rule);
    if (parties.length) {
      y += 6.5;
      const weights = parties.map((p) => (Number(p.width) > 0 ? Number(p.width) : 1));
      const weightSum = weights.reduce((sum, w) => sum + w, 0);
      const labelY = y;
      let bottom = y + 5;
      let x = ml;
      parties.forEach((p, i) => {
        const colW = (weights[i] / weightSum) * contentW;
        const maxW = Math.max(12, colW - 6);
        ctx.setFont('bold', 7, BRAND.muted);
        doc.text(String(p.label || '').toUpperCase(), x, labelY);
        let ly = labelY + 5.8;
        expandLines(p.lines).forEach((line, li) => {
          const isName = li === 0;
          ctx.setFont(isName ? 'bold' : 'normal', isName ? 11 : 9, isName ? BRAND.ink : BRAND.grey);
          const wrapped = doc.splitTextToSize(String(line), maxW);
          wrapped.forEach((part) => {
            doc.text(part, x, ly);
            ly += isName ? 4.8 : 4.15;
          });
          if (isName) ly += 0.6;
        });
        bottom = Math.max(bottom, ly);
        x += colW;
      });
      y = bottom + 1.5;
      ctx.hairline(y, 0.35, BRAND.rule);
    }
    ctx.y = y + 8;
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

    const cellX = (i, right) => {
      const pad = right ? (i === columns.length - 1 ? 0 : 1.4) : 0.4;
      return right ? xs[i] + widths[i] - pad : xs[i] + pad;
    };

    const drawHead = () => {
      ctx.setFont('bold', 7, BRAND.muted);
      columns.forEach((c, i) => {
        const right = c.align === 'right';
        doc.text(String(c.label || '').toUpperCase(), cellX(i, right), ctx.y, right ? { align: 'right' } : undefined);
      });
      ctx.y += 2.8;
      ctx.hairline(ctx.y, 0.45, BRAND.ink);
      ctx.y += 0.4;
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
        const right = c.align === 'right';
        const raw = row.cells[i];
        const value = raw && typeof raw === 'object' ? (raw.text ?? '') : (raw ?? '');
        const note = raw && typeof raw === 'object' ? String(raw.note || '') : '';
        const maxW = widths[i] - (right ? 2 : 2.4);
        const y = ctx.y + rowH * 0.66;
        if (note && !right) {
          ctx.setFont('normal', Math.max(size - 1, 7), BRAND.grey);
          const noteW = doc.getTextWidth(note);
          const gap = 2.2;
          ctx.setFont(row.bold || c.strong ? 'bold' : 'normal', size, BRAND.ink);
          const text = fitText(doc, value, Math.max(16, maxW - noteW - gap));
          const x = cellX(i, false);
          const nameW = doc.getTextWidth(text);
          doc.text(text, x, y);
          ctx.setFont('normal', Math.max(size - 1, 7), BRAND.grey);
          doc.text(note, x + nameW + gap, y);
          return;
        }
        ctx.setFont(row.bold || c.strong ? 'bold' : 'normal', size, c.muted ? BRAND.grey : BRAND.ink);
        const text = fitText(doc, value, maxW);
        doc.text(text, cellX(i, right), y, right ? { align: 'right' } : undefined);
      });
      ctx.y += rowH;
      doc.setDrawColor(...BRAND.rule);
      doc.setLineWidth(0.15);
      doc.line(ml, ctx.y, pageW - mr, ctx.y);
    });
    ctx.y += 4;
  };

  /**
   * Drop the cursor so the next `needed` millimetres finish on the
   * bottom margin. A short page keeps its closing block low; a full
   * page carries that block onto a new page, still on the bottom.
   */
  ctx.anchorBottom = (needed) => {
    const limit = pageH - bottom;
    if (ctx.y + needed <= limit) {
      ctx.y = limit - needed;
      return;
    }
    doc.addPage();
    ctx.continuationHeader();
    if (ctx.y + needed <= limit) ctx.y = limit - needed;
  };

  /** Height `ctx.totals` will consume, matching its row spacing. */
  ctx.measureTotals = (pairs) => {
    if (!pairs?.length) return 0;
    const ruleAt = pairs.findLastIndex((pair) => pair[2]) >= 0
      ? pairs.findLastIndex((pair) => pair[2])
      : pairs.length - 1;
    let h = 2;
    pairs.forEach((_, i) => {
      if (i === ruleAt) h += 3.2;
      h += i === ruleAt ? 7.5 : 5.8;
    });
    return h;
  };

  /**
   * Label/value pairs in a block on the right. Labels share a left edge
   * and values share the right margin, with a rule above the main total.
   * `anchored` skips the page-break check — the caller already placed y.
   */
  ctx.totals = (pairs, { anchored = false } = {}) => {
    if (!pairs.length) return;
    const gap = 8;
    const ruleAt = pairs.findLastIndex((pair) => pair[2]) >= 0
      ? pairs.findLastIndex((pair) => pair[2])
      : pairs.length - 1;
    let blockW = 72;
    pairs.forEach(([label, value, strong], i) => {
      const emphasize = i === ruleAt;
      ctx.setFont(emphasize || strong ? 'bold' : 'normal', emphasize ? 8.5 : 8, BRAND.ink);
      const labelW = doc.getTextWidth(String(label).toUpperCase());
      ctx.setFont(emphasize ? 'bold' : 'normal', emphasize ? 12 : 9.5, BRAND.ink);
      const valueW = doc.getTextWidth(String(value));
      blockW = Math.max(blockW, labelW + valueW + gap);
    });
    blockW = Math.min(blockW, contentW * 0.78);
    const x0 = pageW - mr - blockW;
    if (!anchored) ctx.ensureSpace(pairs.length * 8 + 8);
    ctx.y += 2;
    pairs.forEach(([label, value], i) => {
      const emphasize = i === ruleAt;
      if (emphasize) {
        doc.setDrawColor(...BRAND.ink);
        doc.setLineWidth(0.4);
        doc.line(x0, ctx.y - 1.6, pageW - mr, ctx.y - 1.6);
        ctx.y += 3.2;
      }
      const labelText = String(label).toUpperCase();
      ctx.setFont(emphasize ? 'bold' : 'normal', emphasize ? 8.5 : 8, emphasize ? BRAND.ink : BRAND.grey);
      const valueSize = emphasize ? 12 : 9.5;
      ctx.setFont(emphasize ? 'bold' : 'normal', valueSize, BRAND.ink);
      const valueW = doc.getTextWidth(String(value));
      ctx.setFont(emphasize ? 'bold' : 'normal', emphasize ? 8.5 : 8, emphasize ? BRAND.ink : BRAND.grey);
      doc.text(fitText(doc, labelText, Math.max(16, blockW - valueW - gap)), x0, ctx.y);
      ctx.setFont(emphasize ? 'bold' : 'normal', valueSize, BRAND.ink);
      doc.text(String(value), pageW - mr, ctx.y, { align: 'right' });
      ctx.y += emphasize ? 7.5 : 5.8;
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
      ctx.setFont('normal', 7.5, BRAND.muted);
      const left = ctx.footerLeft || [from.name, from.website].filter(Boolean).join(' · ');
      const pageText = ctx.pageLabel ? ctx.pageLabel(p, pages) : `${p} / ${pages}`;
      const pageGap = doc.getTextWidth(pageText) + 6;
      const lines = doc.splitTextToSize(String(left), Math.max(40, contentW - pageGap));
      const lineH = 3.4;
      const lastY = pageH - 9;
      const firstY = lastY - (lines.length - 1) * lineH;
      ctx.hairline(lines.length === 1 ? pageH - 15 : firstY - 4.5, 0.25, BRAND.rule);
      lines.forEach((line, i) => doc.text(line, ml, firstY + i * lineH));
      if (ctx.footerNote && lines.length === 1) doc.text(ctx.footerNote, pageW / 2, lastY, { align: 'center' });
      doc.text(pageText, pageW - mr, lastY, { align: 'right' });
    }
    if (download) doc.save(filename);
    return { filename, pages, doc };
  };

  return ctx;
}
