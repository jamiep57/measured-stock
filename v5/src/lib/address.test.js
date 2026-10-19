import { describe, expect, it } from 'vitest';
import {
  addressFromSupplier,
  formatAddress,
  normalisePostcode,
  parseAddress,
} from './address.js';

describe('supplier address fields', () => {
  it('splits a multiline address and lifts the postcode', () => {
    expect(parseAddress('Unit 4\nClannaborough Business Units\nBow\nCrediton \nEX17 6DA')).toEqual({
      line1: 'Unit 4',
      line2: 'Clannaborough Business Units',
      town: 'Bow',
      city: 'Crediton',
      county: '',
      postcode: 'EX17 6DA',
    });
  });

  it('splits a comma-separated line when the postcode sits on the town', () => {
    expect(parseAddress('Unit 4, Clannaborough Business Units, Bow, Crediton EX17 6DA')).toEqual({
      line1: 'Unit 4',
      line2: 'Clannaborough Business Units',
      town: 'Bow',
      city: 'Crediton',
      county: '',
      postcode: 'EX17 6DA',
    });
  });

  it('treats a short address as line 1 and city', () => {
    expect(parseAddress('1 High Street, London, SW1A 1AA')).toEqual({
      line1: '1 High Street',
      line2: '',
      town: '',
      city: 'London',
      county: '',
      postcode: 'SW1A 1AA',
    });
  });

  it('keeps a county when there is a fifth line', () => {
    expect(parseAddress('1 High Street\nFlat 2\nWestminster\nLondon\nGreater London\nSW1A 1AA')).toMatchObject({
      line1: '1 High Street',
      line2: 'Flat 2',
      town: 'Westminster',
      city: 'London',
      county: 'Greater London',
      postcode: 'SW1A 1AA',
    });
  });

  it('normalises postcode spacing', () => {
    expect(normalisePostcode('ex176da')).toBe('EX17 6DA');
    expect(normalisePostcode('m1 1ae')).toBe('M1 1AE');
    expect(normalisePostcode('not a code')).toBe('NOT A CODE');
  });

  it('joins the fields back into one address', () => {
    expect(formatAddress({
      line1: 'Unit 4',
      line2: 'Clannaborough Business Units',
      town: 'Bow',
      city: 'Crediton',
      county: '',
      postcode: 'EX17 6DA',
    })).toBe('Unit 4\nClannaborough Business Units\nBow\nCrediton\nEX17 6DA');
  });

  it('prefers saved columns over the old text blob', () => {
    expect(addressFromSupplier({
      address: 'Old blob',
      address_line1: 'Unit 4',
      city: 'Crediton',
      postcode: 'EX17 6DA',
    })).toMatchObject({
      line1: 'Unit 4',
      city: 'Crediton',
      postcode: 'EX17 6DA',
    });
  });
});
