/**
 * Menu export PDFs. Designer, client pack and schedule of rates are set
 * in Outfit as an editorial list: the event is the title, each drink is a
 * name with its serve, ABV and price — not a spreadsheet.
 */

import { BRAND, createBrandDoc, fitText, formatDocDate } from './brand-pdf.js';
import { EXPORT_TYPES, cellValue, exportFileStem, formatCell } from './menu-exports.js';

const INK = BRAND.ink;
const MUTED = [113, 113, 122];
const RULE = BRAND.rule;
const GOLD = BRAND.gold;

const NAME_BASE = 4.4;
const META_STEP = 3.6;
const ITEM_PAD = 2.6;
const CAT_H = 10.2;
const GUTTER = 18;

function sentenceDate(value) {
  const raw = formatDocDate(value);
  if (!raw) return '';
  return raw.replace(/\b([A-Z]{3})\b/g, (m) => m[0] + m.slice(1).toLowerCase());
}

function eventDates(event) {
  if (!event?.start_date) return null;
  const a = sentenceDate(event.start_date);
  const b = event.end_date && event.end_date !== event.start_date ? sentenceDate(event.end_date) : null;
  return b ? `${a} - ${b}` : a;
}

function joinBits(bits) {
  return bits.filter(Boolean).join('   ·   ');
}

/**
 * One menu line as a name, a price, and the quiet lines under it.
 * @param {'designer'|'client'|'sor'} type
 */
export function composeMenuEntry(type, row, columns = []) {
  const priceKey = type === 'sor' ? 'rate' : 'price';
  const priceCol = columns.find((c) => c.key === priceKey) || { money: true };
  const price = formatCell(row[priceKey], priceCol);
  const serve = String(row.serve || '').trim();
  const lines = [];

  if (type === 'designer') {
    const product = String(row.productName || '').trim();
    lines.push(joinBits([
      product && product !== row.menuName ? product : '',
      serve,
      row.abv && row.abv !== '—' ? `${row.abv} ABV` : '',
    ]));
    return { name: row.menuName || '', price, unit: '', lines: lines.filter(Boolean) };
  }

  if (type === 'sor') {
    return { name: row.menuName || '', price, unit: serve, lines: [] };
  }

  const mixCol = columns.find((c) => c.key === 'mixPct');
  lines.push(joinBits([
    serve,
    row.mixPct != null && mixCol ? `Mix ${formatCell(row.mixPct, mixCol)}` : '',
  ]));
  const scenarios = columns.filter((c) => c.key.startsWith('scenario:'));
  if (scenarios.length) {
    lines.push(scenarios.map((c) => `${c.label}  ${formatCell(cellValue(row, c), c)}`).join('      '));
  }
  const costCol = columns.find((c) => c.key === 'costPerServe');
  const gpCol = columns.find((c) => c.key === 'gpPct');
  lines.push(joinBits([
    row.costPerServe != null && costCol ? `Cost ${formatCell(row.costPerServe, costCol)}` : '',
    row.gpPct != null && gpCol ? `GP ${formatCell(row.gpPct, gpCol)}` : '',
  ]));
  return { name: row.menuName || '', price, unit: '', lines: lines.filter(Boolean) };
}

function tracked(doc, text, x, y, tracking) {
  const chars = [...String(text)];
  if (!chars.length) return;
  const widths = chars.map((c) => doc.getTextWidth(c));
  let cx = x;
  chars.forEach((c, i) => {
    doc.text(c, cx, y);
    cx += widths[i] + (i < chars.length - 1 ? tracking : 0);
  });
}

function logoBox(logo) {
  if (!logo) return null;
  const maxW = 34;
  const maxH = 9;
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
 * @param {{ download?: boolean }} [input]
 */
export async function generateMenuExportPDF({
  type, model, event, client, vatRate, rateNote = '', preparedBy = null, download = true,
}) {
  if (!model.count) throw new Error('Nothing to export — no priced items on the event menu.');
  const spec = EXPORT_TYPES[type];
  const orientation = type === 'designer' || model.columns.length > 5 ? 'landscape' : 'portrait';
  const ctx = await createBrandDoc({ title: spec.title, orientation, typeface: 'outfit' });
  const { doc } = ctx;
  const vatPct = Math.round((Number(vatRate) || 0) * 1000) / 10;
  const hero = event?.name || spec.title;
  const kicker = String(spec.title || '').toUpperCase();
  const twoCol = type === 'designer' && model.count > 6;
  const measure = twoCol ? (ctx.contentW - GUTTER) / 2 : ctx.contentW;
  const colCount = twoCol ? 2 : 1;
  const bottom = ctx.pageH - 14;

  const meta = [
    client?.name && type !== 'sor' ? `For ${client.name}` : '',
    event?.venue || '',
    eventDates(event) || '',
    type === 'sor' ? '' : `Prices include VAT at ${vatPct}%`,
  ].filter(Boolean);
  if (type !== 'designer') {
    const who = preparedBy?.name ? `Prepared by ${preparedBy.name}` : 'Prepared by Measured';
    meta.push(who);
  }

  let columnTop = 58;
  let col = 0;
  let y = columnTop;
  let activeCategory = null;

  function colX() {
    return ctx.ml + col * (measure + GUTTER);
  }

  function drawMasthead(continued) {
    const mark = logoBox(ctx.logo);
    if (mark) {
      doc.addImage(ctx.logo.dataUrl, ctx.logo.format || 'JPEG', ctx.pageW - ctx.mr - mark.w, 12, mark.w, mark.h, 'brand-logo');
    }
    ctx.setFont('bold', 8, MUTED);
    tracked(doc, kicker, ctx.ml, 17, 0.45);
    const issued = formatDocDate(new Date());
    ctx.setFont('normal', 8, MUTED);
    const dateX = mark ? ctx.pageW - ctx.mr - mark.w - 6 : ctx.pageW - ctx.mr;
    doc.text(issued, dateX, 17, { align: 'right' });

    if (continued) {
      ctx.setFont('bold', 14, INK);
      doc.text(fitText(doc, hero, ctx.contentW - (mark ? mark.w + 8 : 0)), ctx.ml, 26);
      doc.setFillColor(...GOLD);
      doc.rect(ctx.ml, 29.2, 12, 0.7, 'F');
      columnTop = 38;
      y = columnTop;
      col = 0;
      return;
    }

    ctx.setFont('bold', 26, INK);
    let titleSize = 26;
    if (doc.getTextWidth(hero) > ctx.contentW) titleSize = 20;
    ctx.setFont('bold', titleSize, INK);
    const titleLines = doc.splitTextToSize(hero, ctx.contentW);
    let ty = 34;
    titleLines.slice(0, 2).forEach((line) => {
      doc.text(line, ctx.ml, ty);
      ty += titleSize * 0.42;
    });
    doc.setFillColor(...GOLD);
    doc.rect(ctx.ml, ty - 1, 14, 0.75, 'F');
    ty += 6;
    if (meta.length) {
      ctx.setFont('normal', 9, MUTED);
      const metaLines = doc.splitTextToSize(meta.join('    ·    '), ctx.contentW);
      metaLines.slice(0, 2).forEach((line) => {
        doc.text(line, ctx.ml, ty);
        ty += 4.4;
      });
    }
    if (type === 'sor') {
      ty += 1.5;
      const intro = `Agreed products, units and rates${client?.name ? ` for ${client.name}` : ''}. `
        + `Rates are in pounds sterling and include VAT at ${vatPct}%`
        + `${rateNote ? `. ${rateNote}` : ''}.`;
      ctx.setFont('normal', 9.5, MUTED);
      const introLines = doc.splitTextToSize(intro, Math.min(ctx.contentW, 168));
      introLines.forEach((line) => {
        doc.text(line, ctx.ml, ty);
        ty += 4.4;
      });
    }
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(ctx.ml, ty + 1, ctx.pageW - ctx.mr, ty + 1);
    columnTop = ty + 9;
    y = columnTop;
    col = 0;
  }

  function nextPage() {
    doc.addPage();
    drawMasthead(true);
  }

  function move() {
    if (col + 1 < colCount) {
      col += 1;
      y = columnTop;
      return;
    }
    nextPage();
  }

  function room(need) {
    if (y + need <= bottom) return;
    move();
  }

  function wrapMeta(entry) {
    ctx.setFont('normal', 8, MUTED);
    const width = measure - 1;
    return entry.lines.flatMap((line) => doc.splitTextToSize(line, width));
  }

  function itemHeight(wrapped) {
    if (!wrapped.length) return 9.2;
    return NAME_BASE + wrapped.length * META_STEP + ITEM_PAD;
  }

  function drawCategory(block, continued) {
    const x = colX();
    doc.setFillColor(...GOLD);
    doc.rect(x, y + 1.5, 1.2, 3.6, 'F');
    ctx.setFont('bold', 12, INK);
    doc.text(block.label, x + 4.2, y + 4.8);
    if (continued) {
      const w = doc.getTextWidth(block.label);
      ctx.setFont('normal', 8, MUTED);
      doc.text('continued', x + 4.2 + w + 2.4, y + 4.6);
    } else {
      ctx.setFont('normal', 8, MUTED);
      doc.text(String(block.count), x + measure, y + 4.6, { align: 'right' });
    }
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.15);
    doc.line(x + 4.2, y + 7.4, x + measure, y + 7.4);
    y += CAT_H;
  }

  function drawItem(entry, wrapped) {
    const x = colX();
    const rate = type === 'sor';
    const priceSize = rate ? 11 : 11.5;
    const nameSize = rate ? 11.5 : 12.5;
    ctx.setFont('bold', nameSize, INK);
    const priceW = 24;
    const unitW = rate && entry.unit ? 26 : 0;
    doc.text(fitText(doc, entry.name, measure - priceW - unitW - 3), x, y + NAME_BASE);
    if (unitW) {
      ctx.setFont('normal', 9, MUTED);
      doc.text(fitText(doc, entry.unit, unitW - 2), x + measure - priceW - 2, y + NAME_BASE, { align: 'right' });
    }
    ctx.setFont('normal', priceSize, entry.price === '—' ? MUTED : INK);
    doc.text(entry.price, x + measure, y + NAME_BASE, { align: 'right' });
    ctx.setFont('normal', 8, MUTED);
    wrapped.forEach((line, i) => {
      doc.text(line, x, y + NAME_BASE + META_STEP * (i + 1));
    });
    y += itemHeight(wrapped);
  }

  drawMasthead(false);

  model.groups.forEach((group) => {
    const items = group.rows.map((row) => {
      const entry = composeMenuEntry(type, row, model.columns);
      const wrapped = wrapMeta(entry);
      return { entry, wrapped, h: itemHeight(wrapped) };
    });
    const itemsH = items.reduce((sum, item) => sum + item.h, 0);
    let lead = y > columnTop + 0.5 ? 3.5 : 0;
    // Keep a short category together. A heading with one item stranded
    // at the foot of a column reads as a mistake.
    if (y + lead + CAT_H + itemsH > bottom && columnTop + CAT_H + itemsH <= bottom) {
      move();
      lead = 0;
    }
    const firstH = items[0]?.h || 0;
    room(lead + CAT_H + firstH);
    y += y > columnTop + 0.5 ? lead : 0;
    const block = { label: group.category, count: group.rows.length };
    drawCategory(block, false);
    activeCategory = block;
    items.forEach((item) => {
      if (y + item.h > bottom) {
        move();
        if (activeCategory) drawCategory(activeCategory, true);
      }
      drawItem(item.entry, item.wrapped);
    });
  });

  const footer = model.includeInternal
    ? 'Internal. Contains costs and GP. Not for distribution.'
    : type === 'designer'
      ? `Prices include VAT at ${vatPct}%. Set menu names exactly as shown.`
      : type === 'sor'
        ? `Rates apply to this event. Each rate includes VAT at ${vatPct}%.`
        : model.missingRates
          ? `${model.missingRates} item${model.missingRates === 1 ? ' has' : 's have'} no menu price yet.`
          : `Prices include VAT at ${vatPct}%.`;
  ctx.footerLeft = footer;
  ctx.pageLabel = (p, n) => (n > 1
    ? `${String(p).padStart(2, '0')}  /  ${String(n).padStart(2, '0')}`
    : String(p).padStart(2, '0'));

  return ctx.finish(`${exportFileStem(type, event?.name)}.pdf`, { download });
}
