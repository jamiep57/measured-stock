import { describe, it, expect } from 'vitest';
import {
  closingCellKeyFromInput,
  distributionCellKeyFromInput,
  countsCellKeyFromInput,
  reconCellKeyFromInput,
  productsCellKeyFromInput,
  kitCellKeyFromInput,
  salesCellKeyFromInput,
  reportsCellKeyFromInput,
} from './grid-collab-keys.js';

describe('grid-collab-keys adapters', () => {
  it('builds Closing keys from data attrs', () => {
    expect(closingCellKeyFromInput({
      dataset: { clPid: 'p1', clField: 'cases' },
    })).toBe('p1::cases');
  });

  it('builds Distribution keys from parent cell', () => {
    const cell = { dataset: { bar: 'b1', pid: 'p1' } };
    const input = { closest: (sel) => (sel === '.dist-cell' ? cell : null) };
    expect(distributionCellKeyFromInput(input)).toBe('b1::p1');
  });

  it('builds Counts keys with primary/secondary side', () => {
    expect(countsCellKeyFromInput({
      dataset: { bar: 'b1', pid: 'p9' },
      classList: { contains: (c) => c === 'cnt-inp--secondary' },
    })).toBe('b1::p9::secondary');
    expect(countsCellKeyFromInput({
      dataset: { bar: 'b1', pid: 'p9' },
      classList: { contains: () => false },
    })).toBe('b1::p9::primary');
  });

  it('builds Recon keys from pid + column', () => {
    const colEl = { dataset: { rcnCol: 'invoiced' } };
    expect(reconCellKeyFromInput({
      dataset: { rcnPid: 'p1' },
      id: 'rcn-inv-p1',
      closest: (sel) => (sel === '[data-rcn-col]' ? colEl : null),
    })).toBe('p1::invoiced');
  });

  it('builds Products ordered keys', () => {
    expect(productsCellKeyFromInput({
      id: 'epOrd-abc',
      closest: () => null,
    })).toBe('abc::ordered');
  });

  it('builds Kit keys from row item id + field', () => {
    const row = { dataset: { itemId: 'i1', pid: 'p1' } };
    expect(kitCellKeyFromInput({
      dataset: { field: 'qty_packed' },
      closest: () => row,
    })).toBe('i1::qty_packed');
  });

  it('builds Sales keys with ingredient index', () => {
    const inputs = [{}, {}];
    const stack = {
      querySelectorAll: () => inputs,
    };
    const row = {
      dataset: { tillName: 'Lager', tillVar: 'Pint' },
      closest: () => null,
    };
    const input = {
      closest: (sel) => {
        if (sel === 'tr') return row;
        if (sel === '.mod-portion-cell') return stack;
        return null;
      },
    };
    // Make NodeList-ish indexOf work via Array.from
    Object.defineProperty(inputs, Symbol.iterator, {
      value: Array.prototype[Symbol.iterator],
    });
    expect(salesCellKeyFromInput(input)).toBe('till::Lager::Pint::0');
  });

  it('builds Reports price/markup keys', () => {
    expect(reportsCellKeyFromInput({
      classList: { contains: (c) => c === 'reports-markup-input' },
      dataset: { markupRecipient: 'r1' },
    })).toBe('markup::r1');
    expect(reportsCellKeyFromInput({
      classList: { contains: (c) => c === 'reports-price-input' },
      dataset: { priceKey: 'r1|p2' },
    })).toBe('price::r1|p2');
  });
});
