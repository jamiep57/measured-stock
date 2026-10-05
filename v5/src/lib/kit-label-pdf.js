/**
 * Kit item / container labels for Brother QL-800.
 *
 * Primary path: WebUSB print from Chrome/Edge → QL-800 directly (no CUPS).
 * Keep the QL-800 out of macOS Printers & Scanners so P-touch Editor can
 * still open the USB device when you need it.
 *
 * Media: 62mm continuous (DK-22205), landscape artwork (100×62mm) rotated
 * 90° so the 62mm edge hits the print head. Big name on top, QR below.
 */

import QRCode from 'qrcode';
import { escapeHtml } from './util.js';
import {
  mmToPx,
  printCanvasesToQl800,
  QL_MEDIA_62_CONTINUOUS,
} from './ql800-webusb.js';

export { resolveKitLabelPayload } from './kit-label-payload.js';

/** Reading width (along the roll after rotate). */
export const KIT_LABEL_WIDTH_MM = 100;
/** Tape width across the QL-800 print head. */
export const KIT_LABEL_HEIGHT_MM = 62;

function truncateMiddle(s, max = 42) {
  const t = String(s || '');
  if (t.length <= max) return t;
  const keep = Math.floor((max - 1) / 2);
  return `${t.slice(0, keep)}…${t.slice(-keep)}`;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${line} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Pick the largest bold font that fits the name in the text band.
 * @returns {{ size: number, lines: string[], lineHeight: number }}
 */
function fitNameLayout(ctx, text, maxWidth, maxHeight, maxLines = 3) {
  const label = String(text || '').trim() || 'Kit item';
  let lo = mmToPx(8);
  let hi = mmToPx(28);
  let best = { size: lo, lines: [label], lineHeight: lo * 1.05 };

  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2);
    const lineHeight = size * 1.05;
    ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
    const lines = wrapCanvasText(ctx, label, maxWidth).slice(0, maxLines);
    // Reject if wrapping still overflows width on any line, or height.
    const widest = Math.max(...lines.map((t) => ctx.measureText(t).width));
    const height = lines.length * lineHeight;
    const fits = widest <= maxWidth + 0.5 && height <= maxHeight + 0.5;
    if (fits) {
      best = { size, lines, lineHeight };
      lo = size + 1;
    } else {
      hi = size - 1;
    }
  }
  return best;
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load QR image'));
    img.src = dataUrl;
  });
}

/**
 * Render one landscape kit label at 300dpi (100×62mm reading orientation).
 * Massive name on top, QR underneath.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderKitLabelCanvas({ name, barcode, isContainer, qrDataUrl }) {
  const labelName = String(name || '').trim() || 'Kit item';
  const code = String(barcode || '').trim();
  if (!code) throw new Error('Barcode required to print a kit label.');

  const w = mmToPx(KIT_LABEL_WIDTH_MM);
  const h = mmToPx(KIT_LABEL_HEIGHT_MM);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const m = mmToPx(3);
  const black = '#141414';
  const grey = '#5a5a5a';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';

  const headerSize = mmToPx(3.2);
  ctx.fillStyle = grey;
  ctx.font = `bold ${headerSize}px Helvetica, Arial, sans-serif`;
  ctx.fillText('MEASURED · KIT', m, m + mmToPx(2.8));

  if (isContainer) {
    ctx.textAlign = 'right';
    ctx.fillStyle = black;
    ctx.fillText('CONTAINER', w - m, m + mmToPx(2.8));
    ctx.textAlign = 'left';
  }

  // Bottom band reserved for QR + code; rest is for the name.
  const qrSize = mmToPx(28);
  const codeSize = mmToPx(2.6);
  const bottomBand = qrSize + mmToPx(6);
  const textTop = m + mmToPx(6);
  const textBottom = h - m - bottomBand;
  const textHeight = Math.max(mmToPx(12), textBottom - textTop);

  ctx.fillStyle = black;
  const fitted = fitNameLayout(ctx, labelName, w - m * 2, textHeight, 3);
  ctx.font = `bold ${fitted.size}px Helvetica, Arial, sans-serif`;
  const blockH = fitted.lines.length * fitted.lineHeight;
  const nameY0 = textTop + (textHeight - blockH) / 2 + fitted.size * 0.85;
  fitted.lines.forEach((t, i) => {
    ctx.fillText(t, m, nameY0 + i * fitted.lineHeight);
  });

  let qrImg = null;
  if (qrDataUrl) {
    qrImg = await loadImageFromDataUrl(qrDataUrl);
  } else {
    const dataUrl = await QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      color: { dark: '#141414', light: '#ffffff' },
    });
    qrImg = await loadImageFromDataUrl(dataUrl);
  }

  const qrX = Math.round((w - qrSize) / 2);
  const qrY = Math.round(h - m - mmToPx(3.5) - qrSize);
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = grey;
  ctx.font = `${codeSize}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(truncateMiddle(code, 52), w / 2, h - m - mmToPx(0.4), w - m * 2);
  ctx.textAlign = 'left';

  return canvas;
}

function labelStyles() {
  return `
    @page {
      size: ${KIT_LABEL_WIDTH_MM}mm ${KIT_LABEL_HEIGHT_MM}mm;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #141414;
      font-family: Helvetica, Arial, sans-serif;
    }
    .label {
      width: ${KIT_LABEL_WIDTH_MM}mm;
      height: ${KIT_LABEL_HEIGHT_MM}mm;
      padding: 3mm;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .top {
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      font-weight: 700;
      color: #5a5a5a;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .name {
      flex: 1;
      display: flex;
      align-items: center;
      font-size: 36pt;
      font-weight: 900;
      line-height: 1.05;
      min-height: 0;
    }
    .qr-wrap {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1mm;
    }
    .qr-wrap img { width: 28mm; height: 28mm; }
    .code {
      text-align: center;
      font-size: 7pt;
      color: #5a5a5a;
      word-break: break-all;
    }
  `;
}

function renderLabelHtml({ name, barcode, isContainer, qrDataUrl }) {
  return `
    <section class="label">
      <div class="top">
        <span>Measured · Kit</span>
        ${isContainer ? '<span>Container</span>' : ''}
      </div>
      <div class="name">${escapeHtml(name)}</div>
      <div class="qr-wrap">
        <img src="${qrDataUrl}" alt="QR code">
        <div class="code">${escapeHtml(truncateMiddle(barcode, 48))}</div>
      </div>
    </section>`;
}

/**
 * Build preview HTML for kit labels (tests / debugging). Printing uses WebUSB.
 * @param {{ name: string, barcode: string, isContainer?: boolean, copies?: number, qrDataUrl: string }} ctx
 */
export function buildKitLabelHtml(ctx) {
  const name = String(ctx?.name || '').trim() || 'Kit item';
  const barcode = String(ctx?.barcode || '').trim();
  if (!barcode) throw new Error('Barcode required to print a kit label.');
  if (!ctx?.qrDataUrl) throw new Error('QR image required to print a kit label.');

  const copies = Math.max(1, Math.min(50, Math.floor(Number(ctx?.copies) || 1)));
  const isContainer = !!ctx?.isContainer;
  const labels = Array.from({ length: copies }, () => renderLabelHtml({
    name,
    barcode,
    isContainer,
    qrDataUrl: ctx.qrDataUrl,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kit label — ${escapeHtml(name)}</title>
  <style>${labelStyles()}</style>
</head>
<body>
  ${labels.join('\n')}
</body>
</html>`;
}

/**
 * Print kit labels directly to a QL-800 via WebUSB (Chrome / Edge).
 * Landscape artwork is rotated so the 62mm edge aligns with the print head.
 * @param {{ name: string, barcode: string, isContainer?: boolean, copies?: number }} ctx
 */
export async function printKitLabel(ctx) {
  const name = String(ctx?.name || '').trim() || 'Kit item';
  const barcode = String(ctx?.barcode || '').trim();
  if (!barcode) throw new Error('Barcode required to print a kit label.');

  const copies = Math.max(1, Math.min(50, Math.floor(Number(ctx?.copies) || 1)));
  const qrDataUrl = await QRCode.toDataURL(barcode, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#141414', light: '#ffffff' },
  });

  const canvas = await renderKitLabelCanvas({
    name,
    barcode,
    isContainer: !!ctx?.isContainer,
    qrDataUrl,
  });

  const canvases = Array.from({ length: copies }, () => canvas);
  return printCanvasesToQl800(canvases, {
    thermalMediaId: QL_MEDIA_62_CONTINUOUS,
    rotate: 90,
  });
}

/** @deprecated Use printKitLabel — kept as alias for call sites. */
export async function generateKitLabelPDF(ctx) {
  return printKitLabel(ctx);
}
