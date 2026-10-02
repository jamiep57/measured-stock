import { describe, it, expect } from 'vitest';
import {
  parseAbv,
  inferPackLabel,
  matchCaseSize,
  matchCategory,
  findLwcSupplier,
  rankLwcHits,
  mapLwcHitToFields,
  normaliseLwcNode,
} from './lwc-catalog.js';

const CASE_SIZES = [
  { id: 'cs-24-330', label: '24×330ml' },
  { id: 'cs-24-500', label: '24×500ml Cans' },
  { id: 'cs-70', label: '70cl' },
  { id: 'cs-750', label: '750ml' },
  { id: 'cs-30k', label: '30L Keg' },
  { id: 'cs-50k', label: '50L Keg' },
  { id: 'cs-9', label: '9 Gal' },
];

const CATEGORIES = [
  { id: 'cat-wine', name: 'Wine', colour_key: 'wine' },
  { id: 'cat-beer', name: 'Beer', colour_key: 'beer' },
  { id: 'cat-spirits', name: 'Spirits', colour_key: 'spirits' },
  { id: 'cat-softs', name: 'Soft Drinks', colour_key: 'softs' },
];

describe('parseAbv', () => {
  it('parses percent strings', () => {
    expect(parseAbv('11%')).toBe(11);
    expect(parseAbv('4.2%')).toBe(4.2);
    expect(parseAbv('40')).toBe(40);
    expect(parseAbv('')).toBeNull();
  });
});

describe('inferPackLabel', () => {
  it('maps wine 75cl bottles to 750ml', () => {
    expect(inferPackLabel({
      name: 'Mount Holdsworth Sauvignon Blanc 75cl NRB',
      unitSize: '75cl',
      container: 'Glass Bottle',
    })).toBe('750ml');
  });

  it('maps spirit 70cl bottles', () => {
    expect(inferPackLabel({
      name: 'Agnes Arber Rhubarb Gin 70cl NRB',
      unitSize: '70cl',
      container: 'Glass Bottle',
    })).toBe('70cl');
  });

  it('maps kegs from unit size', () => {
    expect(inferPackLabel({
      name: 'Galway Irish Stout 30L Keg',
      unitSize: '30ltr',
      container: 'Keg',
    })).toBe('30L Keg');
    expect(inferPackLabel({
      name: "Brinkhoff's No. 1 50L Keg",
      unitSize: '50ltr',
      container: 'Keg',
    })).toBe('50L Keg');
  });

  it('reads multipacks from the product name', () => {
    expect(inferPackLabel({
      name: 'Mountain Dew Citrus Blast 24 x 500ml PET',
      unitSize: '500ml',
    })).toBe('24×500ml');
    expect(inferPackLabel({
      name: 'Marlish Sparkling Raspberry Water 24 x 330ml Can',
      unitSize: '330ml',
    })).toBe('24×330ml');
  });

  it('maps 9 gallon casks', () => {
    expect(inferPackLabel({
      name: 'Ossett Blonde Ale 9G Cask',
      unitSize: '9gal',
      container: 'Cask',
    })).toBe('9 Gal');
  });
});

describe('matchCaseSize', () => {
  it('matches exact and alias labels', () => {
    expect(matchCaseSize('750ml', CASE_SIZES)?.id).toBe('cs-750');
    expect(matchCaseSize('75cl', CASE_SIZES)?.id).toBe('cs-750');
    expect(matchCaseSize('70cl', CASE_SIZES)?.id).toBe('cs-70');
    expect(matchCaseSize('30L Keg', CASE_SIZES)?.id).toBe('cs-30k');
    expect(matchCaseSize('24×330ml', CASE_SIZES)?.id).toBe('cs-24-330');
    expect(matchCaseSize('24×500ml', CASE_SIZES)?.id).toBe('cs-24-500');
  });
});

describe('matchCategory', () => {
  it('maps LWC wine / beer / spirits into local categories', () => {
    expect(matchCategory({
      productCategory: 'White Wine',
      categoryPath: '/wine/white-wine/sauvignon-blanc',
      productType: 'Sauvignon Blanc',
      name: 'Mount Holdsworth Sauvignon Blanc 75cl NRB',
    }, CATEGORIES)?.id).toBe('cat-wine');

    expect(matchCategory({
      productCategory: 'Stout & Porter',
      categoryPath: '/beer/stout-porter/stout',
      productType: 'Stout',
      name: 'Galway Irish Stout 30L Keg',
    }, CATEGORIES)?.id).toBe('cat-beer');

    expect(matchCategory({
      productCategory: 'Gin',
      categoryPath: '/spirits/gin',
      productType: 'Gin',
      name: 'Agnes Arber Rhubarb Gin 70cl NRB',
    }, CATEGORIES)?.id).toBe('cat-spirits');
  });
});

describe('findLwcSupplier', () => {
  it('prefers an LWC-named supplier', () => {
    expect(findLwcSupplier([
      { id: 'b', name: 'Booker' },
      { id: 'l', name: 'LWC' },
    ])?.id).toBe('l');
    expect(findLwcSupplier([{ id: 'm', name: 'LWC/MC' }])?.id).toBe('m');
  });
});

describe('rankLwcHits', () => {
  it('ranks Mount Holdsworth above other Mount* products', () => {
    const ranked = rankLwcHits([
      { name: 'Mount Gay Eclipse Barbados Golden Rum 70cl NRB', brand: 'Mount Gay' },
      { name: 'Mount Holdsworth Sauvignon Blanc 75cl NRB', brand: 'Mount Holdsworth' },
      { name: 'Mountain Dew Citrus Blast 24 x 500ml PET', brand: 'Mountain Dew' },
    ], 'Mount Holdsworth');
    expect(ranked[0].name).toMatch(/Mount Holdsworth/);
  });
});

describe('normaliseLwcNode + mapLwcHitToFields', () => {
  it('fills name, sku, abv, pack, category and LWC supplier', () => {
    const hit = normaliseLwcNode({
      entityId: 15980,
      name: 'Mount Holdsworth Sauvignon Blanc 75cl NRB',
      sku: '46898013',
      path: '/mount-holdsworth-sauvignon-blanc-75cl-nrb/',
      brand: { name: 'Mount Holdsworth' },
      categories: {
        edges: [{ node: { name: 'Sauvignon Blanc', path: '/wine/white-wine/sauvignon-blanc' } }],
      },
      customFields: {
        edges: [
          { node: { name: 'Product Category', value: 'White Wine' } },
          { node: { name: 'Unit Size', value: '75cl' } },
          { node: { name: 'Alcohol By Volume', value: '11%' } },
          { node: { name: 'Container', value: 'Glass Bottle' } },
        ],
      },
    });
    expect(hit.url).toBe('https://catalog.lwc.co.uk/mount-holdsworth-sauvignon-blanc-75cl-nrb/');
    const mapped = mapLwcHitToFields(hit, {
      categories: CATEGORIES,
      caseSizes: CASE_SIZES,
      suppliers: [{ id: 'lwc', name: 'LWC' }],
    });
    expect(mapped).toMatchObject({
      name: 'Mount Holdsworth Sauvignon Blanc 75cl NRB',
      sku: '46898013',
      abv: 11,
      categoryId: 'cat-wine',
      caseSizeId: 'cs-750',
      supplierId: 'lwc',
    });
  });
});
