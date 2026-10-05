import { describe, expect, it } from 'vitest';
import { gridContextActions } from './grid-context-actions.js';

describe('grid context actions', () => {
  it('gives an orders cell paste, the purchase order, and Menu & GP', () => {
    const actions = gridContextActions({
      kind: 'orders',
      hasInput: true,
      hasName: true,
      canOpenOrder: true,
      onEvent: true,
    });
    expect(actions.cell.map((a) => a.id)).toEqual(['paste', 'copy', 'copy-name', 'copy-row', 'clear']);
    expect(actions.item.map((a) => a.label)).toEqual(['Open purchase order', 'Open on Menu & GP']);
  });

  it('offers add or remove for a distribution bar cell', () => {
    const off = gridContextActions({ kind: 'distribution', canAddBar: true, onEvent: true });
    expect(off.item.map((a) => a.id)).toEqual(['add-bar', 'goto-products']);
    const on = gridContextActions({ kind: 'distribution', canRemoveBar: true, hasInput: true });
    expect(on.item.map((a) => a.id)).toEqual(['remove-bar']);
    expect(on.cell.map((a) => a.id)).toContain('clear');
  });

  it('keeps closing actions to the buttons that are actually available', () => {
    const actions = gridContextActions({
      kind: 'closing',
      hasInput: true,
      hasName: true,
      canReturn: true,
      canSticker: false,
      canTransfer: true,
      onEvent: true,
    });
    expect(actions.item.map((a) => a.id)).toEqual(['return', 'transfer', 'goto-recon']);
  });

  it('copies a report cell without inventing an edit', () => {
    const actions = gridContextActions({ kind: 'reports', hasName: false });
    expect(actions.cell.map((a) => a.id)).toEqual(['copy', 'copy-row']);
    expect(actions.item).toEqual([]);
  });

  it('opens an event card and a delivery', () => {
    expect(gridContextActions({ kind: 'event', card: true, hasName: true }).item.map((a) => a.id)).toEqual(['open-card']);
    expect(gridContextActions({ kind: 'delivery', card: true, canEdit: true }).item.map((a) => a.label)).toEqual(['Edit delivery']);
  });

  it('matches list pages: a user, a bug, and a client invoice', () => {
    const user = gridContextActions({ kind: 'user', card: true, hasName: true, canActivate: true });
    expect(user.item.map((a) => a.label)).toEqual(['Edit user', 'Activate']);
    const bug = gridContextActions({ kind: 'bug', card: true, toggleLabel: 'Resolve' });
    expect(bug.item.map((a) => a.label)).toEqual(['Resolve', 'Edit report']);
    const invoice = gridContextActions({ kind: 'card', card: true, canInvoice: true });
    expect(invoice.item.map((a) => a.id)).toEqual(['invoice']);
    expect(invoice.cell.map((a) => a.label)).toEqual(['Copy', 'Copy details']);
  });
});
