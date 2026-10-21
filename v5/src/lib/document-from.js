/**
 * Letterhead printed under the logo on purchase orders and invoices.
 * Stored on the organisation; the defaults match the previous hardcoded block.
 */

import { getDB } from '../db.js';
import { getActiveOrganisation } from './organisations.js';

export const INVOICE_FROM = {
  name: 'Measured',
  addressLines: [
    '124 City Road',
    'London, EC1V 2NX',
  ],
  email: 'live@measured.events',
  website: 'measured.events',
};

const LEGAL_FOOTER = 'VV Events LTD T/A Measured | Registered in England and Wales | Company No. 14660281';

const ADDRESS_MAX = 500;
const CONTACT_MAX = 120;

/** @type {{ orgId: string, letterhead: ReturnType<typeof letterheadFromRow>, ready: boolean } | null} */
let cache = null;

function defaultLetterhead() {
  return {
    name: INVOICE_FROM.name,
    addressLines: [...INVOICE_FROM.addressLines],
    email: INVOICE_FROM.email,
    website: INVOICE_FROM.website,
  };
}

/** Lines drawn under the logo, in order. */
export function letterheadLines(from) {
  return [...(from?.addressLines || []), from?.email, from?.website]
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

/**
 * @param {object|null|undefined} row organisation row, or null when no org is loaded
 */
export function letterheadFromRow(row) {
  if (!row) return defaultLetterhead();
  return {
    name: INVOICE_FROM.name,
    addressLines: String(row.document_address ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    email: String(row.document_email ?? '').trim(),
    website: String(row.document_website ?? '').trim(),
  };
}

/** Registered-office line on the purchase order, using the saved address. */
export function companyFooter(from) {
  const office = (from?.addressLines || []).filter(Boolean).join(', ');
  return office ? `${LEGAL_FOOTER} | Registered Office: ${office}` : LEGAL_FOOTER;
}

/**
 * @param {{ address?: string, email?: string, website?: string }} input
 * @returns {{ error: string } | { fields: { document_address: string, document_email: string, document_website: string } }}
 */
export function parseDocumentFields({ address, email, website } = {}) {
  const document_address = String(address ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  if (document_address.length > ADDRESS_MAX) return { error: 'Address is too long' };

  const document_email = String(email ?? '').trim();
  if (document_email.length > CONTACT_MAX) return { error: 'Email is too long' };
  if (document_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document_email)) {
    return { error: 'Enter a valid email, or leave it blank' };
  }

  const document_website = String(website ?? '').trim();
  if (document_website.length > CONTACT_MAX) return { error: 'Website is too long' };

  return { fields: { document_address, document_email, document_website } };
}

export function setLetterheadCache(row) {
  const orgId = getActiveOrganisation()?.id;
  if (!orgId) return;
  cache = { orgId, letterhead: letterheadFromRow(row), ready: true };
}

/** Letterhead for the active organisation. Falls back to the built-in address. */
export async function loadLetterhead() {
  const orgId = getActiveOrganisation()?.id;
  if (!orgId) return defaultLetterhead();
  if (cache?.orgId === orgId) return cache.letterhead;
  try {
    const rows = await getDB().select(
      'organisations',
      `?id=eq.${encodeURIComponent(orgId)}&select=document_address,document_email,document_website`,
    );
    const row = rows?.[0];
    if (!row || !('document_address' in row)) return defaultLetterhead();
    const letterhead = letterheadFromRow(row);
    cache = { orgId, letterhead, ready: true };
    return letterhead;
  } catch {
    return defaultLetterhead();
  }
}
