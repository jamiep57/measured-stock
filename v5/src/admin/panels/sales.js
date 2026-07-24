/**
 * Square & modifiers — item sales + modifier mapping grids.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { getDB, loadEventFull, loadCaseSizes, loadLibraryProducts, productFromEvent } from '../../db.js';
import {
  findRecipe, recipeIsMapped, recipeOnEvent, recipeIngredients,
  productIdForName, normVariation,
} from '../../lib/square-recipes.js';
import { parseFractionQty, displayFractionQty, formatQtyAsFraction } from '../../components/fraction-input.js';
import { mountProductSearch } from '../../components/product-search.js';
import { groupProductsByPool, poolSummary } from '../../lib/volume-pools.js';
import { icon } from '../../lib/icons.js';
import { readModifierFile } from '../../lib/modifier-import.js';
import { readTillFile } from '../../lib/till-import.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  return String(v);
}

function renderPortionInput(qty) {
  return `<input type="text" class="fraction-input mod-ing-qty" inputmode="text"
    value="${escapeHtml(qty)}" placeholder="1/24" autocomplete="off"
    aria-label="Portion per serving">`;
}

function renderProductSlot({ selectedId, poolName, showRemove }) {
  return `
    <div class="mod-ing">
      <input type="hidden" class="mod-ing-pid" value="${escapeHtml(selectedId || '')}">
      <input type="hidden" class="mod-ing-pool" value="${escapeHtml(poolName || '')}">
      <div class="mod-ing-search"></div>
      <button type="button" class="mod-ing-remove" title="Remove product"
        aria-label="Remove product"${showRemove ? '' : ' hidden'}>
        ${icon('x', { size: 14 })}
      </button>
    </div>`;
}

function recipeSlots(recipe, eps) {
  const ings = recipeIngredients(recipe);
  return ings.length
    ? ings.map((ig) => ({
      selectedId: ig.pool_name ? '' : productIdForName(ig.product_name, eps),
      poolName: ig.pool_name || '',
      qty: displayFractionQty({ qty: ig.qty, qty_text: ig.qty_text }),
    }))
    : [{ selectedId: '', poolName: '', qty: '1' }];
}

function renderRecipeColumns(recipe, eps, attrs) {
  const slots = recipeSlots(recipe, eps);
  const portionHtml = slots.map((s) => renderPortionInput(s.qty)).join('');
  const productHtml = `
    <div class="mod-recipe" ${attrs}>
      <div class="mod-recipe-ings">${slots.map((slot, i) => renderProductSlot({
    selectedId: slot.selectedId,
    poolName: slot.poolName,
    showRemove: slots.length > 1 || i > 0,
  })).join('')}</div>
      <button type="button" class="mod-ing-add" title="Add product" aria-label="Add product">
        ${icon('plus', { size: 14 })}
      </button>
    </div>`;
  return { portionHtml, productHtml };
}

function countMapped(rows, itemKey, variationKey, recipes, eps) {
  let mapped = 0;
  let warn = 0;
  rows.forEach((r) => {
    const recipe = findRecipe(recipes, r[itemKey], r[variationKey]);
    if (!recipeIsMapped(recipe)) return;
    mapped += 1;
    if (!recipeOnEvent(recipe, eps)) warn += 1;
  });
  return { mapped, warn };
}

function renderMapRow({
  recipes, eps, item, variation, label, sublabel, qty, attrs, rowCls,
}) {
  const recipe = findRecipe(recipes, item, variation);
  const mapped = recipeIsMapped(recipe);
  const onEvent = mapped && recipeOnEvent(recipe, eps);
  const cls = rowCls || (!mapped ? 'mod-row--unmapped' : onEvent ? 'mod-row--mapped' : 'mod-row--warn');
  const { portionHtml, productHtml } = renderRecipeColumns(recipe, eps, attrs);

  return `
    <tr class="dist-prod-row mod-row ${cls}" ${attrs}>
      <th class="dist-sticky dist-prod-name mod-name" scope="row">
        <span>${escapeHtml(label)}</span>
        ${sublabel ? `<span class="mod-sub muted">${escapeHtml(sublabel)}</span>` : ''}
      </th>
      <td class="dist-sticky dist-prod-pack muted mod-qty">${fmtNum(qty)}</td>
      <td class="mod-portion-cell">
        <div class="mod-portion-stack">${portionHtml}</div>
      </td>
      <td class="mod-map-cell">${productHtml}</td>
    </tr>`;
}

function groupTillByCategory(rows) {
  const grouped = {};
  (rows || []).forEach((r) => {
    const cat = r.category || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(r);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });
  return grouped;
}

function groupBySet(rows) {
  const grouped = {};
  (rows || []).forEach((r) => {
    const set = r.modifier_set || 'Uncategorised';
    (grouped[set] = grouped[set] || []).push(r);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.modifier || '').localeCompare(b.modifier || ''));
  });
  return grouped;
}

function tillAttrs(row) {
  return `data-till-name="${escapeHtml(row.name)}" data-till-var="${escapeHtml(row.variation || 'Regular')}"`;
}

function modAttrs(row) {
  return `data-mod-set="${escapeHtml(row.modifier_set || '')}" data-mod-name="${escapeHtml(row.modifier)}"`;
}

function renderTillGridBody(ctx) {
  const rows = filterTillRows(ctx);
  if (!rows.length) {
    return `<tr><td colspan="4" class="dist-empty">No item sales match your filter.</td></tr>`;
  }
  const grouped = groupTillByCategory(rows);
  let html = '';
  Object.keys(grouped).sort().forEach((cat) => {
    html += `<tr class="dist-cat-row">
      <td colspan="4" class="dist-cat-pinned mod-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td>
    </tr>`;
    grouped[cat].forEach((row) => {
      const varLabel = row.variation && normVariation(row.variation) !== 'regular'
        ? row.variation
        : '';
      html += renderMapRow({
        recipes: ctx.recipes,
        eps: ctx.eps,
        item: row.name,
        variation: row.variation,
        label: row.name,
        sublabel: varLabel,
        qty: row.items_sold,
        attrs: tillAttrs(row),
      });
    });
  });
  return html;
}

function renderModGridBody(ctx) {
  const rows = filterModRows(ctx);
  if (!rows.length) {
    return `<tr><td colspan="4" class="dist-empty">No modifier lines match your filter.</td></tr>`;
  }
  const grouped = groupBySet(rows);
  let html = '';
  Object.keys(grouped).sort().forEach((set) => {
    html += `<tr class="dist-cat-row">
      <td colspan="4" class="dist-cat-pinned mod-cat-pinned"><span class="dist-bar-name">${escapeHtml(set)}</span></td>
    </tr>`;
    grouped[set].forEach((row) => {
      html += renderMapRow({
        recipes: ctx.recipes,
        eps: ctx.eps,
        item: row.modifier,
        variation: row.modifier_set,
        label: row.modifier,
        sublabel: '',
        qty: row.qty_sold,
        attrs: modAttrs(row),
      });
    });
  });
  return html;
}

function filterTillRows(ctx) {
  const q = (ctx.searchQuery || '').trim().toLowerCase();
  const rows = ctx.tillRows || [];
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [r.name, r.variation, r.category].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function filterModRows(ctx) {
  const q = (ctx.searchQuery || '').trim().toLowerCase();
  const rows = ctx.modRows || [];
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [r.modifier, r.modifier_set].join(' ').toLowerCase();
    return hay.includes(q);
  });
}


export function renderSalesShell() {
  return `
    <div class="sales-panel" id="salesPanel">
      <div class="mod-loading muted">Loading sales…</div>
    </div>`;
}

export function mountSalesPanel(route) {
  const panel = $('salesPanel');
  if (!panel) return () => {};

  const ctx = {
    eventId: route.eventId,
    event: null,
    eps: [],
    pools: [],
    caseSizes: [],
    recipes: [],
    tillImport: null,
    tillRows: [],
    modImport: null,
    modRows: [],
    tab: 'items',
    searchQuery: getLastProductFilter().query || '',
    saving: new Set(),
    abort: false,
  };

  let tillFileInput = null;
  let modFileInput = null;

  function syncTheadHeight() {
    requestAnimationFrame(() => {
      const wrap = panel.querySelector('.dist-grid-wrap');
      const theadRow = panel.querySelector('.dist-grid thead tr');
      if (wrap && theadRow) {
        wrap.style.setProperty('--dist-thead-h', `${theadRow.getBoundingClientRect().height}px`);
      }
    });
  }

  function paintTillStats() {
    const { mapped, warn } = countMapped(ctx.tillRows, 'name', 'variation', ctx.recipes, ctx.eps);
    const qtyTotal = ctx.tillRows.reduce((s, r) => s + (Number(r.items_sold) || 0), 0);
    return `
      <div class="mod-stats">
        <div class="wst-stat"><span class="wst-stat-label">Till lines</span><span class="wst-stat-value">${ctx.tillRows.length}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Mapped</span><span class="wst-stat-value mod-stat--ok">${mapped}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Need mapping</span><span class="wst-stat-value mod-stat--warn">${ctx.tillRows.length - mapped}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Items sold</span><span class="wst-stat-value">${fmtNum(qtyTotal)}</span></div>
        ${warn ? `<div class="wst-stat"><span class="wst-stat-label">Stock warn</span><span class="wst-stat-value mod-stat--warn">${warn}</span></div>` : ''}
      </div>`;
  }

  function paintModStats() {
    const { mapped, warn } = countMapped(ctx.modRows, 'modifier', 'modifier_set', ctx.recipes, ctx.eps);
    const qtyTotal = ctx.modRows.reduce((s, r) => s + (Number(r.qty_sold) || 0), 0);
    return `
      <div class="mod-stats">
        <div class="wst-stat"><span class="wst-stat-label">Modifier lines</span><span class="wst-stat-value">${ctx.modRows.length}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Mapped</span><span class="wst-stat-value mod-stat--ok">${mapped}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Need mapping</span><span class="wst-stat-value mod-stat--warn">${ctx.modRows.length - mapped}</span></div>
        <div class="wst-stat"><span class="wst-stat-label">Qty sold</span><span class="wst-stat-value">${fmtNum(qtyTotal)}</span></div>
        ${warn ? `<div class="wst-stat"><span class="wst-stat-label">Stock warn</span><span class="wst-stat-value mod-stat--warn">${warn}</span></div>` : ''}
      </div>`;
  }

  function gridShell({ nameCol, qtyCol, bodyHtml }) {
    return `
      <div class="dist-grid-wrap mod-grid-wrap">
        <table class="dist-grid mod-grid">
          <thead>
            <tr>
              <th class="dist-sticky dist-col-header dist-col-product">
                <div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">${nameCol}</span></div>
              </th>
              <th class="dist-sticky dist-col-header dist-col-pack">
                <div class="dist-bar-head"><span class="dist-bar-name">${qtyCol}</span></div>
              </th>
              <th class="dist-col-header mod-col-portion">
                <div class="dist-bar-head"><span class="dist-bar-name">Portion</span></div>
              </th>
              <th class="dist-col-header mod-col-map">
                <div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div>
              </th>
            </tr>
          </thead>
          <tbody id="salesGridBody">${bodyHtml}</tbody>
        </table>
      </div>`;
  }

  function paintTabs() {
    return `
      <div class="sales-tabs" role="tablist">
        <button type="button" class="sales-tab${ctx.tab === 'items' ? ' sales-tab--active' : ''}" data-tab="items" role="tab"
          aria-selected="${ctx.tab === 'items'}">Item sales${ctx.tillRows.length ? ` (${ctx.tillRows.length})` : ''}</button>
        <button type="button" class="sales-tab${ctx.tab === 'modifiers' ? ' sales-tab--active' : ''}" data-tab="modifiers" role="tab"
          aria-selected="${ctx.tab === 'modifiers'}">Modifiers${ctx.modRows.length ? ` (${ctx.modRows.length})` : ''}</button>
      </div>`;
  }

  function recipeKeysFromEl(recipeEl) {
    if (recipeEl.hasAttribute('data-till-name')) {
      return {
        item: recipeEl.dataset.tillName ?? '',
        variation: recipeEl.dataset.tillVar ?? 'Regular',
      };
    }
    return {
      item: recipeEl.dataset.modName ?? '',
      variation: recipeEl.dataset.modSet ?? '',
    };
  }

  function readIngredientsFromRecipeEl(recipeEl) {
    const tr = recipeEl.closest('tr');
    if (!tr) return [];
    const qtyInputs = [...tr.querySelectorAll('.mod-portion-cell .mod-ing-qty')];
    return [...recipeEl.querySelectorAll('.mod-ing')].map((slot, pos) => {
      const pidInput = slot.querySelector('.mod-ing-pid');
      const poolInput = slot.querySelector('.mod-ing-pool');
      const qtyInput = qtyInputs[pos];
      const productId = pidInput?.value || '';
      const poolName = (poolInput?.value || '').trim();
      const qtyRaw = qtyInput?.value?.trim() || '1';
      const qty = parseFractionQty(qtyRaw);
      if (!(qty > 0)) return null;
      const qtyText = /^[0-9.]+$/.test(qtyRaw) ? formatQtyAsFraction(qty) : qtyRaw;

      if (poolName) {
        return { pool_name: poolName, product_name: null, qty, qty_text: qtyText, position: pos };
      }
      if (!productId) return null;
      const product = productFromEvent(ctx.event, productId);
      if (!product?.name) return null;
      return { product_name: product.name, pool_name: null, qty, qty_text: qtyText, position: pos };
    }).filter(Boolean);
  }

  function clearIngredientSlot(slot) {
    const pidInput = slot.querySelector('.mod-ing-pid');
    const poolInput = slot.querySelector('.mod-ing-pool');
    const searchInput = slot.querySelector('.product-search-input');
    if (pidInput) pidInput.value = '';
    if (poolInput) poolInput.value = '';
    if (searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function portionInputForSlot(recipeEl, slot) {
    const tr = recipeEl.closest('tr');
    const ings = recipeEl.querySelector('.mod-recipe-ings');
    if (!tr || !ings || !slot) return null;
    const index = [...ings.children].indexOf(slot);
    if (index < 0) return null;
    return tr.querySelectorAll('.mod-portion-cell .mod-ing-qty')[index] || null;
  }

  function mountIngredientSearch(slot, recipeEl) {
    const mountEl = slot.querySelector('.mod-ing-search');
    const pidInput = slot.querySelector('.mod-ing-pid');
    const poolInput = slot.querySelector('.mod-ing-pool');
    if (!mountEl || !pidInput || !poolInput || mountEl.querySelector('.product-search')) return;

    mountProductSearch(mountEl, {
      products: ctx.eps,
      pools: ctx.pools,
      caseSizes: ctx.caseSizes,
      value: pidInput.value || '',
      poolValue: poolInput.value || '',
      placeholder: 'Search product or pool…',
      dropdownFixed: true,
      onSelect: ({ productId, poolName }) => {
        pidInput.value = productId || '';
        poolInput.value = poolName || '';
        if (poolName) {
          const qtyInput = portionInputForSlot(recipeEl, slot);
          // Pool qty is servings per sale (1 = single can/shot), not case fraction.
          if (qtyInput && (!qtyInput.value.trim() || parseFractionQty(qtyInput.value) < 1)) {
            qtyInput.value = '1';
          }
        }
        handleRecipeSave(recipeEl);
      },
    });

    const searchInput = mountEl.querySelector('.product-search-input');
    if (searchInput) {
      searchInput.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!searchInput.value.trim() && (pidInput.value || poolInput.value)) {
            pidInput.value = '';
            poolInput.value = '';
            handleRecipeSave(recipeEl);
          }
        }, 120);
      });
    }
  }

  function syncRemoveButtons(recipeEl) {
    const slots = [...recipeEl.querySelectorAll('.mod-ing')];
    slots.forEach((slot, i) => {
      const btn = slot.querySelector('.mod-ing-remove');
      if (!btn) return;
      btn.hidden = slots.length <= 1 && i === 0;
    });
  }

  function updateRowState(recipeEl) {
    const tr = recipeEl.closest('tr');
    if (!tr) return;
    const { item, variation } = recipeKeysFromEl(recipeEl);
    const recipe = findRecipe(ctx.recipes, item, variation);
    const mapped = recipeIsMapped(recipe);
    const onEvent = mapped && recipeOnEvent(recipe, ctx.eps);
    tr.classList.remove('mod-row--unmapped', 'mod-row--mapped', 'mod-row--warn');
    tr.classList.add(!mapped ? 'mod-row--unmapped' : onEvent ? 'mod-row--mapped' : 'mod-row--warn');
  }

  function refreshStats() {
    panel.querySelectorAll('.mod-hint').forEach((el) => el.remove());
    const stats = panel.querySelector('.mod-stats');
    if (stats) {
      stats.outerHTML = ctx.tab === 'items' ? paintTillStats() : paintModStats();
    }
  }

  function addIngredientSlot(recipeEl) {
    const tr = recipeEl.closest('tr');
    const portionStack = tr?.querySelector('.mod-portion-stack');
    const ings = recipeEl.querySelector('.mod-recipe-ings');
    if (!portionStack || !ings) return;
    portionStack.insertAdjacentHTML('beforeend', renderPortionInput('1'));
    ings.insertAdjacentHTML('beforeend', renderProductSlot({ selectedId: '', poolName: '', showRemove: true }));
    syncRemoveButtons(recipeEl);
    const slot = ings.lastElementChild;
    if (slot) mountIngredientSearch(slot, recipeEl);
    bindRecipeControls(recipeEl);
    slot?.querySelector('.product-search-input')?.focus();
  }

  function bindRecipeControls(scope = panel) {
    const recipeEls = scope.classList?.contains('mod-recipe')
      ? [scope]
      : [...scope.querySelectorAll('.mod-recipe')];
    recipeEls.forEach((recipeEl) => {
      const tr = recipeEl.closest('tr');
      recipeEl.querySelectorAll('.mod-ing').forEach((slot) => {
        mountIngredientSearch(slot, recipeEl);
      });
      tr?.querySelectorAll('.mod-portion-cell .mod-ing-qty').forEach((input) => {
        input.onblur = () => handleRecipeSave(recipeEl);
      });
      recipeEl.querySelectorAll('.mod-ing-remove').forEach((btn) => {
        btn.onclick = () => {
          const slot = btn.closest('.mod-ing');
          const ings = recipeEl.querySelector('.mod-recipe-ings');
          const portionStack = tr?.querySelector('.mod-portion-stack');
          if (!slot || !ings || !portionStack) return;
          const index = [...ings.children].indexOf(slot);
          if (ings.children.length <= 1) {
            if (index >= 0) {
              const qty = portionStack.children[index];
              if (qty) qty.value = '1';
            }
            clearIngredientSlot(slot);
            handleRecipeSave(recipeEl);
            return;
          }
          if (index >= 0) portionStack.children[index]?.remove();
          slot.remove();
          syncRemoveButtons(recipeEl);
          handleRecipeSave(recipeEl);
        };
      });
      const addBtn = recipeEl.querySelector('.mod-ing-add');
      if (addBtn) {
        addBtn.onclick = () => addIngredientSlot(recipeEl);
      }
      syncRemoveButtons(recipeEl);
    });
  }

  async function saveRecipe(item, variation, ingredients) {
    const DB = getDB();
    const saveId = `${item}|${variation}`;
    if (ctx.saving.has(saveId)) return;
    ctx.saving.add(saveId);

    const existing = findRecipe(ctx.recipes, item, variation);
    const valid = (ingredients || []).filter((ig) =>
      (ig.product_name || ig.pool_name) && ig.qty > 0);

    try {
      if (!valid.length) {
        if (existing) {
          await DB.recipes.remove(existing.id);
          ctx.recipes = ctx.recipes.filter((r) => r.id !== existing.id);
        }
        return;
      }

      const payload = {
        till_item: item,
        till_variation: variation || '',
        unit_model: 'case',
        notes: null,
        updated_at: new Date().toISOString(),
      };

      let recipeId = existing?.id;
      if (existing) {
        await DB.recipes.update(recipeId, payload);
        await DB.remove('recipe_ingredients', `recipe_id=eq.${DB._.enc(recipeId)}`);
      } else {
        const created = await DB.recipes.create(payload);
        recipeId = created.id;
      }

      await DB.insert('recipe_ingredients', valid.map((ig, i) => ({
        recipe_id: recipeId,
        product_name: ig.pool_name ? null : ig.product_name,
        pool_name: ig.pool_name || null,
        qty: ig.qty,
        qty_text: ig.qty_text || null,
        position: i,
      })), { returning: false });

      ctx.recipes = await DB.recipes.listFull();
    } finally {
      ctx.saving.delete(saveId);
    }
  }

  async function handleRecipeSave(recipeEl, { toastOnSave = true } = {}) {
    const { item, variation } = recipeKeysFromEl(recipeEl);
    const ingredients = readIngredientsFromRecipeEl(recipeEl);
    const hadRecipe = recipeIsMapped(findRecipe(ctx.recipes, item, variation));

    try {
      await saveRecipe(item, variation, ingredients);
      updateRowState(recipeEl);
      refreshStats();
      if (toastOnSave) {
        if (ingredients.length) toast('Recipe saved');
        else if (hadRecipe) toast('Mapping cleared');
      }
    } catch (err) {
      toast(err.message || 'Save failed', true);
      throw err;
    }
  }

  function paint() {
    const isItems = ctx.tab === 'items';
    const rows = isItems ? ctx.tillRows : ctx.modRows;
    const stats = isItems ? paintTillStats() : paintModStats();
    const emptyMsg = isItems
      ? 'No item sales imported yet. Use <strong>Import item sales</strong> in the toolbar.'
      : 'No modifier sales imported yet. Use <strong>Import modifiers</strong> in the toolbar.';

    panel.innerHTML = `
      ${paintTabs()}
      ${stats}
      ${rows.length
    ? gridShell({
      nameCol: isItems ? 'Till item' : 'Modifier',
      qtyCol: isItems ? 'Items sold' : 'Qty sold',
      bodyHtml: isItems ? renderTillGridBody(ctx) : renderModGridBody(ctx),
    })
    : `<div class="mod-empty dist-empty"><p>${emptyMsg}</p></div>`}`;

    panel.querySelectorAll('.sales-tab').forEach((btn) => {
      btn.onclick = () => {
        ctx.tab = btn.dataset.tab;
        paint();
      };
    });
    bindRecipeControls();
    syncTheadHeight();
  }

  function paintBodyOnly() {
    const body = panel.querySelector('#salesGridBody');
    if (!body) {
      paint();
      return;
    }
    body.innerHTML = ctx.tab === 'items' ? renderTillGridBody(ctx) : renderModGridBody(ctx);
    bindRecipeControls();
    refreshStats();
    syncTheadHeight();
  }

  async function importTillFile(file) {
    const DB = getDB();
    const parsed = await readTillFile(file);
    if (!parsed.length) throw new Error('No till lines with items sold > 0 found.');

    const imp = (await DB.tillImports.upsert({
      event_id: ctx.eventId,
      file_name: file.name,
      imported_at: new Date().toISOString(),
    }, 'event_id'))[0];

    await DB.remove('till_sale_rows', `import_id=eq.${DB._.enc(imp.id)}`);
    await DB.insert('till_sale_rows', parsed.map((p) => ({
      import_id: imp.id,
      name: p.name,
      variation: p.variation,
      sku: p.sku || null,
      category: p.category || null,
      items_sold: p.items_sold,
      net_sales: p.net_sales,
      gross_sales: p.gross_sales,
    })), { returning: false });

    ctx.tillImport = await DB.tillImports.forEvent(ctx.eventId);
    ctx.tillRows = ctx.tillImport?.rows || [];
    ctx.tab = 'items';
    paint();
    toast(`Imported ${parsed.length} item sales line${parsed.length === 1 ? '' : 's'}`);
  }

  async function importModFile(file) {
    const DB = getDB();
    const parsed = await readModifierFile(file);
    if (!parsed.length) throw new Error('No modifier lines with qty sold > 0 found.');

    const imp = (await DB.modifierImports.upsert({
      event_id: ctx.eventId,
      file_name: file.name,
      imported_at: new Date().toISOString(),
    }, 'event_id'))[0];

    await DB.remove('modifier_sale_rows', `import_id=eq.${DB._.enc(imp.id)}`);
    await DB.insert('modifier_sale_rows', parsed.map((p) => ({
      import_id: imp.id,
      modifier_set: p.modifier_set || null,
      modifier: p.modifier,
      qty_sold: p.qty_sold,
      net_sales: p.net_sales,
    })), { returning: false });

    ctx.modImport = await DB.modifierImports.forEvent(ctx.eventId);
    ctx.modRows = ctx.modImport?.rows || [];
    ctx.tab = 'modifiers';
    paint();
    toast(`Imported ${parsed.length} modifier line${parsed.length === 1 ? '' : 's'}`);
  }

  async function clearTillImport() {
    if (!ctx.tillImport) return;
    if (!confirm('Remove the imported item sales for this event? Recipes are kept.')) return;
    const DB = getDB();
    await DB.tillImports.removeWhere(`event_id=eq.${DB._.enc(ctx.eventId)}`);
    ctx.tillImport = null;
    ctx.tillRows = [];
    paint();
    toast('Item sales import cleared');
  }

  async function clearModImport() {
    if (!ctx.modImport) return;
    if (!confirm('Remove the imported modifier sales for this event? Recipes are kept.')) return;
    const DB = getDB();
    await DB.modifierImports.removeWhere(`event_id=eq.${DB._.enc(ctx.eventId)}`);
    ctx.modImport = null;
    ctx.modRows = [];
    paint();
    toast('Modifier import cleared');
  }

  function ensureFileInput(kind) {
    if (kind === 'till') {
      if (tillFileInput) return tillFileInput;
      tillFileInput = document.createElement('input');
      tillFileInput.type = 'file';
      tillFileInput.accept = '.csv,.tsv,.xlsx,.xls,.txt';
      tillFileInput.hidden = true;
      tillFileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          await importTillFile(file);
        } catch (err) {
          toast(err.message || 'Import failed', true);
        }
      };
      document.body.appendChild(tillFileInput);
      return tillFileInput;
    }
    if (modFileInput) return modFileInput;
    modFileInput = document.createElement('input');
    modFileInput.type = 'file';
    modFileInput.accept = '.csv,.tsv,.xlsx,.xls,.txt';
    modFileInput.hidden = true;
    modFileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        await importModFile(file);
      } catch (err) {
        toast(err.message || 'Import failed', true);
      }
    };
    document.body.appendChild(modFileInput);
    return modFileInput;
  }

  async function reload() {
    const DB = getDB();
    const [event, tillImport, modImport, recipes, caseSizes, libraryProducts] = await Promise.all([
      loadEventFull(ctx.eventId),
      DB.tillImports.forEvent(ctx.eventId).catch(() => null),
      DB.modifierImports.forEvent(ctx.eventId).catch(() => null),
      DB.recipes.listFull().catch(() => []),
      loadCaseSizes(),
      loadLibraryProducts().catch(() => []),
    ]);
    if (ctx.abort) return;
    ctx.event = event;
    ctx.eps = (event?.event_products || []).filter((ep) => ep.product?.name);
    ctx.caseSizes = caseSizes || [];
    ctx.pools = groupProductsByPool(libraryProducts || []).map((pool) => ({
      name: pool.name,
      key: pool.key,
      meta: `Volume pool · ${poolSummary(pool, ctx.caseSizes)}`,
      searchText: pool.members.map((m) => m.name || '').join(' '),
    }));
    ctx.tillImport = tillImport;
    ctx.tillRows = tillImport?.rows || [];
    ctx.modImport = modImport;
    ctx.modRows = modImport?.rows || [];
    ctx.recipes = recipes || [];
    if (!ctx.tillRows.length && ctx.modRows.length) ctx.tab = 'modifiers';
    paint();
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'import-till-sales') {
      e.detail.handled = true;
      ensureFileInput('till').click();
    }
    if (e.detail?.action === 'clear-till-sales') {
      e.detail.handled = true;
      clearTillImport().catch((err) => toast(err.message || 'Clear failed', true));
    }
    if (e.detail?.action === 'import-modifiers') {
      e.detail.handled = true;
      ensureFileInput('mod').click();
    }
    if (e.detail?.action === 'clear-modifiers') {
      e.detail.handled = true;
      clearModImport().catch((err) => toast(err.message || 'Clear failed', true));
    }
  };

  const onProductFilter = (e) => {
    ctx.searchQuery = e.detail?.query || '';
    paintBodyOnly();
    if (e.detail) e.detail.handled = true;
  };

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  reload().catch((err) => {
    panel.innerHTML = `<div class="dist-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    ctx.abort = true;
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    tillFileInput?.remove();
    modFileInput?.remove();
  };
}
