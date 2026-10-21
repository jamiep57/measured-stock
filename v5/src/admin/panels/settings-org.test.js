import { describe, expect, it } from 'vitest';
import { formatPoStartReference, parsePoStartNumber, renderOrganisationSection } from './settings-org.js';

describe('purchase order start number', () => {
  it('accepts a whole number in range', () => {
    expect(parsePoStartNumber('1')).toBe(1);
    expect(parsePoStartNumber(' 500 ')).toBe(500);
    expect(parsePoStartNumber('9999999')).toBe(9999999);
  });

  it('rejects blanks, decimals and values outside the range', () => {
    expect(parsePoStartNumber('')).toBeNull();
    expect(parsePoStartNumber('0')).toBeNull();
    expect(parsePoStartNumber('1.5')).toBeNull();
    expect(parsePoStartNumber('10000000')).toBeNull();
    expect(parsePoStartNumber('PO-10')).toBeNull();
  });

  it('shows the start number on the organisation settings page', () => {
    const html = renderOrganisationSection();
    expect(html).toContain('Purchase order numbers start from');
    expect(html).toContain('id="settingsPoStart"');
    expect(html).toContain('Address on documents');
    expect(html).toContain('id="settingsDocAddress"');
    expect(html).toContain('id="settingsDocEmail"');
    expect(html).toContain('id="settingsDocWebsite"');
  });

  it('previews the reference the database will assign', () => {
    expect(formatPoStartReference(1)).toBe('PO-00001');
    expect(formatPoStartReference(500)).toBe('PO-00500');
    expect(formatPoStartReference(100000)).toBe('PO-100000');
  });
});