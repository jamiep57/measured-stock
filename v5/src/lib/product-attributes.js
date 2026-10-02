/**
 * Product master attributes added in migration 067. Option lists must match
 * the CHECK constraints on public.products.
 */

export const KEG_COUPLER_TYPES = [
  { value: 'S', label: 'S-type (European Sankey)' },
  { value: 'A', label: 'A-type (flat / German slider)' },
  { value: 'G', label: 'G-type (Grundy / UK)' },
  { value: 'D', label: 'D-type (US Sankey)' },
  { value: 'U', label: 'U-type (Guinness)' },
  { value: 'M', label: 'M-type (Schneider)' },
  { value: 'KeyKeg', label: 'KeyKeg' },
  { value: 'Sankey', label: 'Sankey (generic)' },
  { value: 'none', label: 'Not applicable' },
];

export const DISPENSE_GAS_TYPES = [
  { value: 'CO2', label: 'CO₂' },
  { value: 'Mixed 60/40', label: 'Mixed gas 60/40' },
  { value: 'Mixed 70/30', label: 'Mixed gas 70/30' },
  { value: 'Mixed 50/50', label: 'Mixed gas 50/50' },
  { value: 'Nitrogen', label: 'Nitrogen' },
  { value: 'Beer gas', label: 'Beer gas (unspecified blend)' },
  { value: 'none', label: 'Not applicable' },
];

/** Customer-facing name used on menus and client exports. */
export function menuNameOf(product) {
  const menu = String(product?.menu_name || '').trim();
  return menu || String(product?.name || '').trim();
}

/**
 * Cases per pallet: product override, else stock case size default.
 * @param {object} product
 * @param {object[]} [caseSizes]
 */
export function palletQtyOf(product, caseSizes = []) {
  const own = Number(product?.pallet_qty);
  if (Number.isFinite(own) && own > 0) return own;
  const csId = product?.stock_case_size_id || product?.case_size_id;
  const cs = csId ? caseSizes.find((c) => c.id === csId) : null;
  const fromCs = Number(cs?.cases_per_pallet);
  return Number.isFinite(fromCs) && fromCs > 0 ? fromCs : null;
}

/**
 * Validate + normalise attribute inputs for a products patch.
 * @param {{ menu_name?: string, pallet_qty?: string|number|null, keg_coupler_type?: string, dispense_gas_type?: string }} input
 * @returns {{ patch: object, error: string|null }}
 */
export function normaliseProductAttributes(input) {
  const menu = String(input?.menu_name ?? '').trim();
  if (menu.length > 120) return { patch: {}, error: 'Menu name must be 120 characters or fewer.' };

  let pallet = null;
  const rawPallet = input?.pallet_qty;
  if (rawPallet !== '' && rawPallet != null) {
    pallet = Number(rawPallet);
    if (!Number.isFinite(pallet) || pallet <= 0) {
      return { patch: {}, error: 'Pallet quantity must be a positive number.' };
    }
  }

  const coupler = String(input?.keg_coupler_type || '').trim() || null;
  if (coupler && !KEG_COUPLER_TYPES.some((o) => o.value === coupler)) {
    return { patch: {}, error: 'Unknown keg coupler type.' };
  }
  const gas = String(input?.dispense_gas_type || '').trim() || null;
  if (gas && !DISPENSE_GAS_TYPES.some((o) => o.value === gas)) {
    return { patch: {}, error: 'Unknown dispense gas type.' };
  }

  return {
    patch: {
      menu_name: menu || null,
      pallet_qty: pallet,
      keg_coupler_type: coupler,
      dispense_gas_type: gas,
    },
    error: null,
  };
}
