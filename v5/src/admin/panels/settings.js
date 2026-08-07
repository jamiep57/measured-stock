/**
 * Workspace settings — users, warehouses, product categories and case sizes.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadCategories, loadCaseSizes, loadLibraryProducts } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { parseQty } from '../../stock-entry.js';
import { navigate, hrefForRoute } from '../router.js';
import { renderUsersSection, mountUsersPanel } from './users.js';
import { confirmDialog } from '../../components/modal.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';

const SETTINGS_NAV = [
  { id: 'users', label: 'Users' },
  { id: 'warehouses', label: 'Warehouses' },
  { id: 'categories', label: 'Product categories' },
  { id: 'case-sizes', label: 'Case sizes' },
];

const CATEGORY_COLOURS = [
  { value: 'beer', label: 'Beer (amber)' },
  { value: 'cider', label: 'Cider (green)' },
  { value: 'wine', label: 'Wine (purple)' },
  { value: 'rtd', label: 'RTD / mixers (blue)' },
  { value: 'softs', label: 'Softs (teal)' },
  { value: 'spirits', label: 'Spirits (red)' },
];

const STOCK_UNIT_OPTS = [
  { value: 'case', label: 'Cases' },
  { value: 'single', label: 'Singles' },
  { value: 'bottle', label: 'Bottles' },
  { value: 'keg', label: 'Kegs' },
  { value: 'unit', label: 'Units' },
];

function colourKey(name) {
  const k = String(name || '').toLowerCase();
  if (k.includes('beer')) return 'beer';
  if (k.includes('cider')) return 'cider';
  if (k.includes('wine')) return 'wine';
  if (k.includes('spirit')) return 'spirits';
  if (k.includes('soft') || k.includes('seltzer') || k.includes('water')) return 'softs';
  return 'rtd';
}

function stockUnitLabel(value) {
  return STOCK_UNIT_OPTS.find((o) => o.value === value)?.label || value || '—';
}

function linkedProducts(csId, products) {
  return (products || []).filter((p) =>
    p.case_size_id === csId ||
    p.stock_case_size_id === csId ||
    (p.product_suppliers || []).some((ps) => ps.purchase_case_size_id === csId));
}

function isCaseSizeLinked(csId, products) {
  return linkedProducts(csId, products).length > 0;
}

function categoryProductCount(catId, products) {
  return (products || []).filter((p) =>
    p.category_id === catId || p.category?.id === catId).length;
}

function addressPreview(address) {
  const line = String(address || '').split('\n').map((s) => s.trim()).find(Boolean);
  return line || '';
}

function renderSubnav(section) {
  return `
    <nav class="settings-subnav" aria-label="Workspace settings">
      ${SETTINGS_NAV.map((item) => `
        <a class="settings-subnav-link${item.id === section ? ' is-active' : ''}"
          href="${escapeHtml(hrefForRoute({ view: 'settings', section: item.id }))}"
          data-settings-section="${escapeHtml(item.id)}">${escapeHtml(item.label)}</a>
      `).join('')}
    </nav>`;
}

function renderWarehousesSection() {
  return `
    <section class="settings-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Warehouses</h2>
          <p class="settings-card-desc muted">Storage locations for stock that isn’t on an event.</p>
        </div>
        <div class="settings-card-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="settingsAddWh">
            ${icon('plus', { size: 14 })} Add
          </button>
        </div>
      </header>
      <div class="settings-card-search">
        <input type="search" class="admin-input" id="settingsWhSearch"
          placeholder="Search warehouses…" autocomplete="off" aria-label="Search warehouses">
      </div>
      <div class="settings-list" id="settingsWarehouses" role="list">
        <div class="settings-list-empty">${loadingWidget('Loading warehouses…')}</div>
      </div>
    </section>`;
}

function renderCategoriesSection() {
  return `
    <section class="settings-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Product categories</h2>
          <p class="settings-card-desc muted">Group products and set badge colours.</p>
        </div>
        <div class="settings-card-actions" id="settingsCatActions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="settingsCatMergeToggle">Merge</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="settingsAddCat">
            ${icon('plus', { size: 14 })} Add
          </button>
        </div>
        <div class="settings-merge-bar" id="settingsCatMergeBar" hidden>
          <span class="settings-merge-count" id="settingsCatMergeCount">0 selected</span>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="settingsCatMergeBtn" disabled>Merge selected…</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="settingsCatMergeCancel">Cancel</button>
        </div>
      </header>
      <div class="settings-card-search">
        <input type="search" class="admin-input" id="settingsCatSearch"
          placeholder="Search categories…" autocomplete="off" aria-label="Search categories">
      </div>
      <div class="settings-list" id="settingsCategories" role="list">
        <div class="settings-list-empty">${loadingWidget('Loading categories…')}</div>
      </div>
    </section>`;
}

function renderCaseSizesSection() {
  return `
    <section class="settings-section">
      <header class="settings-card-head">
        <div class="settings-card-head-text">
          <h2 class="settings-card-title">Case sizes</h2>
          <p class="settings-card-desc muted">Pack definitions used across every product.</p>
        </div>
        <div class="settings-card-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="settingsAddCs">
            ${icon('plus', { size: 14 })} Add
          </button>
        </div>
      </header>
      <div class="settings-card-search">
        <input type="search" class="admin-input" id="settingsCsSearch"
          placeholder="Search case sizes…" autocomplete="off" aria-label="Search case sizes">
      </div>
      <div class="settings-list settings-list--case" id="settingsCaseSizes" role="list">
        <div class="settings-list-empty">${loadingWidget('Loading case sizes…')}</div>
      </div>
    </section>`;
}

function renderSectionPane(section) {
  if (section === 'users') return renderUsersSection();
  if (section === 'warehouses') return renderWarehousesSection();
  if (section === 'categories') return renderCategoriesSection();
  if (section === 'case-sizes') return renderCaseSizesSection();
  return renderUsersSection();
}

function renderShell(section = 'users') {
  return `
    <div class="admin-page settings-panel">
      <div class="settings-shell admin-surface">
        <header class="settings-shell-head">
          <h1 class="settings-shell-title">Workspace settings</h1>
        </header>
        <div class="settings-layout">
          ${renderSubnav(section)}
          <div class="settings-pane" id="settingsPane">
            ${renderSectionPane(section)}
          </div>
        </div>
      </div>
    </div>`;
}

export function renderSettingsShell(section = 'users') {
  return renderShell(section);
}

function wireSettingsSubnav(section) {
  document.querySelectorAll('a[data-settings-section]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const next = a.dataset.settingsSection;
      if (!next || next === section) return;
      navigate({ view: 'settings', section: next });
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  });
}

export function mountSettingsPanel(section = 'users') {
  wireSettingsSubnav(section);

  if (section === 'users') {
    return mountUsersPanel();
  }

  const whWrap = $('settingsWarehouses');
  const catWrap = $('settingsCategories');
  const csWrap = $('settingsCaseSizes');

  let warehouses = [];
  let categories = [];
  let caseSizes = [];
  let products = [];
  let mergeMode = false;
  let whQuery = '';
  let catQuery = '';
  let csQuery = '';
  const selected = new Set();

  if (section === 'warehouses' && !whWrap) return () => {};
  if (section === 'categories' && !catWrap) return () => {};
  if (section === 'case-sizes' && !csWrap) return () => {};

  function paintWarehouses() {
    if (!whWrap) return;
    const q = whQuery.trim().toLowerCase();
    const sorted = warehouses
      .filter((w) => {
        if (!q) return true;
        const hay = [w.name, w.address].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (!sorted.length) {
      whWrap.innerHTML = emptyState({
        iconHtml: icon('warehouse', { size: 22 }),
        title: warehouses.length ? 'No matching warehouses' : 'No warehouses yet',
        copy: warehouses.length
          ? 'No warehouses match your search.'
          : 'Add your first warehouse to get started.',
        variant: 'admin',
        className: 'empty--inline',
      });
      return;
    }

    whWrap.innerHTML = sorted.map((w) => {
      const addr = addressPreview(w.address);
      return `
        <button type="button" class="settings-row settings-row--wh" data-wh-id="${escapeHtml(w.id)}" role="listitem">
          <span class="settings-row-icon" aria-hidden="true">${icon('warehouse', { size: 14 })}</span>
          <span class="settings-row-main">
            <span class="settings-row-name">${escapeHtml(w.name || '—')}</span>
            <span class="settings-row-meta">${addr ? escapeHtml(addr) : 'No address'}</span>
          </span>
          <span class="settings-row-chev">${icon('chevron-right', { size: 16 })}</span>
        </button>`;
    }).join('');

    whWrap.querySelectorAll('[data-wh-id]').forEach((btn) => {
      btn.onclick = () => openWarehouseForm(btn.dataset.whId);
    });
  }

  function paintCategories() {
    if (!catWrap) return;
    catWrap.classList.toggle('settings-list--merge', mergeMode);
    const q = catQuery.trim().toLowerCase();
    const sorted = categories
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) =>
        (a.sort_order - b.sort_order) || (a.name || '').localeCompare(b.name || ''));

    if (!sorted.length) {
      catWrap.innerHTML = emptyState({
        iconHtml: icon('list', { size: 22 }),
        title: categories.length ? 'No matching categories' : 'No categories yet',
        copy: categories.length
          ? 'No categories match your search.'
          : 'Add your first category to get started.',
        variant: 'admin',
        className: 'empty--inline',
      });
      return;
    }

    catWrap.innerHTML = sorted.map((c) => {
      const key = c.colour_key || colourKey(c.name);
      const n = categoryProductCount(c.id, products);
      const sel = selected.has(c.id) ? ' settings-row--selected' : '';
      const check = mergeMode
        ? `<span class="settings-check${selected.has(c.id) ? ' settings-check--on' : ''}" aria-hidden="true">${selected.has(c.id) ? icon('check', { size: 12 }) : ''}</span>`
        : '';
      return `
        <button type="button" class="settings-row${sel}" data-cat-id="${escapeHtml(c.id)}" role="listitem">
          ${check}
          <span class="settings-swatch settings-swatch--${escapeHtml(key)}" aria-hidden="true"></span>
          <span class="settings-row-main">
            <span class="settings-row-name">${escapeHtml(c.name || '—')}</span>
            <span class="settings-row-meta">${n} product${n === 1 ? '' : 's'}</span>
          </span>
          ${mergeMode ? '' : `<span class="settings-row-chev">${icon('chevron-right', { size: 16 })}</span>`}
        </button>`;
    }).join('');

    catWrap.querySelectorAll('[data-cat-id]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.catId;
        if (mergeMode) toggleCatSel(id);
        else openCategoryForm(id);
      };
    });
  }

  function paintCaseSizes() {
    if (!csWrap) return;
    const q = csQuery.trim().toLowerCase();
    const sorted = caseSizes
      .filter((cs) => {
        if (!q) return true;
        const hay = [
          cs.label,
          cs.stock_unit,
          cs.notes,
          cs.units_per_case,
          cs.servings_per_unit,
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .slice()
      .sort((a, b) =>
        (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''));

    if (!sorted.length) {
      csWrap.innerHTML = emptyState({
        iconHtml: icon('package', { size: 22 }),
        title: caseSizes.length ? 'No matching case sizes' : 'No case sizes yet',
        copy: caseSizes.length
          ? 'No case sizes match your search.'
          : 'Add your first case size to get started.',
        variant: 'admin',
        className: 'empty--inline',
      });
      return;
    }

    csWrap.innerHTML = `
      <div class="settings-cs-cols" aria-hidden="true">
        <span>Label</span>
        <span>Units</span>
        <span>Count as</span>
        <span>Servings</span>
        <span>Products</span>
      </div>
      ${sorted.map((cs) => {
        const n = linkedProducts(cs.id, products).length;
        return `
          <button type="button" class="settings-row settings-row--cs" data-cs-id="${escapeHtml(cs.id)}" role="listitem">
            <span class="settings-row-name">${escapeHtml(cs.label || 'Case size')}</span>
            <span class="settings-row-cell">${cs.units_per_case != null ? escapeHtml(String(cs.units_per_case)) : '—'}</span>
            <span class="settings-row-cell">${escapeHtml(stockUnitLabel(cs.stock_unit))}</span>
            <span class="settings-row-cell">${cs.servings_per_unit != null ? escapeHtml(String(cs.servings_per_unit)) : '—'}</span>
            <span class="settings-row-cell settings-row-cell--muted">${n}</span>
            <span class="settings-row-chev">${icon('chevron-right', { size: 16 })}</span>
          </button>`;
      }).join('')}`;

    csWrap.querySelectorAll('[data-cs-id]').forEach((btn) => {
      btn.onclick = () => openCaseSizeForm(btn.dataset.csId);
    });
  }

  function updateMergeBar() {
    const n = selected.size;
    const countEl = $('settingsCatMergeCount');
    const mergeBtn = $('settingsCatMergeBtn');
    if (countEl) countEl.textContent = `${n} selected`;
    if (mergeBtn) mergeBtn.disabled = n < 2;
  }

  function setMergeMode(on) {
    mergeMode = on;
    selected.clear();
    const bar = $('settingsCatMergeBar');
    const actions = $('settingsCatActions');
    if (bar) bar.hidden = !mergeMode;
    if (actions) actions.hidden = mergeMode;
    updateMergeBar();
    paintCategories();
  }

  function toggleCatSel(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    updateMergeBar();
    paintCategories();
  }

  async function refresh() {
    if (section === 'warehouses') {
      warehouses = await getDB().warehouses.list();
      paintWarehouses();
      return;
    }
    if (section === 'categories') {
      [categories, products] = await Promise.all([loadCategories(), loadLibraryProducts()]);
      paintCategories();
      return;
    }
    if (section === 'case-sizes') {
      [caseSizes, products] = await Promise.all([loadCaseSizes(), loadLibraryProducts()]);
      paintCaseSizes();
    }
  }

  function openWarehouseForm(editId) {
    const w = editId ? warehouses.find((x) => x.id === editId) : null;

    openSheet({
      title: w ? 'Edit warehouse' : 'New warehouse',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="settingsWhErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="settingsWhName">Name</label>
            <input class="admin-input" type="text" id="settingsWhName" required placeholder="e.g. Main Depot">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="settingsWhAddress">Address</label>
            <textarea class="admin-textarea" id="settingsWhAddress" rows="3" placeholder="Street, City, Postcode"></textarea>
          </div>
          <p class="wst-form-hint muted">Stock moves in and out of warehouses via Transfers.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${w ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="settingsWhDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="settingsWhCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="settingsWhSave">${w ? 'Update warehouse' : 'Save warehouse'}</button>
          </div>
        </div>`,
    });

    if (w) {
      $('settingsWhName').value = w.name || '';
      $('settingsWhAddress').value = w.address || '';
    }

    $('settingsWhCancel').onclick = closeSheet;
    $('settingsWhSave').onclick = async () => {
      const name = ($('settingsWhName')?.value || '').trim();
      if (!name) {
        $('settingsWhErr').textContent = 'Name is required.';
        return;
      }
      const dupe = warehouses.find((x) =>
        (x.name || '').toLowerCase() === name.toLowerCase() && (!w || x.id !== w.id));
      if (dupe) {
        $('settingsWhErr').textContent = 'A warehouse with that name already exists.';
        return;
      }
      const patch = {
        name,
        address: ($('settingsWhAddress')?.value || '').trim() || null,
      };
      const btn = $('settingsWhSave');
      btn.disabled = true;
      try {
        const DB = getDB();
        if (w) await DB.warehouses.update(w.id, patch);
        else await DB.warehouses.create(patch);
        closeSheet();
        await refresh();
        toast(w ? 'Warehouse updated' : 'Warehouse created');
      } catch (err) {
        $('settingsWhErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };

    if (w) {
      $('settingsWhDelete').onclick = async () => {
        const DB = getDB();
        const enc = DB._.enc;
        try {
          const stockRows = await DB.warehouseStock.forWarehouse(w.id);
          const hasStock = (stockRows || []).some((s) => (Number(s.qty_on_hand) || 0) > 0);
          if (hasStock && !(await confirmDialog({ title: 'Confirm', message: 'This warehouse still holds stock. Delete anyway?', confirmLabel: 'Delete', danger: true }))) return;

          const xferRows = await DB.select(
            'transfers',
            '?or=(from_warehouse_id.eq.' + enc(w.id) + ',to_warehouse_id.eq.' + enc(w.id) + ')&select=id'
          );
          const xferCount = (xferRows || []).length;
          if (xferCount && !(await confirmDialog({ title: 'Confirm', message: `This warehouse is referenced by ${xferCount} transfer${xferCount === 1 ? '' : 's'}. ` +
            'Delete anyway? Transfer records will be kept but no longer linked to this warehouse.', confirmLabel: 'Delete', danger: true }))) return;

          if (!hasStock && !xferCount && !(await confirmDialog({ title: 'Confirm', message: `Delete “${w.name}”? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;

          await DB.warehouses.remove(w.id);
          closeSheet();
          await refresh();
          toast('Warehouse deleted');
        } catch (err) {
          const msg = String(err?.message || err);
          if (/23503/.test(msg) && /warehouse/i.test(msg)) {
            toast('Can’t delete — transfers still reference this warehouse.', true);
          } else {
            toast(err.message || 'Delete failed', true);
          }
        }
      };
    }
  }

  function openCategoryForm(editId) {
    const c = editId ? categories.find((x) => x.id === editId) : null;
    const colourOpts = CATEGORY_COLOURS.map((o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === (c?.colour_key || colourKey(c?.name) || 'rtd') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');

    openSheet({
      title: c ? 'Edit category' : 'New category',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="settingsCatErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="settingsCatName">Name</label>
            <input class="admin-input" type="text" id="settingsCatName" required placeholder="e.g. BEER">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="settingsCatColour">Badge colour</label>
            <select class="admin-select" id="settingsCatColour">${colourOpts}</select>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${c ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="settingsCatDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="settingsCatCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="settingsCatSave">${c ? 'Update category' : 'Save category'}</button>
          </div>
        </div>`,
    });

    if (c) $('settingsCatName').value = c.name || '';

    $('settingsCatCancel').onclick = closeSheet;
    $('settingsCatSave').onclick = async () => {
      const name = ($('settingsCatName')?.value || '').trim();
      if (!name) {
        $('settingsCatErr').textContent = 'Name is required.';
        return;
      }
      const dupe = categories.find((x) =>
        x.name.toLowerCase() === name.toLowerCase() && (!c || x.id !== c.id));
      if (dupe) {
        $('settingsCatErr').textContent = 'A category with that name already exists.';
        return;
      }
      const patch = {
        name,
        colour_key: $('settingsCatColour')?.value || colourKey(name),
      };
      const btn = $('settingsCatSave');
      btn.disabled = true;
      try {
        const DB = getDB();
        if (c) await DB.categories.update(c.id, patch);
        else {
          patch.sort_order = categories.length;
          await DB.categories.create(patch);
        }
        closeSheet();
        await refresh();
        toast(c ? 'Category updated' : 'Category created');
      } catch (err) {
        $('settingsCatErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };

    if (c) {
      $('settingsCatDelete').onclick = async () => {
        if (categoryProductCount(c.id, products) > 0) {
          toast('Can\'t delete — products still use this category. Reassign them first.', true);
          return;
        }
        if (!(await confirmDialog({ title: 'Confirm', message: `Delete “${c.name}”? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
        try {
          await getDB().categories.remove(c.id);
          closeSheet();
          await refresh();
          toast('Category deleted');
        } catch (err) {
          toast(err.message || 'Delete failed', true);
        }
      };
    }
  }

  function openMergeDialog() {
    const chosen = categories.filter((c) => selected.has(c.id));
    if (chosen.length < 2) return;

    const sorted = chosen.slice().sort((a, b) =>
      categoryProductCount(b.id, products) - categoryProductCount(a.id, products) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')));
    let keepId = sorted[0].id;

    function paintKeepOptions() {
      const body = $('settingsMergeBody');
      if (!body) return;
      body.innerHTML = sorted.map((c) => {
        const key = c.colour_key || colourKey(c.name);
        const n = categoryProductCount(c.id, products);
        const chosenCls = c.id === keepId ? ' settings-merge-opt--chosen' : '';
        return `
          <label class="settings-merge-opt${chosenCls}">
            <input type="radio" name="settingsMergeKeep" value="${escapeHtml(c.id)}"${c.id === keepId ? ' checked' : ''}>
            <span class="settings-swatch settings-swatch--${escapeHtml(key)}" aria-hidden="true"></span>
            <span class="settings-merge-opt-main">
              <span class="settings-row-name">${escapeHtml(c.name || '—')}</span>
              <span class="muted">${n} product${n === 1 ? '' : 's'}</span>
            </span>
          </label>`;
      }).join('');
      body.querySelectorAll('input[name="settingsMergeKeep"]').forEach((input) => {
        input.onchange = () => {
          keepId = input.value;
          paintKeepOptions();
        };
      });
    }

    openSheet({
      title: 'Merge categories',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="muted" style="margin:0 0 12px">Products on the other categories move to the one you keep. The rest are deleted.</p>
          <div class="del-form-err" id="settingsMergeErr"></div>
          <div class="settings-merge-opts" id="settingsMergeBody"></div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="settingsMergeCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="settingsMergeConfirm">Merge ${chosen.length} into 1</button>
          </div>
        </div>`,
    });

    paintKeepOptions();
    $('settingsMergeCancel').onclick = closeSheet;
    $('settingsMergeConfirm').onclick = async () => {
      const dupIds = [...selected].filter((id) => id !== keepId);
      if (!dupIds.length) {
        $('settingsMergeErr').textContent = 'Pick at least one other category to merge in.';
        return;
      }
      const btn = $('settingsMergeConfirm');
      const cancel = $('settingsMergeCancel');
      btn.disabled = true;
      cancel.disabled = true;
      btn.textContent = 'Merging…';
      try {
        const res = await getDB().categories.merge(keepId, dupIds);
        const merged = res?.merged != null ? res.merged : dupIds.length;
        closeSheet();
        setMergeMode(false);
        await refresh();
        toast(`Merged ${merged} categor${merged === 1 ? 'y' : 'ies'}`);
      } catch (err) {
        $('settingsMergeErr').textContent = err.message || 'Merge failed';
        btn.disabled = false;
        cancel.disabled = false;
        btn.textContent = `Merge ${chosen.length} into 1`;
      }
    };
  }

  function openCaseSizeForm(editId) {
    const cs = editId ? caseSizes.find((x) => x.id === editId) : null;
    const linked = cs ? linkedProducts(cs.id, products).length : 0;
    const suOpts = STOCK_UNIT_OPTS.map((o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === (cs?.stock_unit || 'case') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');

    openSheet({
      title: cs ? 'Edit case size' : 'New case size',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="settingsCsErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="settingsCsLabel">Label</label>
            <input class="admin-input" type="text" id="settingsCsLabel" required placeholder="e.g. 24×330ml, 70cl, 50L Keg">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="settingsCsUnits">Units per case</label>
              <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="settingsCsUnits" placeholder="1">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="settingsCsStockUnit">Count as</label>
              <select class="admin-select" id="settingsCsStockUnit">${suOpts}</select>
            </div>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="settingsCsServings">Servings per unit</label>
              <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="settingsCsServings" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="settingsCsSort">Sort order</label>
              <input class="admin-input num-math" type="text" inputmode="numeric" autocomplete="off" id="settingsCsSort" placeholder="0">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="settingsCsNotes">Notes</label>
            <textarea class="admin-textarea" id="settingsCsNotes" rows="3" placeholder="Optional"></textarea>
          </div>
          ${cs ? `<p class="wst-form-hint muted">${linked} product${linked === 1 ? '' : 's'} use this case size.</p>` : ''}
          <p class="wst-form-hint muted">Products pick up pack label, units, count-as, and servings from the case size they use.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${cs ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="settingsCsDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="settingsCsCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="settingsCsSave">${cs ? 'Update case size' : 'Save case size'}</button>
          </div>
        </div>`,
    });

    if (cs) {
      $('settingsCsLabel').value = cs.label || '';
      $('settingsCsUnits').value = cs.units_per_case != null ? String(cs.units_per_case) : '';
      $('settingsCsServings').value = cs.servings_per_unit != null ? String(cs.servings_per_unit) : '';
      $('settingsCsSort').value = cs.sort_order != null ? String(cs.sort_order) : '';
      $('settingsCsNotes').value = cs.notes || '';
    }

    $('settingsCsCancel').onclick = closeSheet;
    $('settingsCsSave').onclick = async () => {
      const label = ($('settingsCsLabel')?.value || '').trim();
      if (!label) {
        $('settingsCsErr').textContent = 'Label is required.';
        return;
      }
      const unitsRaw = ($('settingsCsUnits')?.value || '').trim();
      const units_per_case = unitsRaw === '' ? NaN : parseQty(unitsRaw);
      if (!Number.isFinite(units_per_case) || units_per_case <= 0) {
        $('settingsCsErr').textContent = 'Units per case must be greater than zero.';
        return;
      }
      const stock_unit = $('settingsCsStockUnit')?.value || 'case';
      let servings_per_unit = null;
      if ($('settingsCsServings')?.value !== '') {
        servings_per_unit = parseQty($('settingsCsServings').value);
        if (!Number.isFinite(servings_per_unit) || servings_per_unit <= 0) {
          $('settingsCsErr').textContent = 'Servings per unit must be a positive number.';
          return;
        }
      }
      let sort_order = 0;
      if ($('settingsCsSort')?.value !== '') {
        sort_order = parseQty($('settingsCsSort').value);
        if (!Number.isFinite(sort_order)) sort_order = 0;
      }
      const patch = {
        label,
        units_per_case,
        stock_unit,
        servings_per_unit,
        sort_order: Math.round(sort_order),
        notes: ($('settingsCsNotes')?.value || '').trim() || null,
      };
      const btn = $('settingsCsSave');
      btn.disabled = true;
      try {
        const DB = getDB();
        if (cs) await DB.caseSizes.update(cs.id, patch);
        else await DB.caseSizes.create(patch);
        closeSheet();
        await refresh();
        toast(cs ? 'Case size updated' : 'Case size created');
      } catch (err) {
        $('settingsCsErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };

    if (cs) {
      $('settingsCsDelete').onclick = async () => {
        if (isCaseSizeLinked(cs.id, products)) {
          toast('Can\'t delete — products still use this case size. Reassign them first.', true);
          return;
        }
        if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this case size? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
        try {
          await getDB().caseSizes.remove(cs.id);
          closeSheet();
          await refresh();
          toast('Case size deleted');
        } catch (err) {
          toast(err.message || 'Delete failed', true);
        }
      };
    }
  }

  $('settingsAddWh')?.addEventListener('click', () => openWarehouseForm(null));
  $('settingsAddCat')?.addEventListener('click', () => openCategoryForm(null));
  $('settingsAddCs')?.addEventListener('click', () => openCaseSizeForm(null));
  $('settingsCatMergeToggle')?.addEventListener('click', () => setMergeMode(true));
  $('settingsCatMergeCancel')?.addEventListener('click', () => setMergeMode(false));
  $('settingsCatMergeBtn')?.addEventListener('click', () => openMergeDialog());

  $('settingsWhSearch')?.addEventListener('input', (e) => {
    whQuery = e.target.value;
    paintWarehouses();
  });
  $('settingsCatSearch')?.addEventListener('input', (e) => {
    catQuery = e.target.value;
    paintCategories();
  });
  $('settingsCsSearch')?.addEventListener('input', (e) => {
    csQuery = e.target.value;
    paintCaseSizes();
  });

  refresh().catch((err) => {
    reportError(err, { source: 'admin.settings.refresh', silent: true });
    const msg = errorState({
      title: 'Couldn’t load settings',
      copy: err.message || 'Failed to load',
      variant: 'admin',
    });
    const retryTarget = whWrap || catWrap || csWrap;
    if (whWrap) whWrap.innerHTML = msg;
    if (catWrap) catWrap.innerHTML = msg;
    if (csWrap) csWrap.innerHTML = msg;
    if (retryTarget) bindEmptyRetry(retryTarget, () => refresh());
  });

  return () => {};
}
