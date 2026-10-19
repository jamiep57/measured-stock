import { describe, it, expect } from 'vitest';
import { expandLines } from './brand-pdf.js';

describe('expandLines', () => {
  it('splits multiline addresses and drops blanks', () => {
    expect(expandLines(['Sandbox', 'Worthy Farm,\nWorthy Lane,\n\nPilton', null, '  '])).toEqual([
      'Sandbox',
      'Worthy Farm,',
      'Worthy Lane,',
      'Pilton',
    ]);
  });
});
