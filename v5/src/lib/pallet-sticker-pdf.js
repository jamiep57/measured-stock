/**
 * Return / warehouse pallet stickers — landscape A4, one page per pallet.
 */

import { loadJsPdf, loadLogoForPdf } from './delivery-note-pdf.js';

const LOGO_ALIAS = 'pallet-sticker-logo';

/**
 * Split a quantity across pallets.
 * Full pallets get `perPallet`; the last gets the remainder (if any).
 * @param {number} qty
 * @param {number} perPallet
 * @returns {number[]}
 */
export function splitPalletQtys(qty, perPallet) {
  const total = Math.max(0, Number(qty) || 0);
  const per = Math.max(0, Math.floor(Number(perPallet) || 0));
  if (total <= 0) return [];
  if (per <= 0) return [total];
  const full = Math.floor(total / per);
  const rem = Math.round((total - full * per) * 1000) / 1000;
  const pallets = Array.from({ length: full }, () => per);
  if (rem > 0) pallets.push(rem);
  return pallets;
}

function fmtCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}

function drawCornerLogo(doc, logo, x, y, maxW = 42, maxH = 14) {
  if (!logo?.dataUrl) return false;
  const aspect = logo.width / logo.height;
  let logoW = maxW;
  let logoH = logoW / aspect;
  if (logoH > maxH) {
    logoH = maxH;
    logoW = logoH * aspect;
  }
  doc.addImage(logo.dataUrl, logo.format || 'JPEG', x, y, logoW, logoH, LOGO_ALIAS);
  return true;
}

/**
 * Download a landscape A4 PDF — one page per pallet.
 */
export async function generatePalletStickerPDF(ctx) {
  const pallets = ctx.pallets || [];
  if (!pallets.length) throw new Error('Nothing to print — enter a quantity greater than 0.');

  const [jspdf, logo] = await Promise.all([
    loadJsPdf(),
    loadLogoForPdf(),
  ]);
  const { jsPDF } = jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  const m = 14;
  const black = [20, 20, 20];
  const grey = [110, 110, 110];
  const line = [200, 200, 200];
  const total = pallets.length;
  const destLabel = ctx.destinationLabel || '—';
  const productName = ctx.productName || '—';
  const caseSize = ctx.caseSize || '';

  pallets.forEach((qty, i) => {
    if (i > 0) doc.addPage();

    doc.setDrawColor(...line);
    doc.setLineWidth(0.6);
    doc.rect(m, m, pageW - 2 * m, pageH - 2 * m, 'S');

    const logoOk = drawCornerLogo(doc, logo, m + 8, m + 6, 42, 14);
    if (!logoOk) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(...black);
      doc.text('measured', m + 8, m + 16);
    }

    doc.setDrawColor(...line);
    doc.line(m + 8, m + 24, pageW - m - 8, m + 24);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(52);
    doc.setTextColor(...black);
    const destLines = doc.splitTextToSize(String(destLabel).toUpperCase(), pageW - 2 * m - 16);
    doc.text(destLines.slice(0, 2), m + 8, m + 52);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(...black);
    const prodLine = productName + (caseSize ? `  ·  ${caseSize}` : '');
    const prodLines = doc.splitTextToSize(prodLine, pageW - 2 * m - 16);
    doc.text(prodLines.slice(0, 2), m + 8, m + 88);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...grey);
    doc.text('PALLET', m + 8, pageH - m - 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(64);
    doc.setTextColor(...black);
    doc.text(`${i + 1} of ${total}`, m + 8, pageH - m - 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...grey);
    doc.text('CASES', pageW - m - 8, pageH - m - 42, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(64);
    doc.setTextColor(...black);
    doc.text(fmtCount(qty), pageW - m - 8, pageH - m - 14, { align: 'right' });
  });

  const safe = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  doc.save(`pallet_stickers_${safe(destLabel)}_${safe(productName)}.pdf`);
}
