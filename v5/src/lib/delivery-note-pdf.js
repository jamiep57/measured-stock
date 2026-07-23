/**
 * Transfer delivery note PDF — ported from v2 generateDeliveryNotePDF.
 */

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.js';
const LOGO_URL = '/assets/img/logo.png';
const OUTFIT_REGULAR_URL = '/assets/fonts/Outfit-Regular.ttf';
const OUTFIT_BOLD_URL = '/assets/fonts/Outfit-Bold.ttf';

let jspdfPromise;
let logoPromise;
let outfitFontDataPromise;

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

/** Load logo as data URL + natural dimensions for PDF embedding. */
async function loadLogoForPdf() {
  if (logoPromise !== undefined) return logoPromise;
  logoPromise = (async () => {
    try {
      const res = await fetch(LOGO_URL);
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const dims = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
      if (!dims?.width || !dims.height) return null;
      return { dataUrl, ...dims };
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
  doc.addImage(logo.dataUrl, 'PNG', logoX, logoY, logoW, logoH);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadOutfitFontData() {
  if (outfitFontDataPromise !== undefined) return outfitFontDataPromise;
  outfitFontDataPromise = (async () => {
    try {
      const [regRes, boldRes] = await Promise.all([
        fetch(OUTFIT_REGULAR_URL),
        fetch(OUTFIT_BOLD_URL),
      ]);
      if (!regRes.ok || !boldRes.ok) return null;
      const [regular, bold] = await Promise.all([
        regRes.arrayBuffer().then(arrayBufferToBase64),
        boldRes.arrayBuffer().then(arrayBufferToBase64),
      ]);
      return { regular, bold };
    } catch {
      return null;
    }
  })();
  return outfitFontDataPromise;
}

function registerOutfitFonts(doc, fonts) {
  doc.addFileToVFS('Outfit-Regular.ttf', fonts.regular);
  doc.addFont('Outfit-Regular.ttf', 'Outfit', 'normal');
  doc.addFileToVFS('Outfit-Bold.ttf', fonts.bold);
  doc.addFont('Outfit-Bold.ttf', 'Outfit', 'bold');
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
  const [jspdf, logo, outfitFonts] = await Promise.all([
    loadJsPdf(),
    loadLogoForPdf(),
    loadOutfitFontData(),
  ]);
  const { jsPDF } = jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const useOutfit = !!(outfitFonts && typeof doc.addFileToVFS === 'function');
  if (useOutfit) registerOutfitFonts(doc, outfitFonts);

  const pageW = 210;
  const ml = 15;
  const mr = 15;
  const contentW = pageW - ml - mr;
  const black = [20, 20, 20];
  const grey = [120, 120, 120];
  const lightGrey = [220, 220, 220];
  const bgGrey = [242, 242, 242];

  function setFont(style, size, color) {
    if (useOutfit) {
      doc.setFont('Outfit', style === 'bold' ? 'bold' : 'normal');
    } else {
      doc.setFont('helvetica', style);
    }
    doc.setFontSize(size);
    doc.setTextColor.apply(doc, color || black);
  }

  if (logo) drawLogo(doc, logo, pageW, mr);

  setFont('bold', 26, black);
  doc.text('Delivery Note', ml, 18);

  let y = 30;
  setFont('normal', 9, grey);
  doc.text('Event:', ml, y);
  doc.text('Date:', pageW - mr - 36, y);

  y += 3;
  doc.setDrawColor.apply(doc, lightGrey);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(ml, y, contentW - 42, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(eventName, ml + 2, y + 6);

  const dateStr = date.toLocaleDateString('en-GB').replace(/\//g, '  /  ');
  doc.roundedRect(pageW - mr - 38, y, 38, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(dateStr, pageW - mr - 36, y + 6);

  y += 14;
  setFont('normal', 9, grey);
  doc.text('Time:', ml, y);
  doc.text('Company/Department:', ml + 40, y);

  y += 3;
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  doc.roundedRect(ml, y, 35, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(timeStr, ml + 2, y + 6);

  doc.roundedRect(ml + 40, y, contentW - 40, 9, 1, 1, 'S');
  setFont('normal', 10, black);
  doc.text(recipientName || '', ml + 42, y + 6);

  y += 18;
  setFont('bold', 16, black);
  doc.text('Counts', ml, y);

  y += 6;
  const col1W = contentW * 0.52;
  const col2W = contentW * 0.28;
  const col3W = contentW - col1W - col2W;
  setFont('normal', 9, grey);
  doc.text('Product/Item', ml + 2, y + 4);
  doc.text('Size/Specs', ml + col1W + 2, y + 4);
  doc.text('(eg 24x330ml, 8x1L, 1x50L)', ml + col1W + 2, y + 7.5);
  doc.text('Count', ml + col1W + col2W + 2, y + 4);

  y += 10;
  const rowH = 9;
  const maxRows = Math.max(15, lines.length);
  for (let i = 0; i < maxRows; i++) {
    const line = lines[i];
    if (i % 2 === 1) {
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
      let countText;
      if (line.cases != null || line.singles != null) {
        const cs = Number(line.cases) || 0;
        const sg = Number(line.singles) || 0;
        const parts = [];
        if (cs > 0 || sg === 0) parts.push(`${round1(cs)} case${cs === 1 ? '' : 's'}`);
        if (sg > 0) parts.push(`${Math.round(sg)} single${Math.round(sg) === 1 ? '' : 's'}`);
        countText = parts.join(' + ');
      } else {
        countText = `${line.qty} ${unit}`;
      }
      doc.text(countText, ml + col1W + col2W + 2, y + 6);
    }
    y += rowH;
  }

  y += 8;
  const sigRows = [
    { label: 'Sender &\nCompany' },
    { label: 'Signed Sender' },
    { label: 'Receiver &\nCompany' },
    { label: 'Signed Receiver' },
  ];
  const labelW = 36;
  const sigH = 13;
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

  const safeName = (recipientName || 'transfer').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateTag = date.toLocaleDateString('en-GB').replace(/\//g, '-');
  doc.save(`delivery_note_${safeName}_${dateTag}.pdf`);
}
