import { describe, expect, it } from 'vitest';
import {
  editablePlanningField,
  placeContextMenu,
  planningColumnLabel,
  planningContextActions,
} from './planning-context-menu.js';

describe('planning context actions', () => {
  it('offers colour-adjacent edits and a cocktail conversion for a product', () => {
    const actions = planningContextActions({
      kind: 'product',
      included: true,
      colId: 'menu',
      locked: false,
      hasRequired: true,
    });
    expect(actions.cell.map((a) => a.id)).toEqual(['use-required', 'paste', 'copy', 'copy-name', 'clear']);
    expect(actions.item.map((a) => a.id)).toEqual(['make-cocktail', 'make-spirit-mixer', 'toggle-menu']);
    expect(actions.item[1].label).toBe('Make into spirit & mixer');
    expect(actions.item[2].label).toBe('Remove from menu');
  });

  it('hides edits when pricing is locked and still allows copy', () => {
    const actions = planningContextActions({
      kind: 'product',
      included: true,
      colId: 'gp',
      locked: true,
      hasRequired: true,
    });
    expect(actions.cell.map((a) => a.id)).toEqual(['copy', 'copy-name']);
    expect(actions.item).toEqual([]);
  });

  it('edits a cocktail instead of converting it', () => {
    const actions = planningContextActions({
      kind: 'cocktail',
      included: false,
      colId: 'cost',
      locked: false,
      hasRequired: false,
    });
    expect(actions.cell.map((a) => a.id)).toEqual(['copy', 'copy-name']);
    expect(actions.item.map((a) => a.id)).toEqual(['edit-cocktail', 'toggle-menu', 'delete-cocktail']);
    expect(actions.item[0].label).toBe('Edit cocktail');
    expect(actions.item[1].label).toBe('Put back on menu');
    expect(actions.item[2].label).toBe('Delete cocktail');
  });

  it('names a spirit and mixer as its own drink', () => {
    const actions = planningContextActions({
      kind: 'cocktail',
      drinkKind: 'spirit_mixer',
      included: true,
      colId: 'menu',
      locked: false,
      hasRequired: false,
    });
    expect(actions.item[0].label).toBe('Edit spirit & mixer');
    expect(actions.item.find((a) => a.id === 'delete-cocktail').label).toBe('Delete spirit & mixer');
    expect(editablePlanningField('cocktail', 'deal')).toBeNull();
    expect(editablePlanningField('product', 'scenario:abc')).toBe('scenario');
    expect(planningColumnLabel('menu')).toBe('Menu £');
  });
});

describe('placeContextMenu', () => {
  it('flips above and left when the menu would leave the viewport', () => {
    const pos = placeContextMenu(
      { width: 100, height: 80 },
      { x: 290, y: 250 },
      { width: 320, height: 280 },
    );
    expect(pos.left).toBe(190);
    expect(pos.top).toBe(170);
  });
});
