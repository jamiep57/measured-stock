/** Read Square CSV/TSV/XLSX exports into row objects. */

async function sheetToRows(buf) {
  if (typeof globalThis.XLSX === 'undefined') {
    throw new Error('Excel support not loaded');
  }
  const wb = globalThis.XLSX.read(new Uint8Array(buf), { type: 'array', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return globalThis.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

function delimitedToRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('No rows found in file.');
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

export async function readSpreadsheetFile(file) {
  const buf = await file.arrayBuffer();
  if (typeof globalThis.XLSX !== 'undefined') {
    try {
      return await sheetToRows(buf);
    } catch {
      /* fall through to delimited parse */
    }
  }
  const text = new TextDecoder('utf-8').decode(buf);
  return delimitedToRows(text);
}
