/**
 * Transfer delivery note PDF — ported from v2 generateDeliveryNotePDF.
 *
 * Uses built-in Helvetica (like v2) instead of embedding Outfit TTFs, and
 * embeds a downscaled JPEG logo so downloads stay small.
 */

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.js';
const LOGO_URL = '/assets/img/logo.png';
/** ~150dpi at max logo width (52mm) — enough for print, keeps the PDF small. */
const LOGO_PDF_MAX_PX = 320;
const LOGO_JPEG_QUALITY = 0.72;
const LOGO_ALIAS = 'delivery-note-logo';

let jspdfPromise;
let logoPromise;

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

async function loadJsPdf() {
  if (typeof window !== 'undefined' && window.jspdf?.jsPDF) {
    return window.jspdf;
  }
  if (!jspdfPromise) {
    jspdfPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSPDF_URL;
      script.async = true;
      script.onload = () => {
        if (window.jspdf?.jsPDF) resolve(window.jspdf);
        else reject(new Error('PDF library failed to load'));
      };
      script.onerror = () => reject(new Error('PDF library failed to load — check your connection and reload.'));
      document.head.appendChild(script);
    });
  }
  return jspdfPromise;
}

/** Downscale + JPEG-compress the logo for PDF embedding. */
function compressLogoForPdf(img) {
  const scale = Math.min(1, LOGO_PDF_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', LOGO_JPEG_QUALITY),
    format: 'JPEG',
    width,
    height,
  };
}

/** Load logo as a small JPEG data URL + dimensions for PDF embedding. */
async function loadLogoForPdf() {
  if (logoPromise !== undefined) return logoPromise;
  logoPromise = (async () => {
    try {
      const res = await fetch(LOGO_URL);
      if (!res.ok) return null;
      const blob = await res.blob();
      const srcUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = srcUrl;
      });
      if (!img.naturalWidth || !img.naturalHeight) return null;
      return compressLogoForPdf(img);
    } catch {
      return null;
    }
  })();
  return logoPromise;
}

function drawLogo(doc, logo, pageW, mr) {
  const maxW = 52;
  const maxH = 14;
  const aspect = logo.width / logo.height;
  let logoW = maxW;
  let logoH = logoW / aspect;
  if (logoH > maxH) {
    logoH = maxH;
    logoW = logoH * aspect;
  }
  const logoX = pageW - mr - logoW;
  const logoY = 7;
  // Alias reuses one image stream across pages instead of re-embedding.
  doc.addImage(logo.dataUrl, logo.format || 'JPEG', logoX, logoY, logoW, logoH, LOGO_ALIAS);
}

function formatLineCount(line, unit) {
  if (line.cases != null || line.singles != null) {
    const cs = Number(line.cases) || 0;
    const sg = Number(line.singles) || 0;
    const parts = [];
    if (cs > 0 || sg === 0) parts.push(`${round1(cs)} case${cs === 1 ? '' : 's'}`);
    if (sg > 0) parts.push(`${Math.round(sg)} single${Math.round(sg) === 1 ? '' : 's'}`);
    return parts.join(' + ');
  }
  return `${line.qty} ${unit}`;
}

/**
 * @param {object} options
 * @param {string} options.eventName
 * @param {string} options.recipientName
 * @param {Date} options.date
 * @param {Array<{ productId: string, cases?: number, singles?: number, qty?: number }>} options.lines
 * @param {(productId: string) => { name?: string, size?: string }} options.productInfo
 * @param {string} [options.unit='cases']
 */
export async function generateDeliveryNotePDF({
  eventName = '',
  recipientName = '',
  date = new Date(),
  lines = [],
  productInfo,
  unit = 'cases',
}) {
  const [jspdf, logo] = await Promise.all([
    loadJsPdf(),
    loadLogoForPdf(),
  ]);
  const { jsPDF } = jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  const pageW = 210;
  const pageH = 297;
  const ml = 15;
  const mr = 15;
  const contentW = pageW - ml - mr;
  const bottomMargin = 14;
  const black = [20, 20, 20];
  const grey = [120, 120, 120];
  const lightGrey = [220, 220, 220];
  const bgGrey = [242, 242, 242];
  const col1W = contentW * 0.52;
  const col2W = contentW * 0.28;
  const col3W = contentW - col1W - col2W;
  const rowH = 9;
  const sigRows = [
    { label: 'Sender &\nCompany' },
    { label: 'Signed Sender' },
    { label: 'Receiver &\nCompany' },
    { label: 'Signed Receiver' },
  ];
  const labelW = 36;
  const sigH = 13;
  const sigBlockH = 8 + sigRows.length * sigH;

  const dateStr = date.toLocaleDateString('en-GB').replace(/\//g, '  /  ');
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  function setFont(style, size, color) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor.apply(doc, color || black);
  }

  function drawMetaFields(startY) {
    let y = startY;
    setFont('normal', 9, grey);
    doc.text('Event:', ml, y);
    doc.text('Date:', pageW - mr - 36, y);

    y += 3;
    doc.setDrawColor.apply(doc, lightGrey);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(ml, y, contentW - 42, 9, 1, 1, 'S');
    setFont('normal', 10, black);
    doc.text(eventName, ml + 2, y + 6);

    doc.roundedRect(pageW - mr - 38, y, 38, 9, 1, 1, 'S');
    setFont('normal', 10, black);
    doc.text(dateStr, pageW - mr - 36, y + 6);

    y += 14;
    setFont('normal', 9, grey);
    doc.text('Time:', ml, y);
    doc.text('Company/Department:', ml + 40, y);

    y += 3;
    doc.roundedRect(ml, y, 35, 9, 1, 1, 'S');
    setFont('normal', 10, black);
    doc.text(timeStr, ml + 2, y + 6);

    doc.roundedRect(ml + 40, y, contentW - 40, 9, 1, 1, 'S');
    setFont('normal', 10, black);
    doc.text(recipientName || '', ml + 42, y + 6);

    return y + 18;
  }

  function drawTableHeader(startY, title) {
    let y = startY;
    setFont('bold', 16, black);
    doc.text(title, ml, y);
    y += 6;
    setFont('normal', 9, grey);
    doc.text('Product/Item', ml + 2, y + 4);
    doc.text('Size/Specs', ml + col1W + 2, y + 4);
    doc.text('(eg 24x330ml, 8x1L, 1x50L)', ml + col1W + 2, y + 7.5);
    doc.text('Count', ml + col1W + col2W + 2, y + 4);
    return y + 10;
  }

  function drawFirstPageHeader() {
    if (logo) drawLogo(doc, logo, pageW, mr);
    setFont('bold', 26, black);
    doc.text('Delivery Note', ml, 18);
    return drawTableHeader(drawMetaFields(30), 'Counts');
  }

  function drawContinuationChrome() {
    if (logo) drawLogo(doc, logo, pageW, mr);
    setFont('bold', 20, black);
    doc.text('Delivery Note', ml, 16);
    setFont('normal', 9, grey);
    doc.text('continued', ml, 22);
    doc.text(`Event: ${eventName}`, ml, 30);
    doc.text(`To: ${recipientName || '—'}`, ml + contentW * 0.55, 30);
  }

  function drawContinuationHeader() {
    drawContinuationChrome();
    return drawTableHeader(38, 'Counts');
  }

  function drawRow(line, rowIndex, y) {
    if (rowIndex % 2 === 1) {
      doc.setFillColor.apply(doc, bgGrey);
      doc.rect(ml, y, contentW, rowH, 'F');
    }
    doc.setDrawColor.apply(doc, lightGrey);
    doc.setLineWidth(0.3);
    doc.rect(ml, y, col1W, rowH, 'S');
    doc.rect(ml + col1W, y, col2W, rowH, 'S');
    doc.rect(ml + col1W + col2W, y, col3W, rowH, 'S');
    if (line) {
      const info = productInfo?.(line.productId) || {};
      setFont('normal', 9.5, black);
      doc.text(info.name || '', ml + 2, y + 6);
      doc.text(info.size || '', ml + col1W + 2, y + 6);
      doc.text(formatLineCount(line, unit), ml + col1W + col2W + 2, y + 6);
    }
  }

  function drawSignatures(startY) {
    let y = startY + 8;
    sigRows.forEach((row) => {
      doc.setDrawColor.apply(doc, lightGrey);
      doc.setLineWidth(0.4);
      doc.setFillColor(255, 255, 255);
      doc.rect(ml, y, contentW, sigH, 'S');
      doc.setFillColor.apply(doc, bgGrey);
      doc.rect(ml, y, labelW, sigH, 'F');
      doc.rect(ml, y, labelW, sigH, 'S');
      setFont('bold', 8.5, black);
      const labelLines = row.label.split('\n');
      if (labelLines.length === 2) {
        doc.text(labelLines[0], ml + labelW - 2, y + sigH / 2 - 1, { align: 'right' });
        doc.text(labelLines[1], ml + labelW - 2, y + sigH / 2 + 4, { align: 'right' });
      } else {
        doc.text(row.label, ml + labelW - 2, y + sigH / 2 + 1.5, { align: 'right' });
      }
      y += sigH;
    });
  }

  function stampPageNumbers() {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      setFont('normal', 8, grey);
      doc.text(`Page ${p} of ${total}`, pageW / 2, pageH - 6, { align: 'center' });
    }
  }

  let y = drawFirstPageHeader();
  const maxRows = Math.max(15, lines.length);

  for (let i = 0; i < maxRows; i++) {
    const isLastRow = i === maxRows - 1;
    // Prefer keeping the signature block with the final row when it fits.
    const needBelow = isLastRow ? rowH + sigBlockH : rowH;
    if (y + needBelow > pageH - bottomMargin) {
      if (isLastRow && y + rowH <= pageH - bottomMargin) {
        drawRow(lines[i], i, y);
        y += rowH;
        break;
      }
      doc.addPage();
      y = drawContinuationHeader();
    }
    drawRow(lines[i], i, y);
    y += rowH;
  }

  if (y + sigBlockH > pageH - bottomMargin) {
    doc.addPage();
    drawContinuationChrome();
    y = 36;
  }
  drawSignatures(y);
  stampPageNumbers();

  const safeName = (recipientName || 'transfer').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateTag = date.toLocaleDateString('en-GB').replace(/\//g, '-');
  doc.save(`delivery_note_${safeName}_${dateTag}.pdf`);
}
