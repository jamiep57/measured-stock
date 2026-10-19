/**
 * UK supplier address as separate lines. The legacy `address` text stays
 * as the joined version so older screens keep working.
 */

const POSTCODE_AT_END = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\s*$/i;

export function emptyAddress() {
  return { line1: '', line2: '', town: '', city: '', county: '', postcode: '' };
}

/** Uppercase a UK postcode and put the space in. Anything else is trimmed. */
export function normalisePostcode(raw) {
  const trimmed = String(raw || '').trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/);
  if (!match) return trimmed;
  return `${match[1]} ${match[2]}`;
}

export function formatAddress(parts) {
  const src = parts || {};
  return [src.line1, src.line2, src.town, src.city, src.county, src.postcode]
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Split a free-text address. Newlines win over commas. A UK postcode at the
 * end of the last line is lifted out. Remaining lines fill line 1, line 2,
 * town, city, then county.
 */
export function parseAddress(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const out = emptyAddress();
  if (!text) return out;

  const newlineParts = text.split('\n').map((line) => line.trim()).filter(Boolean);
  let chunks = newlineParts.length > 1
    ? newlineParts
    : text.split(',').map((line) => line.trim()).filter(Boolean);
  if (!chunks.length) return out;

  const last = chunks[chunks.length - 1];
  const postcode = last.match(POSTCODE_AT_END);
  if (postcode) {
    out.postcode = normalisePostcode(`${postcode[1]} ${postcode[2]}`);
    const rest = last.slice(0, postcode.index).replace(/[,\s]+$/g, '').trim();
    if (rest) chunks[chunks.length - 1] = rest;
    else chunks = chunks.slice(0, -1);
  }

  const count = chunks.length;
  if (count >= 1) out.line1 = chunks[0];
  if (count === 2) out.city = chunks[1];
  else if (count === 3) {
    out.line2 = chunks[1];
    out.city = chunks[2];
  } else if (count === 4) {
    out.line2 = chunks[1];
    out.town = chunks[2];
    out.city = chunks[3];
  } else if (count >= 5) {
    out.line2 = chunks[1];
    out.town = chunks[2];
    out.city = chunks[3];
    out.county = chunks.slice(4).join(', ');
  }
  return out;
}

/** Saved columns win. Otherwise split the legacy address text. */
export function addressFromSupplier(supplier) {
  const stored = {
    line1: String(supplier?.address_line1 || '').trim(),
    line2: String(supplier?.address_line2 || '').trim(),
    town: String(supplier?.town || '').trim(),
    city: String(supplier?.city || '').trim(),
    county: String(supplier?.county || '').trim(),
    postcode: String(supplier?.postcode || '').trim(),
  };
  if (Object.values(stored).some(Boolean)) return stored;
  return parseAddress(supplier?.address);
}
