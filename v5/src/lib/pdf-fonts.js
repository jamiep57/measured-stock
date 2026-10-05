/**
 * Outfit — the Measured UI typeface — embedded in PDFs.
 * Files are the Latin subset in /assets/fonts.
 */

const URLS = {
  normal: '/assets/fonts/Outfit-Regular.ttf',
  bold: '/assets/fonts/Outfit-Bold.ttf',
};

let pending = null;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function loadOutfit() {
  if (!pending) {
    pending = Promise.all(
      [URLS.normal, URLS.bold].map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load ${url}`);
        return toBase64(await res.arrayBuffer());
      }),
    ).catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Register Outfit on a jsPDF document. Returns the family name. */
export async function registerOutfit(doc) {
  const [regular, bold] = await loadOutfit();
  doc.addFileToVFS('Outfit-Regular.ttf', regular);
  doc.addFont('Outfit-Regular.ttf', 'Outfit', 'normal');
  doc.addFileToVFS('Outfit-Bold.ttf', bold);
  doc.addFont('Outfit-Bold.ttf', 'Outfit', 'bold');
  return 'Outfit';
}
