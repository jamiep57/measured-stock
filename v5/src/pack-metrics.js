/**
 * Pack metrics — single source for units, labels, and totals context.
 * Reads case_sizes rows; falls back to legacy product fields when FK null.
 */

const DEFAULT_PACK = {
  stockUnit: 'case',
  unitsPerCase: 1,
  servingsPerUnit: 1,
  casesPerPallet: null,
  layersPerPallet: null,
  label: '',
};

function normLabel(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\s+/g, '');
}

function categoryKey(product) {
  const cat = product?.category;
  if (!cat) return '';
  return cat.colour_key || String(cat.name || '').toLowerCase();
}

function isSpirits(product) {
  return categoryKey(product) === 'spirits';
}

function isWine(product) {
  return categoryKey(product) === 'wine';
}

function isBottleStock(pack) {
  return pack?.stockUnit === 'bottle';
}

/**
 * @param {object|null} row — case_sizes row
 * @returns {object} pack metrics
 */
export function packMetrics(row) {
  if (!row) return { ...DEFAULT_PACK };
  return {
    id: row.id,
    label: row.label || '',
    stockUnit: row.stock_unit || 'case',
    unitsPerCase: Number(row.units_per_case) > 0 ? Number(row.units_per_case) : 1,
    servingsPerUnit: row.servings_per_unit != null ? Number(row.servings_per_unit) : 1,
    casesPerPallet: row.cases_per_pallet != null ? Number(row.cases_per_pallet) : null,
    layersPerPallet: row.layers_per_pallet != null ? Number(row.layers_per_pallet) : null,
  };
}

/**
 * Resolve case_sizes row for a product (stock pack).
 * @param {object} product
 * @param {object[]} caseSizes — full catalogue
 */
export function resolveStockCaseSize(product, caseSizes = []) {
  if (!product) return null;
  const id = product.stock_case_size_id || product.case_size_id;
  if (id) {
    const hit = caseSizes.find((c) => c.id === id);
    if (hit) return hit;
  }
  const label = product.case_size;
  if (label) {
    const n = normLabel(label);
    return caseSizes.find((c) => normLabel(c.label) === n) || null;
  }
  return null;
}

export function productStockPack(product, caseSizes = []) {
  const row = resolveStockCaseSize(product, caseSizes);
  if (row) return packMetrics(row);
  // Legacy fallback when case_sizes catalogue miss / not loaded.
  if (!product) return { ...DEFAULT_PACK };
  const upc = Number(product.units_per_case);
  return {
    ...DEFAULT_PACK,
    label: product.case_size || '',
    stockUnit: product.stock_unit || DEFAULT_PACK.stockUnit,
    unitsPerCase: upc > 0 ? upc : 1,
    servingsPerUnit: 1,
  };
}

function bottlesPartialMode(pack) {
  return {
    mode: 'bottles-partial',
    pack,
    columnLabels: { primary: 'Bottles', secondary: 'Partial' },
    secondaryStep: '0.1',
  };
}

/**
 * Delivery entry mode for a product.
 * Bottle stock (spirits/wine): bottles + decimal partial.
 * Packaged beer/softs: cases + loose singles (cans).
 */
export function entryMode(product, caseSizes = []) {
  const pack = productStockPack(product, caseSizes);
  if ((isSpirits(product) || isWine(product)) && isBottleStock(pack)) {
    return bottlesPartialMode(pack);
  }
  if (pack.stockUnit === 'keg') {
    return {
      mode: 'kegs-partial',
      pack,
      columnLabels: { primary: 'Kegs', secondary: 'Partial' },
      secondaryStep: '0.1',
    };
  }
  return {
    mode: 'cases-singles',
    pack,
    columnLabels: { primary: 'Cases', secondary: 'Singles' },
    secondaryStep: '1',
  };
}

/** Count entry: bottles + partial, cases + singles, or kegs + partial. */
export function countEntryMode(product, caseSizes = []) {
  const pack = productStockPack(product, caseSizes);
  if ((isSpirits(product) || isWine(product)) && isBottleStock(pack)) {
    return bottlesPartialMode(pack);
  }
  if (pack.stockUnit === 'keg') {
    return {
      mode: 'kegs-partial',
      pack,
      columnLabels: { primary: 'Kegs', secondary: 'Partial' },
      secondaryStep: '0.1',
    };
  }
  return {
    mode: 'cases-singles',
    pack,
    columnLabels: { primary: 'Cases', secondary: 'Singles' },
    secondaryStep: '1',
  };
}

export function findOfferForSupplier(product, supplierId) {
  const offers = product?.product_suppliers || [];
  if (!supplierId) {
    return offers.find((o) => o.is_preferred) || offers[0] || null;
  }
  return offers.find((o) => o.supplier_id === supplierId) || offers.find((o) => o.is_preferred) || offers[0] || null;
}

export function resolvePurchaseCaseSize(product, supplierId, caseSizes = []) {
  const offer = findOfferForSupplier(product, supplierId);
  if (offer?.purchase_case_size_id) {
    const hit = caseSizes.find((c) => c.id === offer.purchase_case_size_id);
    if (hit) return hit;
  }
  const packText = offer?.pack_size || product?.case_size;
  if (packText) {
    const n = normLabel(packText);
    return caseSizes.find((c) => normLabel(c.label) === n) || null;
  }
  return resolveStockCaseSize(product, caseSizes);
}

export function offerPurchasePack(product, supplierId, caseSizes = []) {
  return packMetrics(resolvePurchaseCaseSize(product, supplierId, caseSizes));
}

/** Cost per stock unit (bottle or case) from supplier offer. */
export function unitCostFromOffer(product, supplierId) {
  const offer = findOfferForSupplier(product, supplierId);
  if (!offer) return null;
  if (offer.unit_price != null) return Number(offer.unit_price);
  if (offer.case_price != null) {
    const purchase = offerPurchasePack(product, supplierId, []);
    const bpc = purchase.unitsPerCase || 1;
    return Number(offer.case_price) / bpc;
  }
  return null;
}
