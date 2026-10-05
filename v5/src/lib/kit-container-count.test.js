import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseContentsQty,
  bumpContentsLine,
  setContentsQty,
  removeContentsLine,
  filterKitProducts,
  resolveContainerScan,
  resolveItemScan,
  kitItemCreatePayload,
  kitCategoryCreatePayload,
  loadRecentContainerIds,
  pushRecentContainerId,
  contentsToSaveLines,
} from './kit-container-count.js';

describe('kit-container-count', () => {
  const mem = new Map();
  beforeEach(() => {
    mem.clear();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: (k) => { mem.delete(k); },
      clear: () => { mem.clear(); },
    };
  });

  it('parses quantities safely', () => {
    expect(parseContentsQty('')).toBe(1);
    expect(parseContentsQty('2.5')).toBe(2.5);
    expect(parseContentsQty('0')).toBe(1);
    expect(parseContentsQty('-3')).toBe(1);
  });

  it('bumps, sets, and removes content lines', () => {
    let lines = [];
    lines = bumpContentsLine(lines, 'a', 1, { id: 'a', name: 'A' });
    expect(lines).toEqual([{ child_product_id: 'a', qty: 1, child: { id: 'a', name: 'A' } }]);
    lines = bumpContentsLine(lines, 'a', 2);
    expect(lines[0].qty).toBe(3);
    lines = bumpContentsLine(lines, 'a', -10);
    expect(lines).toEqual([]);
    lines = setContentsQty([], 'b', 4, { id: 'b', name: 'B' });
    expect(lines[0].qty).toBe(4);
    lines = removeContentsLine(lines, 'b');
    expect(lines).toEqual([]);
  });

  it('filters kit products by query and excludes ids', () => {
    const products = [
      { id: '1', name: 'Truss pin', sku: '10', barcode: 'X', category: { name: 'Structures' } },
      { id: '2', name: 'Cable drum', archived: false },
      { id: '3', name: 'Old pin', archived: true },
    ];
    expect(filterKitProducts(products, 'pin').map((p) => p.id)).toEqual(['1']);
    expect(filterKitProducts(products, 'structures').map((p) => p.id)).toEqual(['1']);
    expect(filterKitProducts(products, '', { excludeIds: ['1'] }).map((p) => p.id)).toEqual(['2']);
  });

  it('routes container and item scans', () => {
    const products = [
      { id: 'c1', name: 'Box', is_container: true, barcode: 'BOX' },
      { id: 'i1', name: 'Pin', is_container: false, barcode: 'PIN' },
    ];
    const find = (list, code) => list.find((p) => p.barcode === code) || null;
    expect(resolveContainerScan(products, 'BOX', find).kind).toBe('container');
    expect(resolveContainerScan(products, 'PIN', find).kind).toBe('item');
    expect(resolveContainerScan(products, 'NOPE', find).kind).toBe('unknown');
    expect(resolveItemScan(products, 'PIN', 'c1', find).kind).toBe('match');
    expect(resolveItemScan(products, 'BOX', 'c1', find).kind).toBe('self');
    expect(resolveItemScan(products, 'NOPE', 'c1', find).kind).toBe('unknown');
  });

  it('builds create payloads', () => {
    expect(kitItemCreatePayload({ name: '  Pin  ', categoryId: 'cat', barcode: ' B ', isContainer: true }))
      .toMatchObject({
        name: 'Pin',
        category_id: 'cat',
        barcode: 'B',
        is_container: true,
        product_kind: 'kit',
      });
    expect(kitCategoryCreatePayload(' Power ', 3)).toEqual({
      name: 'Power',
      kind: 'kit',
      colour_key: 'rtd',
      sort_order: 3,
    });
  });

  it('tracks recent containers and save lines', () => {
    expect(loadRecentContainerIds()).toEqual([]);
    pushRecentContainerId('a');
    pushRecentContainerId('b');
    pushRecentContainerId('a');
    expect(loadRecentContainerIds()).toEqual(['a', 'b']);
    expect(contentsToSaveLines([{ child_product_id: 'x', qty: 2 }]))
      .toEqual([{ child_product_id: 'x', qty: 2 }]);
  });
});
