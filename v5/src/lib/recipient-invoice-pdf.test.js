import { describe, it, expect } from 'vitest';
import {
  INVOICE_FROM,
  INVOICE_VAT_RATE,
  buildInvoiceNumber,
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceVatBreakdown,
} from './recipient-invoice-pdf.js';

describe('invoiceVatBreakdown', () => {
  it('applies UK standard VAT at 20%', () => {
    expect(INVOICE_VAT_RATE).toBe(0.2);
    expect(invoiceVatBreakdown(100)).toEqual({
      net: 100,
      vat: 20,
      total: 120,
      vatRate: 0.2,
    });
  });

  it('rounds money to two decimals', () => {
    expect(invoiceVatBreakdown(10.11)).toEqual({
      net: 10.11,
      vat: 2.02,
      total: 12.13,
      vatRate: 0.2,
    });
  });
});

describe('formatInvoiceMoney', () => {
  it('formats GBP with two decimals', () => {
    expect(formatInvoiceMoney(1699.65)).toBe('£1,699.65');
    expect(formatInvoiceMoney(4.5)).toBe('£4.50');
  });

  it('returns dash for missing values', () => {
    expect(formatInvoiceMoney(null)).toBe('—');
    expect(formatInvoiceMoney(Number.NaN)).toBe('—');
  });
});

describe('formatInvoiceDate', () => {
  it('formats as day MONTH year', () => {
    expect(formatInvoiceDate(new Date(2026, 6, 24))).toBe('24 JUL 2026');
  });
});

describe('buildInvoiceNumber', () => {
  it('builds a stable invoice number from event, client, and date', () => {
    expect(buildInvoiceNumber({
      eventName: 'Peep 2026',
      recipientName: 'Artist Liaison',
      date: new Date(2026, 6, 24),
    })).toBe('INV-PEEP2026-ARTIST-20260724');
  });
});

describe('INVOICE_FROM', () => {
  it('includes the business address and contact', () => {
    expect(INVOICE_FROM.addressLines).toContain('124 City Road');
    expect(INVOICE_FROM.addressLines).toContain('London, EC1V 2NX');
    expect(INVOICE_FROM.email).toBe('live@measured.events');
    expect(INVOICE_FROM.website).toBe('measured.events');
  });
});
