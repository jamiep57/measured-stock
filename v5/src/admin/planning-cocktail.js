/**
 * Create / edit a recipe drink from Menu & GP.
 * A cocktail and a spirit & mixer share one selling price. Cost is the stock
 * measures added together. The section they sit in is chosen in the editor.
 */

import { escapeHtml, toast } from '../lib/util.js';
import { formatGpPct } from '../lib/gp.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { confirmDialog } from '../components/modal.js';
import { mountProductSearch } from '../components/product-search.js';
import { parsePlanningNumber } from '../lib/planning-menu.js';
import { drinkKindMeta, drinkKindOf, MAX_COCKTAIL_INGREDIENTS, resolveCocktailLine } from '../lib/menu-cocktails.js';
import {
  createEventCocktail,
  deleteEventCocktail,
  replaceCocktailIngredients,
  updateEventCocktail,
} from '../lib/planning-data.js';
import { createServeSize, mergeServeSize } from '../lib/serve-sizes.js';
import { closeServeSizeMenu, openServeSizeMenu } from './serve-size-menu.js';

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pourWarning(part) {
  if (part.servesPerUnit != null && part.servesPerUnit > 1) return '';
  const unit = String(part.stockUnit || '').toLowerCase();
  const pack = String(part.pack || '');
  let bulky = unit === 'bottle' || unit === 'keg';
  const vol = pack.match(/(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/i);
  if (vol) {
    const n = Number(vol[1]);
    const u = vol[2].toLowerCase();
    const ml = u === 'l' ? n * 1000 : u === 'cl' ? n * 10 : n;
    if (ml >= 500) bulky = true;
  }
  if (!bulky) return '';
  return 'Costed as one serve for the whole unit. Set Serves on that product if a bottle or keg pours more than once.';
}

function draftFrom(cocktail, drinkKind) {
  const kind = drinkKindOf(cocktail?.drink_kind || drinkKind);
  if (!cocktail) {
    return {
      id: null,
      drink_kind: kind,
      name: '',
      serve_label: '',
      square_item_name: '',
      square_variation: '',
      squareFollowsName: true,
      menu_price: null,
      target_gp_pct: null,
      projected_serves: null,
      ingredients: [],
    };
  }
  const name = cocktail.name || '';
  const square = cocktail.square_item_name || '';
  return {
    id: cocktail.id,
    drink_kind: kind,
    name,
    serve_label: cocktail.serve_label || '',
    square_item_name: square,
    square_variation: cocktail.square_variation || '',
    squareFollowsName: !!square.trim() && square.trim().toLowerCase() === name.trim().toLowerCase(),
    menu_price: cocktail.menu_price ?? null,
    target_gp_pct: cocktail.target_gp_pct ?? null,
    projected_serves: cocktail.projected_serves ?? null,
    ingredients: (cocktail.ingredients || []).map((ing) => ({
      product_id: ing.product_id,
      measures: ing.measures,
    })),
  };
}

function kindOption(id, checked, disabled) {
  const meta = drinkKindMeta(id);
  return `<label class="plan-drink-kind-opt${checked ? ' is-selected' : ''}">
    <input type="radio" name="drinkKind" value="${id}" ${checked ? 'checked' : ''} ${disabled}>
    <span><strong>${escapeHtml(meta.label)}</strong><small>Sits under ${escapeHtml(meta.category)}</small></span>
  </label>`;
}

function readNumber(input, { max, required } = {}) {
  const parsed = parsePlanningNumber(input.value, { max });
  // Force a real boolean. `classList.toggle(cls, undefined)` flips the class
  // on every keystroke, so a valid price like 11.95 can show as invalid.
  const missing = Boolean(required && (parsed.value == null || parsed.value === 0));
  const bad = !parsed.ok || missing;
  input.classList.toggle('is-invalid', bad);
  return bad ? null : parsed;
}

/**
 * @param {{
 *   cocktail: object|null,
 *   ctx: object,
 *   locked: boolean,
 *   nameTaken: (name: string, exceptId: string|null) => boolean,
 *   squareTaken: (square: string, variation: string, exceptId: string|null) => boolean,
 *   onSaved: (cocktail: object) => void,
 *   onDeleted: (id: string) => void,
 * }} opts
 */
function sheetTitle(draft) {
  const label = drinkKindMeta(draft.drink_kind).label.toLowerCase();
  return draft.id ? `Edit ${label}` : `New ${label}`;
}

export function openCocktailEditor(opts) {
  const { ctx, locked, nameTaken, squareTaken, onSaved, onDeleted } = opts;
  const draft = draftFrom(opts.cocktail, opts.drinkKind);
  const dis = locked ? 'disabled' : '';
  const meta = () => drinkKindMeta(draft.drink_kind);

  openSheet({
    title: sheetTitle(draft),
    variant: 'admin-full',
    bodyHtml: `
      <p class="muted plan-sheet-lead" id="cocktailLead">${escapeHtml(meta().lead)}</p>
      <div class="admin-drawer-form">
        <div class="plan-drink-kind" role="radiogroup" aria-label="Menu section">
          ${kindOption('cocktail', draft.drink_kind === 'cocktail', dis)}
          ${kindOption('spirit_mixer', draft.drink_kind === 'spirit_mixer', dis)}
        </div>
        <label class="admin-field"><span class="admin-label">Name</span>
          <input class="admin-input" id="cocktailName" maxlength="80" value="${escapeHtml(draft.name)}" placeholder="${escapeHtml(meta().namePlaceholder)}" ${dis}></label>
        <div class="plan-form-row">
          <label class="admin-field"><span class="admin-label">Square item</span>
            <input class="admin-input" id="cocktailSquare" maxlength="200" value="${escapeHtml(draft.square_item_name)}" placeholder="Till name, if different" ${dis}></label>
          <label class="admin-field"><span class="admin-label">Variation</span>
            <input class="admin-input" id="cocktailVariation" maxlength="80" value="${escapeHtml(draft.square_variation)}" placeholder="Optional" ${dis}></label>
        </div>
        <p class="muted plan-sheet-lead">Square sales on this event match this item. It starts as the drink name. Clear it to keep the drink off sales mapping. A variation is only needed when Square sells this drink under one specific variation.</p>
        <label class="admin-field"><span class="admin-label">Serve size</span>
          <button type="button" class="admin-input serve-size-field${draft.serve_label ? '' : ' is-empty'}" id="cocktailServe" ${dis}>${escapeHtml(draft.serve_label || 'Choose a size')}</button></label>
        <div class="plan-cocktail-ings" id="cocktailIngs"></div>
        <div id="cocktailAdd"></div>
        <div class="plan-cocktail-summary" id="cocktailSummary"></div>
        <div class="plan-form-row">
          <label class="admin-field"><span class="admin-label">Menu £</span>
            <input class="admin-input num-math" id="cocktailPrice" inputmode="decimal" value="${draft.menu_price ?? ''}" placeholder="0.00" ${dis}></label>
          <label class="admin-field"><span class="admin-label">Target GP %</span>
            <input class="admin-input num-math" id="cocktailTarget" inputmode="decimal" value="${draft.target_gp_pct ?? ''}" placeholder="${ctx.event?.target_gp_pct ?? ''}" ${dis}></label>
          <label class="admin-field"><span class="admin-label">Projected serves</span>
            <input class="admin-input num-math" id="cocktailProjected" inputmode="decimal" value="${draft.projected_serves ?? ''}" placeholder="0" ${dis}></label>
        </div>
        <p class="plan-form-err" id="cocktailErr" hidden></p>
      </div>`,
    footHtml: `
      <div class="admin-drawer-foot admin-drawer-foot--split">
        ${draft.id ? `<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" id="cocktailDelete" ${dis}>Delete</button>` : '<span></span>'}
        <span class="admin-drawer-foot-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="cocktailCancel">Close</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="cocktailSave" ${dis}>${draft.id ? 'Save' : 'Add to menu'}</button>
        </span>
      </div>`,
  });

  const ingsEl = document.getElementById('cocktailIngs');
  const summaryEl = document.getElementById('cocktailSummary');
  const errEl = document.getElementById('cocktailErr');

  function showErr(message) {
    errEl.textContent = message;
    errEl.hidden = !message;
  }

  function lineNow() {
    return resolveCocktailLine({
      id: draft.id,
      name: draft.name || meta().label,
      drink_kind: draft.drink_kind,
      included: true,
      menu_price: draft.menu_price,
      target_gp_pct: draft.target_gp_pct,
      projected_serves: draft.projected_serves,
      serve_label: draft.serve_label || null,
    }, draft.ingredients, ctx);
  }

  function paintSummary() {
    const line = lineNow();
    if (!draft.ingredients.length) {
      summaryEl.innerHTML = `<p class="muted">${escapeHtml(meta().emptyIngredients)}</p>`;
      return;
    }
    if (line.costPerServe == null) {
      summaryEl.innerHTML = '<p class="plan-form-err">Every ingredient needs a cost. Set a supplier price, or a deal cost on its menu row.</p>';
      return;
    }
    const gp = line.menuPrice == null ? 'Set a menu price to see GP' : `GP ${formatGpPct(line.gpPct)}`;
    const required = line.requiredPrice != null ? ` · required ${money(line.requiredPrice)}` : '';
    summaryEl.innerHTML = `<p><strong>${money(line.costPerServe)}</strong> cost per ${escapeHtml(meta().costNoun)} · ${gp}${required}</p>`;
  }

  function paintIngs() {
    if (!draft.ingredients.length) {
      ingsEl.innerHTML = '';
      paintSummary();
      return;
    }
    const line = lineNow();
    ingsEl.innerHTML = line.ingredients.map((part) => {
      const warn = pourWarning(part);
      const pack = part.pack ? `<span class="plan-cocktail-pack">${escapeHtml(part.pack)}</span>` : '';
      const each = part.costPerMeasure == null
        ? 'No cost'
        : `${money(part.costPerMeasure)} / serve${part.servesPerUnit ? ` · ${part.servesPerUnit} serves per unit` : ''}`;
      return `<div class="plan-cocktail-ing" data-product="${escapeHtml(part.productId)}">
        <div class="plan-cocktail-ing-name">
          <span>${escapeHtml(part.name)}</span>
          ${pack}
          <span class="plan-cocktail-each">${escapeHtml(each)}</span>
          ${warn ? `<span class="plan-cocktail-warn">${escapeHtml(warn)}</span>` : ''}
        </div>
        <label class="plan-cocktail-measure">
          <span>Measures</span>
          <input class="admin-input num-math" inputmode="decimal" data-measures="${escapeHtml(part.productId)}"
            value="${escapeHtml(part.measures ?? '')}" aria-label="Measures of ${escapeHtml(part.name)}" ${dis}>
        </label>
        <span class="plan-cocktail-line-cost">${money(part.cost)}</span>
        <button type="button" class="plan-cocktail-remove" data-remove="${escapeHtml(part.productId)}" ${dis} aria-label="Remove ${escapeHtml(part.name)}">Remove</button>
      </div>`;
    }).join('');
    paintSummary();
  }

  function mountAdd() {
    const host = document.getElementById('cocktailAdd');
    if (!host || locked) return;
    host.innerHTML = '';
    const used = new Set(draft.ingredients.map((ing) => ing.product_id));
    mountProductSearch(host, {
      products: ctx.products.filter((p) => !used.has(p.id)),
      categories: ctx.categories,
      caseSizes: ctx.caseSizes,
      placeholder: draft.ingredients.length ? 'Add another product…' : 'Search stock to add…',
      onSelect: ({ productId }) => {
        if (!productId) return;
        if (draft.ingredients.some((ing) => ing.product_id === productId)) {
          showErr('That product is already in this drink. Change its measures instead.');
          return;
        }
        if (draft.ingredients.length >= MAX_COCKTAIL_INGREDIENTS) {
          showErr(`A drink can use up to ${MAX_COCKTAIL_INGREDIENTS} products.`);
          return;
        }
        showErr('');
        draft.ingredients.push({ product_id: productId, measures: 1 });
        paintIngs();
        mountAdd();
      },
    });
  }

  ingsEl.addEventListener('input', (e) => {
    const input = e.target.closest('[data-measures]');
    if (!input) return;
    const parsed = readNumber(input, { required: true });
    const ing = draft.ingredients.find((row) => row.product_id === input.dataset.measures);
    if (!ing || !parsed) return;
    ing.measures = parsed.value;
    paintSummary();
    const card = input.closest('.plan-cocktail-ing');
    const part = lineNow().ingredients.find((p) => p.productId === ing.product_id);
    const cost = card?.querySelector('.plan-cocktail-line-cost');
    if (cost) cost.textContent = money(part?.cost);
  });

  ingsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn || locked) return;
    draft.ingredients = draft.ingredients.filter((ing) => ing.product_id !== btn.dataset.remove);
    showErr('');
    paintIngs();
    mountAdd();
  });

  function bindNumber(id, key, spec) {
    const input = document.getElementById(id);
    input.addEventListener('input', () => {
      const parsed = readNumber(input, spec);
      if (!parsed) return;
      draft[key] = parsed.value;
      paintSummary();
    });
  }
  bindNumber('cocktailPrice', 'menu_price', {});
  bindNumber('cocktailTarget', 'target_gp_pct', { max: 100 });
  bindNumber('cocktailProjected', 'projected_serves', {});
  document.getElementById('cocktailName').addEventListener('input', (e) => {
    draft.name = e.target.value;
    if (draft.squareFollowsName) {
      draft.square_item_name = e.target.value;
      const square = document.getElementById('cocktailSquare');
      if (square) square.value = e.target.value;
    }
  });
  document.getElementById('cocktailSquare').addEventListener('input', (e) => {
    draft.square_item_name = e.target.value;
    draft.squareFollowsName = false;
  });
  document.getElementById('cocktailVariation').addEventListener('input', (e) => {
    draft.square_variation = e.target.value;
  });
  const serveBtn = document.getElementById('cocktailServe');
  serveBtn.addEventListener('click', () => {
    if (locked) return;
    openServeSizeMenu({
      anchor: serveBtn,
      sizes: ctx.serveSizes || [],
      current: draft.serve_label || '',
      onPick: (label) => {
        draft.serve_label = label;
        serveBtn.textContent = label;
        serveBtn.classList.remove('is-empty');
      },
      onCreate: async (label) => {
        const saved = await createServeSize(label, ctx.serveSizes || []);
        ctx.serveSizes = mergeServeSize(ctx.serveSizes || [], saved);
        draft.serve_label = saved.label;
        serveBtn.textContent = saved.label;
        serveBtn.classList.remove('is-empty');
      },
    });
  });
  document.querySelectorAll('input[name="drinkKind"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked || locked) return;
      draft.drink_kind = drinkKindOf(input.value);
      document.querySelectorAll('.plan-drink-kind-opt').forEach((opt) => {
        opt.classList.toggle('is-selected', !!opt.querySelector('input[name="drinkKind"]')?.checked);
      });
      const title = document.getElementById('sheetTitle');
      if (title) title.textContent = sheetTitle(draft);
      const lead = document.getElementById('cocktailLead');
      if (lead) lead.textContent = meta().lead;
      const name = document.getElementById('cocktailName');
      if (name) name.placeholder = meta().namePlaceholder;
      paintSummary();
    });
  });

  document.getElementById('cocktailCancel').onclick = () => { closeServeSizeMenu(); closeSheet(); };
  const deleteBtn = document.getElementById('cocktailDelete');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const ok = await confirmDialog({
        title: `Delete ${meta().label.toLowerCase()}`,
        message: `Remove “${draft.name || 'this drink'}” from this event’s menu? The stock products stay in the library.`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      try {
        await deleteEventCocktail(draft.id);
        closeSheet();
        onDeleted(draft.id);
        toast(`${meta().label} removed`);
      } catch (err) {
        showErr(err.message || 'Could not delete this drink');
      }
    };
  }

  document.getElementById('cocktailSave').onclick = async () => {
    closeServeSizeMenu();
    draft.name = document.getElementById('cocktailName').value;
    const name = draft.name.trim();
    const square = (draft.squareFollowsName
      ? name
      : document.getElementById('cocktailSquare').value).trim();
    const variation = document.getElementById('cocktailVariation').value.trim();
    if (!name) { showErr('Name is required'); return; }
    if (name.length > 80) { showErr('Name must be 80 characters or fewer'); return; }
    if (square.length > 200) { showErr('Square item must be 200 characters or fewer'); return; }
    if (variation.length > 80) { showErr('Variation must be 80 characters or fewer'); return; }
    if (nameTaken(name, draft.id)) { showErr('This event already has a drink with that name'); return; }
    if (square && squareTaken?.(square, variation, draft.id)) {
      showErr('Another drink on this event already uses that Square item');
      return;
    }
    if (!draft.ingredients.length) { showErr('Add at least one stock product'); return; }
    const measureInputs = [...ingsEl.querySelectorAll('[data-measures]')];
    for (const input of measureInputs) {
      const parsed = readNumber(input, { required: true });
      const ing = draft.ingredients.find((row) => row.product_id === input.dataset.measures);
      if (!parsed || !ing) {
        showErr('Every ingredient needs a number of measures above 0');
        return;
      }
      ing.measures = parsed.value;
    }
    const price = readNumber(document.getElementById('cocktailPrice'));
    const target = readNumber(document.getElementById('cocktailTarget'), { max: 100 });
    const projected = readNumber(document.getElementById('cocktailProjected'));
    if (!price || !target || !projected) { showErr('Check the price, target and projected serves'); return; }
    const fields = {
      name,
      drink_kind: drinkKindOf(draft.drink_kind),
      serve_label: draft.serve_label.trim() || null,
      square_item_name: square || null,
      square_variation: variation || null,
      menu_price: price.value,
      target_gp_pct: target.value,
      projected_serves: projected.value,
    };
    const btn = document.getElementById('cocktailSave');
    btn.disabled = true;
    try {
      let saved;
      if (draft.id) {
        saved = await updateEventCocktail(draft.id, fields);
        const ingredients = await replaceCocktailIngredients(draft.id, draft.ingredients);
        saved = { ...(saved || {}), id: draft.id, included: opts.cocktail?.included !== false, ...fields, ingredients };
      } else {
        saved = await createEventCocktail(ctx.eventId, fields, draft.ingredients);
      }
      closeSheet();
      onSaved(saved);
      if (!opts.quiet) toast(draft.id ? `${meta().label} saved` : `${name} added to the menu`);
    } catch (err) {
      btn.disabled = false;
      const msg = String(err?.message || '');
      showErr(/event_cocktails_square_key|saved_menu_cocktails_square_key/i.test(msg)
        ? 'Another drink on this event already uses that Square item'
        : /event_cocktails_event_name_key|already exists|23505/i.test(msg)
          ? 'This event already has a drink with that name'
          : (err.message || 'Could not save this drink'));
    }
  };

  paintIngs();
  mountAdd();
  requestAnimationFrame(() => {
    const name = document.getElementById('cocktailName');
    name?.focus();
    if (!draft.id && name?.value) name.select();
  });
}
