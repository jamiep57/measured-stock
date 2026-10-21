import { describe, expect, it } from 'vitest';
import {
  INVOICE_FROM,
  companyFooter,
  letterheadFromRow,
  letterheadLines,
  parseDocumentFields,
} from './document-from.js';

describe('letterhead', () => {
  it('uses the previous address when no organisation row is loaded', () => {
    const from = letterheadFromRow(null);
    expect(from.addressLines).toEqual(INVOICE_FROM.addressLines);
    expect(from.email).toBe('live@measured.events');
    expect(letterheadLines(from)).toEqual([
      '124 City Road',
      'London, EC1V 2NX',
      'live@measured.events',
      'measured.events',
    ]);
  });

  it('reads the address saved on the organisation', () => {
    const from = letterheadFromRow({
      document_address: ' 1 High Street \n Leeds, LS1 1AA \n',
      document_email: 'hello@example.com',
      document_website: 'example.com',
    });
    expect(letterheadLines(from)).toEqual([
      '1 High Street',
      'Leeds, LS1 1AA',
      'hello@example.com',
      'example.com',
    ]);
  });

  it('puts the saved address on the purchase order footer', () => {
    const from = letterheadFromRow({
      document_address: '1 High Street\nLeeds, LS1 1AA',
      document_email: '',
      document_website: '',
    });
    expect(companyFooter(from)).toContain('Registered Office: 1 High Street, Leeds, LS1 1AA');
  });
});

describe('parseDocumentFields', () => {
  it('keeps one address line per row', () => {
    const parsed = parseDocumentFields({
      address: ' 124 City Road \n\n London, EC1V 2NX ',
      email: ' live@measured.events ',
      website: ' measured.events ',
    });
    expect(parsed.fields).toEqual({
      document_address: '124 City Road\nLondon, EC1V 2NX',
      document_email: 'live@measured.events',
      document_website: 'measured.events',
    });
  });

  it('rejects an email that is not an address', () => {
    expect(parseDocumentFields({ address: '', email: 'not-an-email', website: '' }).error)
      .toMatch(/email/i);
  });
});
