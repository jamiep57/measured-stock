import { describe, expect, it } from 'vitest';
import {
  PLANNING_COLUMN_ORDER_KEY,
  defaultPlanningColumnOrder,
  movePlanningColumn,
  readPlanningColumnOrder,
  reconcilePlanningColumnOrder,
  writePlanningColumnOrder,
} from './planning-columns.js';

const defaults = defaultPlanningColumnOrder(['a', 'b']);

describe('defaultPlanningColumnOrder', () => {
  it('puts scenarios between GP and projected serves', () => {
    expect(defaults).toEqual([
      'size', 'serve', 'cost', 'menu', 'target', 'required', 'suggested', 'gp',
      'scenario:a', 'scenario:b',
      'serves', 'revenue', 'gp-amount', 'deal', 'deal-ref',
    ]);
  });
});

describe('reconcilePlanningColumnOrder', () => {
  it('uses the default when nothing is saved', () => {
    expect(reconcilePlanningColumnOrder(null, ['a'])).toEqual(defaultPlanningColumnOrder(['a']));
    expect(reconcilePlanningColumnOrder([], ['a'])).toEqual(defaultPlanningColumnOrder(['a']));
  });

  it('keeps a saved order and drops unknown ids', () => {
    const saved = ['gp', 'menu', 'nope', 'gp', 'deal-ref'];
    const order = reconcilePlanningColumnOrder(saved, []);
    expect(order[0]).toBe('gp');
    expect(order.indexOf('gp')).toBeLessThan(order.indexOf('menu'));
    expect(order.indexOf('menu')).toBeLessThan(order.indexOf('deal-ref'));
    expect(order).not.toContain('nope');
    expect(order.filter((id) => id === 'gp')).toHaveLength(1);
  });

  it('preserves a complete custom order', () => {
    const custom = [...defaults].reverse();
    expect(reconcilePlanningColumnOrder(custom, ['a', 'b'])).toEqual(custom);
  });

  it('slots a missing column after the one it normally follows', () => {
    const saved = ['gp', ...defaults.filter((id) => id !== 'gp' && id !== 'cost')];
    const order = reconcilePlanningColumnOrder(saved, ['a', 'b']);
    expect(order.indexOf('cost')).toBe(order.indexOf('serve') + 1);
  });

  it('inserts a new scenario after the last scenario column', () => {
    const saved = ['menu', 'scenario:a', 'gp'];
    const order = reconcilePlanningColumnOrder(saved, ['a', 'b']);
    const a = order.indexOf('scenario:a');
    expect(order[a + 1]).toBe('scenario:b');
  });

  it('puts the first scenario in its default slot', () => {
    const order = reconcilePlanningColumnOrder(['menu', 'gp', 'serves'], ['a']);
    expect(order.indexOf('scenario:a')).toBe(order.indexOf('serves') - 1);
  });

  it('drops a deleted scenario', () => {
    const order = reconcilePlanningColumnOrder(['menu', 'scenario:gone', 'gp'], []);
    expect(order).not.toContain('scenario:gone');
  });
});

describe('movePlanningColumn', () => {
  it('moves a column before or after another', () => {
    expect(movePlanningColumn(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(movePlanningColumn(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('leaves the order alone for a no-op or an unknown column', () => {
    expect(movePlanningColumn(['a', 'b'], 'a', 'a', 'before')).toEqual(['a', 'b']);
    expect(movePlanningColumn(['a', 'b'], 'a', 'missing', 'after')).toEqual(['a', 'b']);
  });
});

describe('column order storage', () => {
  it('round-trips a saved order', () => {
    const bag = new Map();
    const storage = {
      getItem: (key) => bag.get(key) ?? null,
      setItem: (key, value) => bag.set(key, value),
    };
    writePlanningColumnOrder(storage, ['gp', 'menu']);
    expect(bag.get(PLANNING_COLUMN_ORDER_KEY)).toBe('["gp","menu"]');
    expect(readPlanningColumnOrder(storage)).toEqual(['gp', 'menu']);
    expect(readPlanningColumnOrder(null)).toBeNull();
    expect(readPlanningColumnOrder({ getItem: () => '{' })).toBeNull();
  });
});
