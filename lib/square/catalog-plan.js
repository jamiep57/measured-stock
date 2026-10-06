/**
 * Pure planning for the Square menu push: what each linked location should sell,
 * compared with the current Square catalogue. No network.
 *
 * Item = stock product (or cocktail name); variation = serve size. Presence is only
 * changed at locations linked to this event; every other location keeps what it had.
 */

import { squareItemNames } from './names.js';

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function variationName(label) {
  return String(label ?? '').trim() || 'Regular';
}

function toMinor(price) {
  const n = Number(price);
  if (price == null || price === '' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * @param {{
 *   menuItems: Array<{ product_id: string, included?: boolean, serve_label?: string|null, menu_price?: number|null }>,
 *   products: Array<{ id: string, name: string, menu_name?: string|null, category_id?: string|null }>,
 *   categories?: Array<{ id: string, name: string }>,
 *   cocktails?: Array<{ id: string, name: string, included?: boolean, serve_label?: string|null, menu_price?: number|null, square_item_name?: string|null, square_variation?: string|null }>,
 *   ingredients?: Array<{ cocktail_id: string, product_id: string|null }>,
 *   distribution?: Array<{ bar_id: string, product_id: string, qty_allocated?: number }>,
 *   barProducts?: Array<{ bar_id: string, product_id: string }>,
 *   barLinks: Array<{ bar_id: string, square_location_id: string }>,
 * }} input
 */
export function buildDesiredCatalog(input) {
  const warnings = [];
  const productById = new Map((input.products || []).map((p) => [p.id, p]));
  const categoryById = new Map((input.categories || []).map((c) => [c.id, c]));
  const locationByBar = new Map((input.barLinks || []).map((l) => [l.bar_id, l.square_location_id]));

  const locationsByProduct = new Map();
  const addPresence = (productId, barId) => {
    const loc = locationByBar.get(barId);
    if (!loc || !productId) return;
    if (!locationsByProduct.has(productId)) locationsByProduct.set(productId, new Set());
    locationsByProduct.get(productId).add(loc);
  };
  for (const row of input.distribution || []) {
    if (Number(row.qty_allocated) > 0) addPresence(row.product_id, row.bar_id);
  }
  for (const row of input.barProducts || []) addPresence(row.product_id, row.bar_id);

  const items = new Map();
  const ensureItem = (key, name, category) => {
    if (!items.has(key)) items.set(key, { key, name, category, locations: new Set(), variations: [] });
    return items.get(key);
  };
  const addVariation = (item, label, price, source) => {
    const name = variationName(label);
    const vkey = `${item.key}|${norm(name)}`;
    if (item.variations.some((v) => v.key === vkey)) {
      warnings.push(`${item.name} has two "${name}" serves; only the first is pushed.`);
      return;
    }
    const priceMinor = toMinor(price);
    if (priceMinor == null) {
      warnings.push(`${source} has no menu price and is skipped.`);
      return;
    }
    item.variations.push({ key: vkey, name, priceMinor });
  };

  const menuProducts = (input.menuItems || [])
    .filter((row) => row.included !== false)
    .map((row) => productById.get(row.product_id))
    .filter(Boolean);
  const { names: itemNames, clashes } = squareItemNames(menuProducts);
  if (clashes.length) {
    warnings.push(`Some products share a name, so each one gets its format in brackets on the till (for example "(Can)" or "(Draught)"): ${clashes.join(', ')}. Set a menu name in the library to choose the wording.`);
  }

  for (const row of input.menuItems || []) {
    if (row.included === false) continue;
    const product = productById.get(row.product_id);
    if (!product) continue;
    const name = itemNames.get(product.id) || product.name;
    const cat = categoryById.get(product.category_id);
    const item = ensureItem(
      `product:${product.id}`,
      name,
      cat ? { key: `category:${norm(cat.name)}`, name: cat.name } : null,
    );
    for (const loc of locationsByProduct.get(product.id) || []) item.locations.add(loc);
    addVariation(item, row.serve_label, row.menu_price, `${name} (${variationName(row.serve_label)})`);
  }

  const ingredientsByCocktail = new Map();
  for (const ing of input.ingredients || []) {
    if (!ingredientsByCocktail.has(ing.cocktail_id)) ingredientsByCocktail.set(ing.cocktail_id, []);
    if (ing.product_id) ingredientsByCocktail.get(ing.cocktail_id).push(ing.product_id);
  }
  const linkedLocations = new Set(locationByBar.values());
  for (const c of input.cocktails || []) {
    if (c.included === false) continue;
    const name = String(c.square_item_name || '').trim() || String(c.name || '').trim();
    if (!name) continue;
    const item = ensureItem(`cocktail:${norm(name)}`, name, { key: 'category:cocktails', name: 'Cocktails' });
    const productIds = ingredientsByCocktail.get(c.id) || [];
    if (!productIds.length) warnings.push(`${name} has no ingredients, so it is not offered at any bar.`);
    for (const loc of linkedLocations) {
      if (productIds.length && productIds.every((pid) => locationsByProduct.get(pid)?.has(loc))) {
        item.locations.add(loc);
      }
    }
    addVariation(item, c.square_variation || c.serve_label, c.menu_price, `${name} (${variationName(c.square_variation || c.serve_label)})`);
  }

  const out = [];
  for (const item of items.values()) {
    if (!item.variations.length) continue;
    if (!item.locations.size && linkedLocations.size) {
      warnings.push(`${item.name} is not distributed to any linked bar.`);
    }
    out.push({ ...item, locations: [...item.locations].sort() });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { items: out, warnings };
}

function presenceSet(data, allLocationIds) {
  if (data?.present_at_all_locations) {
    const absent = new Set(data.absent_at_location_ids || []);
    return new Set(allLocationIds.filter((id) => !absent.has(id)));
  }
  return new Set(data?.present_at_location_ids || []);
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function withPresence(obj, set) {
  const next = { ...obj, present_at_all_locations: false, present_at_location_ids: [...set].sort() };
  delete next.absent_at_location_ids;
  return next;
}

/**
 * @param {{
 *   desired: ReturnType<typeof buildDesiredCatalog>['items'],
 *   objects: Array<any>,
 *   map: Array<{ kind: string, app_key: string, square_id: string }>,
 *   linkedLocationIds: string[],
 *   allLocationIds: string[],
 *   currency: string,
 * }} input
 */
export function diffCatalog(input) {
  const linked = new Set(input.linkedLocationIds || []);
  const all = [...new Set([...(input.allLocationIds || []), ...linked])];
  const live = (input.objects || []).filter((o) => o && !o.is_deleted);
  const itemsById = new Map(live.filter((o) => o.type === 'ITEM').map((o) => [o.id, o]));
  const categoriesById = new Map(live.filter((o) => o.type === 'CATEGORY').map((o) => [o.id, o]));
  const mapped = new Map((input.map || []).map((m) => [`${m.kind}:${m.app_key}`, m.square_id]));

  let tempN = 0;
  const temp = (kind) => `#${kind}-${++tempN}`;
  const upserts = [];
  const mapRows = [];
  const warnings = [];
  const summary = {
    itemsCreated: 0,
    itemsUpdated: 0,
    variationsCreated: 0,
    priceChanges: [],
    renamed: [],
    categoriesCreated: [],
    locations: Object.fromEntries([...linked].map((id) => [id, { add: [], remove: [] }])),
  };

  const categoryIdFor = new Map();
  const resolveCategory = (cat) => {
    if (!cat) return null;
    if (categoryIdFor.has(cat.key)) return categoryIdFor.get(cat.key);
    let id = mapped.get(`category:${cat.key}`);
    if (!id || !categoriesById.has(id)) {
      const byName = [...categoriesById.values()].find((c) => norm(c.category_data?.name) === norm(cat.name));
      id = byName?.id || null;
    }
    if (!id) {
      id = temp('cat');
      upserts.push({ type: 'CATEGORY', id, category_data: { name: cat.name } });
      summary.categoriesCreated.push(cat.name);
    }
    mapRows.push({ kind: 'category', app_key: cat.key, square_id: id, square_item_id: null });
    categoryIdFor.set(cat.key, id);
    return id;
  };

  const claimed = new Set();
  const itemsByName = new Map();
  for (const item of itemsById.values()) {
    const key = norm(item.item_data?.name);
    if (key && !itemsByName.has(key)) itemsByName.set(key, item);
  }
  const resolveItem = (d) => {
    const id = mapped.get(`item:${d.key}`);
    if (id && itemsById.has(id) && !claimed.has(id)) return itemsById.get(id);
    const byName = itemsByName.get(norm(d.name));
    if (byName && !claimed.has(byName.id)) return byName;
    return null;
  };

  const noteLocations = (name, before, after) => {
    for (const loc of linked) {
      const had = before.has(loc);
      const has = after.has(loc);
      if (has && !had) summary.locations[loc].add.push(name);
      if (had && !has) summary.locations[loc].remove.push(name);
    }
  };

  const money = (amount) => ({ amount, currency: input.currency });

  for (const d of input.desired || []) {
    const categoryId = resolveCategory(d.category);
    const existing = resolveItem(d);
    if (!existing) {
      const itemId = temp('item');
      const set = new Set(d.locations);
      const variations = d.variations.map((v) => {
        const vid = temp('var');
        mapRows.push({ kind: 'variation', app_key: v.key, square_id: vid, square_item_id: itemId });
        return withPresence({
          type: 'ITEM_VARIATION',
          id: vid,
          item_variation_data: {
            item_id: itemId,
            name: v.name,
            pricing_type: 'FIXED_PRICING',
            price_money: money(v.priceMinor),
          },
        }, set);
      });
      upserts.push(withPresence({
        type: 'ITEM',
        id: itemId,
        item_data: {
          name: d.name,
          ...(categoryId ? { categories: [{ id: categoryId }], reporting_category: { id: categoryId } } : {}),
          variations,
        },
      }, set));
      mapRows.push({ kind: 'item', app_key: d.key, square_id: itemId, square_item_id: null });
      summary.itemsCreated += 1;
      summary.variationsCreated += variations.length;
      noteLocations(d.name, new Set(), set);
      continue;
    }

    claimed.add(existing.id);
    mapRows.push({ kind: 'item', app_key: d.key, square_id: existing.id, square_item_id: null });
    const data = existing.item_data || {};
    const before = presenceSet(existing, all);
    const after = new Set([...before].filter((loc) => !linked.has(loc)));
    for (const loc of d.locations) after.add(loc);
    let changed = !sameSet(before, after);

    const oldVariations = data.variations || [];
    const usedVariation = new Set();
    const nextVariations = [];
    for (const v of d.variations) {
      const vid = mapped.get(`variation:${v.key}`);
      let match = oldVariations.find((ov) => ov.id === vid && !usedVariation.has(ov.id))
        || oldVariations.find((ov) => !usedVariation.has(ov.id) && norm(ov.item_variation_data?.name) === norm(v.name));
      if (match) {
        usedVariation.add(match.id);
        const vd = match.item_variation_data || {};
        const oldPrice = vd.pricing_type === 'FIXED_PRICING' ? Number(vd.price_money?.amount) : null;
        const vBefore = presenceSet(match, all);
        const vChanged = oldPrice !== v.priceMinor || vd.name !== v.name || !sameSet(vBefore, after);
        if (oldPrice !== v.priceMinor) {
          summary.priceChanges.push({ item: d.name, variation: v.name, from: oldPrice, to: v.priceMinor });
        }
        if (vChanged) changed = true;
        nextVariations.push(withPresence({
          ...match,
          item_variation_data: { ...vd, name: v.name, pricing_type: 'FIXED_PRICING', price_money: money(v.priceMinor) },
        }, after));
        mapRows.push({ kind: 'variation', app_key: v.key, square_id: match.id, square_item_id: existing.id });
      } else if (data.item_options?.length) {
        warnings.push(`${d.name} uses Square item options, so add a "${v.name}" option in Square to sell it there.`);
      } else {
        const tid = temp('var');
        changed = true;
        summary.variationsCreated += 1;
        nextVariations.push(withPresence({
          type: 'ITEM_VARIATION',
          id: tid,
          item_variation_data: {
            item_id: existing.id,
            name: v.name,
            pricing_type: 'FIXED_PRICING',
            price_money: money(v.priceMinor),
          },
        }, after));
        mapRows.push({ kind: 'variation', app_key: v.key, square_id: tid, square_item_id: existing.id });
      }
    }
    for (const ov of oldVariations) {
      if (usedVariation.has(ov.id)) continue;
      const vBefore = presenceSet(ov, all);
      const vAfter = new Set([...vBefore].filter((loc) => !linked.has(loc)));
      if (!sameSet(vBefore, vAfter)) changed = true;
      nextVariations.push(withPresence(ov, vAfter));
    }

    if (data.name !== d.name) {
      summary.renamed.push({ from: data.name, to: d.name });
      changed = true;
    }
    const oldCategory = data.categories?.[0]?.id || data.reporting_category?.id || data.category_id || null;
    if (categoryId && oldCategory !== categoryId) changed = true;

    noteLocations(d.name, before, after);
    if (!changed) continue;
    summary.itemsUpdated += 1;
    upserts.push(withPresence({
      ...existing,
      item_data: {
        ...data,
        name: d.name,
        ...(categoryId ? { categories: [{ id: categoryId }], reporting_category: { id: categoryId } } : {}),
        variations: nextVariations,
      },
    }, after));
  }

  for (const item of itemsById.values()) {
    if (claimed.has(item.id)) continue;
    const productType = item.item_data?.product_type;
    if (productType && productType !== 'REGULAR' && productType !== 'FOOD_AND_BEV') continue;
    const before = presenceSet(item, all);
    const after = new Set([...before].filter((loc) => !linked.has(loc)));
    if (sameSet(before, after)) continue;
    noteLocations(item.item_data?.name || item.id, before, after);
    const data = item.item_data || {};
    upserts.push(withPresence({
      ...item,
      item_data: {
        ...data,
        variations: (data.variations || []).map((v) =>
          withPresence(v, new Set([...presenceSet(v, all)].filter((loc) => !linked.has(loc))))),
      },
    }, after));
  }

  return { upserts, mapRows, summary, warnings };
}
