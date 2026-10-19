/**
 * Site delivery details shared by event setup and purchase orders.
 * What3Words, the on-site contact and the fact sheet live on the event.
 * AM/PM is chosen on each purchase order.
 */

export function formatWhat3Words(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.startsWith('///')) return s;
  return `///${s.replace(/^\/+/, '')}`;
}

/** @returns {'AM'|'PM'|''} */
export function deliveryTimeLabel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'am') return 'AM';
  if (v === 'pm') return 'PM';
  return '';
}

/** @returns {'pdf'|'image'|''} */
export function factSheetKind(name = '', type = '') {
  const n = String(name || '').split('?')[0].toLowerCase();
  const t = String(type || '').toLowerCase();
  if (t.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
  if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(n)) return 'image';
  return '';
}
