import { describe, expect, it } from 'vitest';
import {
  buildMergeFieldsPayload,
  defaultMergeFieldSources,
  findDuplicateProductIds,
  mergeFieldValue,
  mergeOffersPreview,
  mergeProductScore,
  pickDefaultKeeper,
  productNameKey,
  productSkuKey,
  MERGE_FIELD_DEFS,
} from './product-merge.js';

describe('productNameKey / productSkuKey', () => {
  it('normalises names for duplicate detection', () => {
    expect(productNameKey({ name: 'Brothers Apple – 4.4%' })).toBe('brothers apple 4 4');
    expect(productNameKey({ name: '  brothers   apple 4.4  ' })).toBe('brothers apple 4 4');
  });

  it('normalises SKUs', () => {
    expect(productSkuKey({ sku: '  ABC-12  ' })).toBe('abc-12');
    expect(productSkuKey({ sku: null })).toBe('');
    expect(productSkuKey({ sku: '   ' })).toBe('');
  });
});

describe('findDuplicateProductIds', () => {
  it('selects products that share a normalised name', () => {
    const products = [
      { id: 'a', name: 'Sprite 330ml' },
      { id: 'b', name: 'sprite 330ml' },
      { id: 'c', name: 'Coke' },
    ];
    expect(findDuplicateProductIds(products).sort()).toEqual(['a', 'b']);
  });

  it('selects products that share a non-empty SKU', () => {
    const products = [
      { id: 'a', name: 'One', sku: 'SKU1' },
      { id: 'b', name: 'Two', sku: 'sku1' },
      { id: 'c', name: 'Three', sku: 'OTHER' },
      { id: 'd', name: 'Empty', sku: '' },
      { id: 'e', name: 'Also empty', sku: null },
    ];
    expect(findDuplicateProductIds(products).sort()).toEqual(['a', 'b']);
  });

  it('returns empty when nothing overlaps', () => {
    expect(findDuplicateProductIds([
      { id: 'a', name: 'A', sku: '1' },
      { id: 'b', name: 'B', sku: '2' },
    ])).toEqual([]);
  });
});

describe('merge field defaults & payload', () => {
  const chosen = [
    {
      id: 'sparse',
      name: 'Sprite',
      created_at: '2024-01-02',
      sku: null,
      case_size: '',
      units_per_case: null,
      category_id: null,
    },
    {
      id: 'rich',
      name: 'Sprite 330',
      created_at: '2024-01-01',
      sku: 'SP330',
      case_size: '24×330ml',
      units_per_case: 24,
      category_id: 'cat1',
      category: { id: 'cat1', name: 'Softs' },
      case_price: 12,
      supplier_id: 's1',
    },
  ];

  it('scores richer products higher', () => {
    expect(mergeProductScore(chosen[1])).toBeGreaterThan(mergeProductScore(chosen[0]));
  });

  it('picks the richest product as default keeper', () => {
    expect(pickDefaultKeeper(chosen)[0].id).toBe('rich');
  });

  it('defaults field sources to filled values on the richest product', () => {
    const sources = defaultMergeFieldSources(chosen);
    expect(sources.name).toBe('rich');
    expect(sources.sku).toBe('rich');
    expect(sources.case_size).toBe('rich');
  });

  it('builds a fields payload from chosen sources', () => {
    const payload = buildMergeFieldsPayload(chosen, {
      name: 'sparse',
      sku: 'rich',
      case_size: 'rich',
      units_per_case: 'rich',
      category_id: 'rich',
      abv: 'sparse',
    });
    expect(payload.name).toBe('Sprite');
    expect(payload.sku).toBe('SP330');
    expect(payload.case_size).toBe('24×330ml');
    expect(payload.units_per_case).toBe(24);
    expect(payload.category_id).toBe('cat1');
    expect(payload.abv).toBe(null);
  });

  it('reads category from nested category.id when category_id missing', () => {
    const def = MERGE_FIELD_DEFS.find((d) => d.key === 'category_id');
    expect(mergeFieldValue({ category: { id: 'c9', name: 'Beer' } }, def)).toBe('c9');
  });
});

describe('mergeOffersPreview', () => {
  it('unions supplier offers across products and keeps preferred', () => {
    const offers = mergeOffersPreview([
      {
        id: 'a',
        case_size: '24',
        product_suppliers: [
          { supplier_id: 's1', sku: 'A', pack_size: '24', case_price: 10, is_preferred: true, supplier: { name: 'Booker' } },
        ],
      },
      {
        id: 'b',
        case_size: '12',
        product_suppliers: [
          { supplier_id: 's1', sku: 'A', pack_size: '24', case_price: null, is_preferred: false, supplier: { name: 'Booker' } },
          { supplier_id: 's2', sku: 'B', pack_size: '12', case_price: 8, is_preferred: true, supplier: { name: 'Bidfood' } },
        ],
      },
    ]);
    expect(offers).toHaveLength(2);
    expect(offers[0].is_preferred).toBe(true);
    expect(offers.find((o) => o.supplier_name === 'Booker')?.case_price).toBe(10);
  });
});
