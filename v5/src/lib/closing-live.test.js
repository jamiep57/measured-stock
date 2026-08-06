import { describe, it, expect } from 'vitest';
import {
  mergeClosingRemoteRow,
  shouldApplyRemoteClosingEdit,
  formatClosingPresence,
  cellFocusOwners,
  cellFocusKey,
  peerColor,
} from './closing-live.js';
import { normalizeDisplayName } from './session-identity.js';

describe('normalizeDisplayName', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeDisplayName('  Charlie   Webb ')).toBe('Charlie Webb');
  });

  it('rejects empty / overlong names', () => {
    expect(normalizeDisplayName('')).toBeNull();
    expect(normalizeDisplayName('   ')).toBeNull();
    expect(normalizeDisplayName('x'.repeat(41))).toBeNull();
  });
});

describe('mergeClosingRemoteRow', () => {
  it('updates an existing product row', () => {
    const { rows, created } = mergeClosingRemoteRow(
      [{ product_id: 'p1', closing_cases: 1 }],
      { product_id: 'p1', closing_cases: 4, return_amount: 1 },
    );
    expect(created).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].closing_cases).toBe(4);
    expect(rows[0].return_amount).toBe(1);
  });
});

describe('shouldApplyRemoteClosingEdit', () => {
  it('skips dirty, focused, and local-echo rows', () => {
    expect(shouldApplyRemoteClosingEdit({
      productId: 'p1',
      dirtyPids: { p1: true },
    }).reason).toBe('dirty');

    expect(shouldApplyRemoteClosingEdit({
      productId: 'p1',
      dirtyPids: {},
      focusedPid: 'p1',
    }).reason).toBe('focused');

    expect(shouldApplyRemoteClosingEdit({
      productId: 'p1',
      dirtyPids: new Set(),
      recentLocalWrites: new Map([['p1', 1_000]]),
      now: 2_000,
      localEchoMs: 3000,
    }).reason).toBe('local-echo');
  });
});

describe('cellFocusOwners', () => {
  it('maps peer focus to product+field cells with colors', () => {
    const map = cellFocusOwners([
      { clientId: 'me', name: 'Me', focusPid: 'p1', focusField: 'cases' },
      { clientId: 'a', name: 'Alice', focusPid: 'p1', focusField: 'cases' },
      { clientId: 'b', name: 'Bob', focusPid: 'p2', focusField: 'return-cases' },
    ], 'me');
    expect(cellFocusKey('p1', 'cases')).toBe('p1::cases');
    expect(map['p1::cases'].name).toBe('Alice');
    expect(map['p1::cases'].color).toBe(peerColor('a'));
    expect(map['p2::return-cases'].name).toBe('Bob');
  });
});

describe('formatClosingPresence', () => {
  it('lists other people', () => {
    expect(formatClosingPresence([
      { clientId: 'me', name: 'Me' },
      { clientId: 'a', name: 'Alice' },
      { clientId: 'b', name: 'Bob' },
    ], 'me').text).toBe('Alice and Bob are also here');
  });
});
