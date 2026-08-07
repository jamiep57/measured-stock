/**
 * Admin volume pools panel — link interchangeable products (Sprite ↔ 7up)
 * with pack fractions (1/24 vs 1/12 of a case per serving).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadCaseSizes, loadLibraryProducts } from '../../db.js';
import { productStockPack } from '../../pack-metrics.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { mountProductSearch } from '../../components/product-search.js';
import { mountFractionInput } from '../../components/fraction-input.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
import { confirmDialog } from '../../components/modal.js';
  normPoolName,
  servingsPerCase,
  poolFractionText,
  defaultPoolFractionText,
  poolServingsFromFraction,
  groupProductsByPool,
  poolSummary,
} from '../../lib/volume-pools.js';

function preferredSupplier(p) {
  const offers = p.product_suppliers || [];
  const pref = offers.find((o) => o.is_preferred) || offers[0];
  return pref?.supplier?.name || p.supplier?.name || '—';
}

function packLabel(p, caseSizes) {
  const pack = productStockPack(p, caseSizes);
  return pack.label || p.case_size || '—';
}

function formatServingsPerCase(n) {
  if (!Number.isFinite(n) || !(n > 0)) return '—';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toLocaleString('en-GB', { maximumFractionDigits: 4 });
}

function renderShell() {
  return `
    <div class="admin-page vp-panel">
      <div class="catalog-layout">
        <aside class="catalog-list-card admin-surface">
          <div class="catalog-list-head">
            <input type="search" class="admin-input" id="vpSearch"
              placeholder="Search volume pools…" autocomplete="off" aria-label="Search volume pools">
          </div>
          <div class="catalog-list" id="vpList">
            <div class="catalog-list-empty muted">Loading volume pools…</div>
          </div>
        </aside>
        <section class="catalog-detail admin-surface" id="vpDetail">
          <div class="catalog-detail-empty" id="vpDetailEmpty">
            ${icon('layers', { size: 32, strokeWidth: 1.5 })}
            <p>Select a volume pool to link interchangeable products, or create one from the toolbar.</p>
          </div>
          <div id="vpDetailBody" hidden></div>
        </section>
      </div>
    </div>`;
}

function renderListItems(pools, selectedKey, query, caseSizes) {
  const q = (query || '').trim().toLowerCase();
  const list = (pools || []).filter((pool) => {
    if (!q) return true;
    const memberHay = pool.members.map((p) => p.name || '').join(' ');
    return `${pool.name} ${memberHay}`.toLowerCase().includes(q);
  });

  if (!list.length) {
    return `<div class="catalog-list-empty">${pools?.length
      ? 'No pools match your search.'
      : 'No volume pools yet. Link Sprite with 7up (or similar) so stock tracks as one pool.'}</div>`;
  }

  return list.map((pool) => {
    const active = pool.key === selectedKey ? ' catalog-list-item--active' : '';
    return `
      <button type="button" class="catalog-list-item${active}" data-vp-key="${escapeHtml(pool.key)}">
        <span class="catalog-list-name">${escapeHtml(pool.name)}</span>
        <span class="catalog-list-meta">${escapeHtml(poolSummary(pool, caseSizes))}</span>
      </button>`;
  }).join('');
}

function renderMemberRows(pool, caseSizes) {
  const rows = pool?.members || [];
  if (!rows.length) {
    return '<div class="catalog-list-empty">No products in this pool yet. Add substitutes below.</div>';
  }

  return `
    <div class="catalog-table-wrap">
      <table class="catalog-table vp-member-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Pack</th>
            <th>Units / case</th>
            <th>Fraction / serving</th>
            <th>Servings / case</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((p) => {
            const pack = productStockPack(p, caseSizes);
            const perCase = servingsPerCase(p, caseSizes);
            return `<tr data-vp-pid="${escapeHtml(p.id)}">
              <td>
                <span class="catalog-table-primary">${escapeHtml(p.name || 'Product')}</span>
                <span class="vp-member-sub muted">${escapeHtml(preferredSupplier(p))}</span>
              </td>
              <td>${escapeHtml(packLabel(p, caseSizes))}</td>
              <td>${escapeHtml(String(pack.unitsPerCase || 1))}</td>
              <td>
                <div class="vp-fraction-mount" data-vp-fraction="${escapeHtml(p.id)}"
                  data-initial="${escapeHtml(poolFractionText(p, caseSizes))}"></div>
              </td>
              <td class="vp-per-case" data-vp-per-case="${escapeHtml(p.id)}">${escapeHtml(formatServingsPerCase(perCase))}</td>
              <td>
                <button type="button" class="topbar-tool vp-remove-btn" data-vp-remove="${escapeHtml(p.id)}"
                  title="Remove from pool" aria-label="Remove ${escapeHtml(p.name || 'product')} from pool">
                  ${icon('x', { size: 14 })}
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderDetail(pool, caseSizes) {
  if (!pool) return '';

  return `
    <div class="catalog-detail-head">
      <div class="catalog-detail-head-main">
        <h2 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(pool.name)}</span></h2>
        <p class="catalog-detail-meta">${escapeHtml(poolSummary(pool, caseSizes))} — stock and till use combine across these products.</p>
      </div>
      <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="vpEditBtn"
        title="Rename or delete pool" aria-label="Rename or delete pool">
        ${icon('pencil', { size: 16, strokeWidth: 2.5 })}<span>Edit</span>
      </button>
    </div>
    <p class="wst-form-hint muted vp-hint">
      Enter the fraction of one case/SKU used per serving — keep it as typed
      (e.g. <code>1/24</code> for a can from a 24-pack, <code>1/12</code> from a 12-pack,
      <code>1/28</code> of a 70cl bottle). That is what makes different pack sizes comparable.
    </p>
    <div class="catalog-detail-section">
      <h3 class="catalog-section-title">Products (${pool.members.length})</h3>
      ${renderMemberRows(pool, caseSizes)}
    </div>
    <div class="catalog-detail-section vp-add-section">
      <h3 class="catalog-section-title">Add product</h3>
      <div class="vp-add-row">
        <div class="vp-add-search" id="vpAddSearch"></div>
        <div class="admin-field vp-add-servings-field">
          <label class="admin-label" for="vpAddFraction">Fraction / serving</label>
          <div id="vpAddFractionMount"></div>
        </div>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="vpAddBtn" disabled>Add</button>
      </div>
      <p class="wst-form-hint muted" id="vpAddHint">Search a substitute product to include in this pool.</p>
    </div>`;
}

export function renderVolumePoolsShell() {
  return renderShell();
}

export async function mountVolumePoolsPanel() {
  const listEl = $('vpList');
  const detailEmpty = $('vpDetailEmpty');
  const detailBody = $('vpDetailBody');
  const searchEl = $('vpSearch');
  if (!listEl) return () => {};

  let products = [];
  let caseSizes = [];
  let pools = [];
  let selectedKey = null;
  let searchQuery = '';
  let pendingAddId = null;
  let addFraction = null;
  let createFraction = null;
  const memberFractions = new Map();

  function currentPool() {
    return selectedKey ? pools.find((p) => p.key === selectedKey) : null;
  }

  function memberIdsInSelected() {
    return new Set((currentPool()?.members || []).map((p) => p.id));
  }

  function paintList() {
    listEl.innerHTML = renderListItems(pools, selectedKey, searchQuery, caseSizes);
    listEl.querySelectorAll('[data-vp-key]').forEach((btn) => {
      btn.onclick = async () => selectPool(btn.dataset.vpKey);
    });
  }

  function wireDetail() {
    memberFractions.clear();
    $('vpEditBtn')?.addEventListener('click', async () => openPoolForm(currentPool()?.name));

    detailBody.querySelectorAll('[data-vp-fraction]').forEach((mount) => {
      const productId = mount.dataset.vpFraction;
      const frac = mountFractionInput(mount, {
        value: mount.dataset.initial || '1',
        placeholder: 'e.g. 1/24',
      });
      memberFractions.set(productId, frac);
      const input = frac.root.querySelector('input');
      input?.setAttribute('aria-label', 'Fraction of case per serving');
      const save = () => saveFraction(productId, frac.getValue());
      input?.addEventListener('change', save);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    detailBody.querySelectorAll('[data-vp-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => removeMember(btn.dataset.vpRemove));
    });

    const addMount = $('vpAddFractionMount');
    addFraction = addMount
      ? mountFractionInput(addMount, { value: '1', placeholder: 'e.g. 1/24', id: 'vpAddFraction' })
      : null;

    mountAddSearch();
    $('vpAddBtn')?.addEventListener('click', async () => addMember());
  }

  function mountAddSearch() {
    const mount = $('vpAddSearch');
    if (!mount) return;
    mount.innerHTML = '';
    pendingAddId = null;
    const inPool = memberIdsInSelected();
    const available = products.filter((p) => !inPool.has(p.id));

    mountProductSearch(mount, {
      products: available,
      caseSizes,
      placeholder: 'Search products to add…',
      onSelect: ({ productId, product }) => {
        pendingAddId = productId || null;
        if (addFraction && product) {
          addFraction.setValue(defaultPoolFractionText(product, caseSizes));
        }
        const addBtn = $('vpAddBtn');
        if (addBtn) addBtn.disabled = !pendingAddId;
        const hint = $('vpAddHint');
        if (hint && product) {
          const pack = packLabel(product, caseSizes);
          const upc = productStockPack(product, caseSizes).unitsPerCase || 1;
          const frac = defaultPoolFractionText(product, caseSizes);
          hint.textContent = `${product.name} · ${pack} · ${upc} units/case · default ${frac}`;
        }
      },
    });
  }

  function paintDetail() {
    const pool = currentPool();
    if (!pool) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(pool, caseSizes);
    wireDetail();
  }

  function selectPool(key) {
    selectedKey = key;
    paintList();
    paintDetail();
  }

  async function refresh() {
    [products, caseSizes] = await Promise.all([
      loadLibraryProducts(),
      loadCaseSizes(),
    ]);
    pools = groupProductsByPool(products);
    if (selectedKey && !pools.some((p) => p.key === selectedKey)) {
      selectedKey = pools[0]?.key || null;
    }
    if (!selectedKey && pools.length === 1) {
      selectedKey = pools[0].key;
    }
    paintList();
    paintDetail();
  }

  async function setProductPool(productId, poolName, fractionText) {
    const product = products.find((p) => p.id === productId);
    if (!product && poolName) throw new Error('Product not found');

    let patch;
    if (!poolName) {
      patch = {
        pool_name: null,
        pool_servings_per_unit: null,
        pool_servings_text: null,
      };
    } else {
      const derived = poolServingsFromFraction(fractionText, product, caseSizes);
      if (!derived) throw new Error('Enter a valid fraction (e.g. 1/24)');
      patch = {
        pool_name: poolName,
        pool_servings_per_unit: derived.pool_servings_per_unit,
        pool_servings_text: derived.pool_servings_text,
      };
    }

    await getDB().products.update(productId, patch);
    const local = products.find((p) => p.id === productId);
    if (local) {
      Object.assign(local, patch);
    }
    return patch;
  }

  async function saveFraction(productId, raw) {
    const pool = currentPool();
    if (!pool) return;
    try {
      const patch = await setProductPool(productId, pool.name, raw);
      const perCaseEl = detailBody.querySelector(`[data-vp-per-case="${productId}"]`);
      if (perCaseEl) {
        const product = products.find((p) => p.id === productId);
        perCaseEl.textContent = formatServingsPerCase(servingsPerCase(product, caseSizes));
      }
      const frac = memberFractions.get(productId);
      if (frac && patch.pool_servings_text) frac.setValue(patch.pool_servings_text);
      paintList();
    } catch (err) {
      toast(err.message || 'Failed to update fraction', true);
      await refresh();
    }
  }

  async function removeMember(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    if (!(await confirmDialog({ title: 'Confirm', message: `Remove “${product.name}” from this volume pool?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await setProductPool(productId, null, null);
      await refresh();
      toast('Removed from pool');
    } catch (err) {
      toast(err.message || 'Remove failed', true);
    }
  }

  async function addMember() {
    const pool = currentPool();
    if (!pool || !pendingAddId) return;
    const fractionText = addFraction?.getValue() || '';
    const product = products.find((p) => p.id === pendingAddId);
    if (!poolServingsFromFraction(fractionText, product, caseSizes)) {
      toast('Enter a valid fraction (e.g. 1/24)', true);
      return;
    }
    if (product?.pool_name && normPoolName(product.pool_name) !== pool.key) {
      const ok = await confirmDialog({ title: 'Confirm', message: `“${product.name}” is already in pool “${product.pool_name}”. Move it to “${pool.name}”?`,, confirmLabel: 'Confirm', danger: true });
      if (!ok) return;
    }
    const btn = $('vpAddBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Adding…';
    }
    try {
      await setProductPool(pendingAddId, pool.name, fractionText);
      await refresh();
      toast('Product added to pool');
    } catch (err) {
      toast(err.message || 'Add failed', true);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Add';
      }
    }
  }

  async function renamePool(oldName, newName) {
    const DB = getDB();
    const enc = DB._.enc;
    await DB.update('products', 'pool_name=eq.' + enc(oldName), { pool_name: newName });
    try {
      await DB.update('recipe_ingredients', 'pool_name=eq.' + enc(oldName), { pool_name: newName });
    } catch {
      // Recipe table may be empty / unavailable — product rename still matters.
    }
  }

  async function clearPool(name) {
    const DB = getDB();
    const enc = DB._.enc;
    await DB.update('products', 'pool_name=eq.' + enc(name), {
      pool_name: null,
      pool_servings_per_unit: null,
      pool_servings_text: null,
    });
  }

  async function saveNewPool(editName) {
    const name = ($('vpName')?.value || '').trim();
    if (!name) {
      $('vpErr').textContent = 'Pool name is required.';
      return;
    }
    const key = normPoolName(name);
    const clash = pools.find((p) => p.key === key && (!editName || normPoolName(editName) !== key));
    if (clash) {
      $('vpErr').textContent = 'A pool with that name already exists.';
      return;
    }

    const btn = $('vpSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      if (editName && normPoolName(editName) !== key) {
        await renamePool(editName, name);
        selectedKey = key;
        closeSheet();
        await refresh();
        toast('Pool renamed');
        return;
      }

      if (editName) {
        closeSheet();
        toast('No changes');
        return;
      }

      const productId = pendingCreateId;
      if (!productId) {
        $('vpErr').textContent = 'Add at least one product to create the pool.';
        return;
      }
      const product = products.find((p) => p.id === productId);
      const fractionText = createFraction?.getValue() || '';
      if (!poolServingsFromFraction(fractionText, product, caseSizes)) {
        $('vpErr').textContent = 'Enter a valid fraction (e.g. 1/24).';
        return;
      }
      if (product?.pool_name && normPoolName(product.pool_name) !== key) {
        const ok = await confirmDialog({ title: 'Confirm', message: `“${product.name}” is already in pool “${product.pool_name}”. Move it here?`,, confirmLabel: 'Confirm', danger: true });
        if (!ok) return;
      }
      await setProductPool(productId, name, fractionText);
      selectedKey = key;
      closeSheet();
      await refresh();
      toast('Volume pool created');
    } catch (err) {
      $('vpErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editName ? 'Update pool' : 'Create pool';
    }
  }

  let pendingCreateId = null;

  async function deletePool(name) {
    if (!(await confirmDialog({ title: 'Confirm', message: `Delete volume pool “${name}”? Products stay in the library but are unlinked.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await clearPool(name);
      if (selectedKey === normPoolName(name)) selectedKey = null;
      closeSheet();
      await refresh();
      toast('Pool deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openPoolForm(editName) {
    const editing = !!(editName && String(editName).trim());
    pendingCreateId = null;
    createFraction = null;

    openSheet({
      title: editing ? 'Edit volume pool' : 'New volume pool',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="vpErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="vpName">Pool name</label>
            <input class="admin-input" type="text" id="vpName" required
              placeholder="e.g. Lemon-lime soft, House Vodka">
          </div>
          ${editing ? '' : `
            <div class="admin-field">
              <label class="admin-label">First product</label>
              <div id="vpCreateSearch"></div>
            </div>
            <div class="admin-field">
              <label class="admin-label" for="vpCreateFraction">Fraction / serving</label>
              <div id="vpCreateFractionMount"></div>
              <p class="wst-form-hint muted">Fraction of one case/SKU per serving — e.g. 1/24, 1/12, 1/28. Stays as typed.</p>
            </div>
          `}
          <p class="wst-form-hint muted">
            Products in a pool are interchangeable for till mapping. Pack sizes stay on each product;
            the fraction is how you declare that a 12-pack serving differs from a 24-pack.
          </p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${editing ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="vpDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="vpCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="vpSave">${editing ? 'Update pool' : 'Create pool'}</button>
          </div>
        </div>`,
    });

    if (editing) {
      $('vpName').value = editName;
    } else {
      const fracMount = $('vpCreateFractionMount');
      createFraction = fracMount
        ? mountFractionInput(fracMount, { value: '1', placeholder: 'e.g. 1/24', id: 'vpCreateFraction' })
        : null;
      const mount = $('vpCreateSearch');
      if (mount) {
        mountProductSearch(mount, {
          products,
          caseSizes,
          placeholder: 'Search product…',
          onSelect: ({ productId, product }) => {
            pendingCreateId = productId || null;
            if (createFraction && product) {
              createFraction.setValue(defaultPoolFractionText(product, caseSizes));
            }
          },
        });
      }
    }

    $('vpCancel').onclick = closeSheet;
    $('vpSave').onclick = async () => saveNewPool(editing ? editName : null);
    if (editing) $('vpDelete').onclick = async () => deletePool(editName);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-volume-pool') {
      e.detail.handled = true;
      openPoolForm();
    }
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}function currentPool() {
    return selectedKey ? pools.find((p) => p.key === selectedKey) : null;
  }

  function memberIdsInSelected() {
    return new Set((currentPool()?.members || []).map((p) => p.id));
  }

  function paintList() {
    listEl.innerHTML = renderListItems(pools, selectedKey, searchQuery, caseSizes);
    listEl.querySelectorAll('[data-vp-key]').forEach((btn) => {
      btn.onclick = async () => selectPool(btn.dataset.vpKey);
    });
  }

  function wireDetail() {
    memberFractions.clear();
    $('vpEditBtn')?.addEventListener('click', async () => openPoolForm(currentPool()?.name));

    detailBody.querySelectorAll('[data-vp-fraction]').forEach((mount) => {
      const productId = mount.dataset.vpFraction;
      const frac = mountFractionInput(mount, {
        value: mount.dataset.initial || '1',
        placeholder: 'e.g. 1/24',
      });
      memberFractions.set(productId, frac);
      const input = frac.root.querySelector('input');
      input?.setAttribute('aria-label', 'Fraction of case per serving');
      const save = () => saveFraction(productId, frac.getValue());
      input?.addEventListener('change', save);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    detailBody.querySelectorAll('[data-vp-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => removeMember(btn.dataset.vpRemove));
    });

    const addMount = $('vpAddFractionMount');
    addFraction = addMount
      ? mountFractionInput(addMount, { value: '1', placeholder: 'e.g. 1/24', id: 'vpAddFraction' })
      : null;

    mountAddSearch();
    $('vpAddBtn')?.addEventListener('click', async () => addMember());
  }

  function mountAddSearch() {
    const mount = $('vpAddSearch');
    if (!mount) return;
    mount.innerHTML = '';
    pendingAddId = null;
    const inPool = memberIdsInSelected();
    const available = products.filter((p) => !inPool.has(p.id));

    mountProductSearch(mount, {
      products: available,
      caseSizes,
      placeholder: 'Search products to add…',
      onSelect: ({ productId, product }) => {
        pendingAddId = productId || null;
        if (addFraction && product) {
          addFraction.setValue(defaultPoolFractionText(product, caseSizes));
        }
        const addBtn = $('vpAddBtn');
        if (addBtn) addBtn.disabled = !pendingAddId;
        const hint = $('vpAddHint');
        if (hint && product) {
          const pack = packLabel(product, caseSizes);
          const upc = productStockPack(product, caseSizes).unitsPerCase || 1;
          const frac = defaultPoolFractionText(product, caseSizes);
          hint.textContent = `${product.name} · ${pack} · ${upc} units/case · default ${frac}`;
        }
      },
    });
  }

  function paintDetail() {
    const pool = currentPool();
    if (!pool) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(pool, caseSizes);
    wireDetail();
  }

  function selectPool(key) {
    selectedKey = key;
    paintList();
    paintDetail();
  }

  async function refresh() {
    [products, caseSizes] = await Promise.all([
      loadLibraryProducts(),
      loadCaseSizes(),
    ]);
    pools = groupProductsByPool(products);
    if (selectedKey && !pools.some((p) => p.key === selectedKey)) {
      selectedKey = pools[0]?.key || null;
    }
    if (!selectedKey && pools.length === 1) {
      selectedKey = pools[0].key;
    }
    paintList();
    paintDetail();
  }

  async function setProductPool(productId, poolName, fractionText) {
    const product = products.find((p) => p.id === productId);
    if (!product && poolName) throw new Error('Product not found');

    let patch;
    if (!poolName) {
      patch = {
        pool_name: null,
        pool_servings_per_unit: null,
        pool_servings_text: null,
      };
    } else {
      const derived = poolServingsFromFraction(fractionText, product, caseSizes);
      if (!derived) throw new Error('Enter a valid fraction (e.g. 1/24)');
      patch = {
        pool_name: poolName,
        pool_servings_per_unit: derived.pool_servings_per_unit,
        pool_servings_text: derived.pool_servings_text,
      };
    }

    await getDB().products.update(productId, patch);
    const local = products.find((p) => p.id === productId);
    if (local) {
      Object.assign(local, patch);
    }
    return patch;
  }

  async function saveFraction(productId, raw) {
    const pool = currentPool();
    if (!pool) return;
    try {
      const patch = await setProductPool(productId, pool.name, raw);
      const perCaseEl = detailBody.querySelector(`[data-vp-per-case="${productId}"]`);
      if (perCaseEl) {
        const product = products.find((p) => p.id === productId);
        perCaseEl.textContent = formatServingsPerCase(servingsPerCase(product, caseSizes));
      }
      const frac = memberFractions.get(productId);
      if (frac && patch.pool_servings_text) frac.setValue(patch.pool_servings_text);
      paintList();
    } catch (err) {
      toast(err.message || 'Failed to update fraction', true);
      await refresh();
    }
  }

  async function removeMember(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    if (!(await confirmDialog({ title: 'Confirm', message: `Remove “${product.name}” from this volume pool?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await setProductPool(productId, null, null);
      await refresh();
      toast('Removed from pool');
    } catch (err) {
      toast(err.message || 'Remove failed', true);
    }
  }

  async function addMember() {
    const pool = currentPool();
    if (!pool || !pendingAddId) return;
    const fractionText = addFraction?.getValue() || '';
    const product = products.find((p) => p.id === pendingAddId);
    if (!poolServingsFromFraction(fractionText, product, caseSizes)) {
      toast('Enter a valid fraction (e.g. 1/24)', true);
      return;
    }
    if (product?.pool_name && normPoolName(product.pool_name) !== pool.key) {
      const ok = await confirmDialog({ title: 'Confirm', message: `“${product.name}” is already in pool “${product.pool_name}”. Move it to “${pool.name}”?`,, confirmLabel: 'Confirm', danger: true });
      if (!ok) return;
    }
    const btn = $('vpAddBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Adding…';
    }
    try {
      await setProductPool(pendingAddId, pool.name, fractionText);
      await refresh();
      toast('Product added to pool');
    } catch (err) {
      toast(err.message || 'Add failed', true);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Add';
      }
    }
  }

  async function renamePool(oldName, newName) {
    const DB = getDB();
    const enc = DB._.enc;
    await DB.update('products', 'pool_name=eq.' + enc(oldName), { pool_name: newName });
    try {
      await DB.update('recipe_ingredients', 'pool_name=eq.' + enc(oldName), { pool_name: newName });
    } catch {
      // Recipe table may be empty / unavailable — product rename still matters.
    }
  }

  async function clearPool(name) {
    const DB = getDB();
    const enc = DB._.enc;
    await DB.update('products', 'pool_name=eq.' + enc(name), {
      pool_name: null,
      pool_servings_per_unit: null,
      pool_servings_text: null,
    });
  }

  async function saveNewPool(editName) {
    const name = ($('vpName')?.value || '').trim();
    if (!name) {
      $('vpErr').textContent = 'Pool name is required.';
      return;
    }
    const key = normPoolName(name);
    const clash = pools.find((p) => p.key === key && (!editName || normPoolName(editName) !== key));
    if (clash) {
      $('vpErr').textContent = 'A pool with that name already exists.';
      return;
    }

    const btn = $('vpSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      if (editName && normPoolName(editName) !== key) {
        await renamePool(editName, name);
        selectedKey = key;
        closeSheet();
        await refresh();
        toast('Pool renamed');
        return;
      }

      if (editName) {
        closeSheet();
        toast('No changes');
        return;
      }

      const productId = pendingCreateId;
      if (!productId) {
        $('vpErr').textContent = 'Add at least one product to create the pool.';
        return;
      }
      const product = products.find((p) => p.id === productId);
      const fractionText = createFraction?.getValue() || '';
      if (!poolServingsFromFraction(fractionText, product, caseSizes)) {
        $('vpErr').textContent = 'Enter a valid fraction (e.g. 1/24).';
        return;
      }
      if (product?.pool_name && normPoolName(product.pool_name) !== key) {
        const ok = await confirmDialog({ title: 'Confirm', message: `“${product.name}” is already in pool “${product.pool_name}”. Move it here?`,, confirmLabel: 'Confirm', danger: true });
        if (!ok) return;
      }
      await setProductPool(productId, name, fractionText);
      selectedKey = key;
      closeSheet();
      await refresh();
      toast('Volume pool created');
    } catch (err) {
      $('vpErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editName ? 'Update pool' : 'Create pool';
    }
  }

  let pendingCreateId = null;

  async function deletePool(name) {
    if (!(await confirmDialog({ title: 'Confirm', message: `Delete volume pool “${name}”? Products stay in the library but are unlinked.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await clearPool(name);
      if (selectedKey === normPoolName(name)) selectedKey = null;
      closeSheet();
      await refresh();
      toast('Pool deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openPoolForm(editName) {
    const editing = !!(editName && String(editName).trim());
    pendingCreateId = null;
    createFraction = null;

    openSheet({
      title: editing ? 'Edit volume pool' : 'New volume pool',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="vpErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="vpName">Pool name</label>
            <input class="admin-input" type="text" id="vpName" required
              placeholder="e.g. Lemon-lime soft, House Vodka">
          </div>
          ${editing ? '' : `
            <div class="admin-field">
              <label class="admin-label">First product</label>
              <div id="vpCreateSearch"></div>
            </div>
            <div class="admin-field">
              <label class="admin-label" for="vpCreateFraction">Fraction / serving</label>
              <div id="vpCreateFractionMount"></div>
              <p class="wst-form-hint muted">Fraction of one case/SKU per serving — e.g. 1/24, 1/12, 1/28. Stays as typed.</p>
            </div>
          `}
          <p class="wst-form-hint muted">
            Products in a pool are interchangeable for till mapping. Pack sizes stay on each product;
            the fraction is how you declare that a 12-pack serving differs from a 24-pack.
          </p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${editing ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="vpDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="vpCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="vpSave">${editing ? 'Update pool' : 'Create pool'}</button>
          </div>
        </div>`,
    });

    if (editing) {
      $('vpName').value = editName;
    } else {
      const fracMount = $('vpCreateFractionMount');
      createFraction = fracMount
        ? mountFractionInput(fracMount, { value: '1', placeholder: 'e.g. 1/24', id: 'vpCreateFraction' })
        : null;
      const mount = $('vpCreateSearch');
      if (mount) {
        mountProductSearch(mount, {
          products,
          caseSizes,
          placeholder: 'Search product…',
          onSelect: ({ productId, product }) => {
            pendingCreateId = productId || null;
            if (createFraction && product) {
              createFraction.setValue(defaultPoolFractionText(product, caseSizes));
            }
          },
        });
      }
    }

    $('vpCancel').onclick = closeSheet;
    $('vpSave').onclick = async () => saveNewPool(editing ? editName : null);
    if (editing) $('vpDelete').onclick = async () => deletePool(editName);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-volume-pool') {
      e.detail.handled = true;
      openPoolForm();
    }
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}function currentPool() {
    return selectedKey ? pools.find((p) => p.key === selectedKey) : null;
  }

  function memberIdsInSelected() {
    return new Set((currentPool()?.members || []).map((p) => p.id));
  }

  function paintList() {
    listEl.innerHTML = renderListItems(pools, selectedKey, searchQuery, caseSizes);
    listEl.querySelectorAll('[data-vp-key]').forEach((btn) => {
      btn.onclick = async () => selectPool(btn.dataset.vpKey);
    });
  }

  function wireDetail() {
    memberFractions.clear();
    $('vpEditBtn')?.addEventListener('click', async () => openPoolForm(currentPool()?.name));

    detailBody.querySelectorAll('[data-vp-fraction]').forEach((mount) => {
      const productId = mount.dataset.vpFraction;
      const frac = mountFractionInput(mount, {
        value: mount.dataset.initial || '1',
        placeholder: 'e.g. 1/24',
      });
      memberFractions.set(productId, frac);
      const input = frac.root.querySelector('input');
      input?.setAttribute('aria-label', 'Fraction of case per serving');
      const save = () => saveFraction(productId, frac.getValue());
      input?.addEventListener('change', save);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    detailBody.querySelectorAll('[data-vp-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => removeMember(btn.dataset.vpRemove));
    });

    const addMount = $('vpAddFractionMount');
    addFraction = addMount
      ? mountFractionInput(addMount, { value: '1', placeholder: 'e.g. 1/24', id: 'vpAddFraction' })
      : null;

    mountAddSearch();
    $('vpAddBtn')?.addEventListener('click', async () => addMember());
  }

  function mountAddSearch() {
    const mount = $('vpAddSearch');
    if (!mount) return;
    mount.innerHTML = '';
    pendingAddId = null;
    const inPool = memberIdsInSelected();
    const available = products.filter((p) => !inPool.has(p.id));

    mountProductSearch(mount, {
      products: available,
      caseSizes,
      placeholder: 'Search products to add…',
      onSelect: ({ productId, product }) => {
        pendingAddId = productId || null;
        if (addFraction && product) {
          addFraction.setValue(defaultPoolFractionText(product, caseSizes));
        }
        const addBtn = $('vpAddBtn');
        if (addBtn) addBtn.disabled = !pendingAddId;
        const hint = $('vpAddHint');
        if (hint && product) {
          const pack = packLabel(product, caseSizes);
          const upc = productStockPack(product, caseSizes).unitsPerCase || 1;
          const frac = defaultPoolFractionText(product, caseSizes);
          hint.textContent = `${product.name} · ${pack} · ${upc} units/case · default ${frac}`;
        }
      },
    });
  }

  function paintDetail() {
    const pool = currentPool();
    if (!pool) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(pool, caseSizes);
    wireDetail();
  }

  function selectPool(key) {
    selectedKey = key;
    paintList();
    paintDetail();
  }

  async function refresh() {
    [products, caseSizes] = await Promise.all([
      loadLibraryProducts(),
      loadCaseSizes(),
    ]);
    pools = groupProductsByPool(products);
    if (selectedKey && !pools.some((p) => p.key === selectedKey)) {
      selectedKey = pools[0]?.key || null;
    }
    if (!selectedKey && pools.length === 1) {
      selectedKey = pools[0].key;
    }
    paintList();
    paintDetail();
  }

  async function setProductPool(productId, poolName, fractionText) {
    const product = products.find((p) => p.id === productId);
    if (!product && poolName) throw new Error('Product not found');

    let patch;
    if (!poolName) {
      patch = {
        pool_name: null,
        pool_servings_per_unit: null,
        pool_servings_text: null,
      };
    } else {
      const derived = poolServingsFromFraction(fractionText, product, caseSizes);
      if (!derived) throw new Error('Enter a valid fraction (e.g. 1/24)');
      patch = {
        pool_name: poolName,
        pool_servings_per_unit: derived.pool_servings_per_unit,
        pool_servings_text: derived.pool_servings_text,
      };
    }

    await getDB().products.update(productId, patch);
    const local = products.find((p) => p.id === productId);
    if (local) {
      Object.assign(local, patch);
    }
    return patch;
  }

  async function saveFraction(productId, raw) {
    const pool = currentPool();
    if (!pool) return;
    try {
      const patch = await setProductPool(productId, pool.name, raw);
      const perCaseEl = detailBody.querySelector(`[data-vp-per-case="${productId}"]`);
      if (perCaseEl) {
        const product = products.find((p) => p.id === productId);
        perCaseEl.textContent = formatServingsPerCase(servingsPerCase(product, caseSizes));
      }
      const frac = memberFractions.get(productId);
      if (frac && patch.pool_servings_text) frac.setValue(patch.pool_servings_text);
      paintList();
    } catch (err) {
      toast(err.message || 'Failed to update fraction', true);
      await refresh();
    }
  }

  async function removeMember(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    if (!(await confirmDialog({ title: 'Confirm', message: `Remove “${product.name}” from this volume pool?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await setProductPool(productId, null, null);
      await refresh();
      toast('Removed from pool');
    } catch (err) {
      toast(err.message || 'Remove failed', true);
    }
  }

  async function addMember() {
    const pool = currentPool();
    if (!pool || !pendingAddId) return;
    const fractionText = addFraction?.getValue() || '';
    const product = products.find((p) => p.id === pendingAddId);
    if (!poolServingsFromFraction(fractionText, product, caseSizes)) {
      toast('Enter a valid fraction (e.g. 1/24)', true);
      return;
    }
    if (product?.pool_name && normPoolName(product.pool_name) !== pool.key) {
      const ok = await confirmDialog({ title: 'Confirm', message: `“${product.name}” is already in pool “${product.pool_name}”. Move it to “${pool.name}”?`,, confirmLabel: 'Confirm', danger: true });
      if (!ok) return;
    }
    const btn = $('vpAddBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Adding…';
    }
    try {
      await setProductPool(pendingAddId, pool.name, fractionText);
      await refresh();
      toast('Product added to pool');
    } catch (err) {
      toast(err.message || 'Add failed', true);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Add';
      }
    }
  }

  async function renamePool(oldName, newName) {
    const DB = getDB();
    const enc = DB._.enc;
    await DB.update('products', 'pool_name=eq.' + enc(oldName), { pool_name: newName });
    try {
      await DB.update('recipe_ingredients', 'pool_name=eq.' + enc(oldName), { pool_name: newName });
    } catch {
      // Recipe table may be empty / unavailable — product rename still matters.
    }
  }

  async function clearPool(name) {
    const DB = getDB();
    const enc = DB._.enc;
    await DB.update('products', 'pool_name=eq.' + enc(name), {
      pool_name: null,
      pool_servings_per_unit: null,
      pool_servings_text: null,
    });
  }

  async function saveNewPool(editName) {
    const name = ($('vpName')?.value || '').trim();
    if (!name) {
      $('vpErr').textContent = 'Pool name is required.';
      return;
    }
    const key = normPoolName(name);
    const clash = pools.find((p) => p.key === key && (!editName || normPoolName(editName) !== key));
    if (clash) {
      $('vpErr').textContent = 'A pool with that name already exists.';
      return;
    }

    const btn = $('vpSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      if (editName && normPoolName(editName) !== key) {
        await renamePool(editName, name);
        selectedKey = key;
        closeSheet();
        await refresh();
        toast('Pool renamed');
        return;
      }

      if (editName) {
        closeSheet();
        toast('No changes');
        return;
      }

      const productId = pendingCreateId;
      if (!productId) {
        $('vpErr').textContent = 'Add at least one product to create the pool.';
        return;
      }
      const product = products.find((p) => p.id === productId);
      const fractionText = createFraction?.getValue() || '';
      if (!poolServingsFromFraction(fractionText, product, caseSizes)) {
        $('vpErr').textContent = 'Enter a valid fraction (e.g. 1/24).';
        return;
      }
      if (product?.pool_name && normPoolName(product.pool_name) !== key) {
        const ok = await confirmDialog({ title: 'Confirm', message: `“${product.name}” is already in pool “${product.pool_name}”. Move it here?`,, confirmLabel: 'Confirm', danger: true });
        if (!ok) return;
      }
      await setProductPool(productId, name, fractionText);
      selectedKey = key;
      closeSheet();
      await refresh();
      toast('Volume pool created');
    } catch (err) {
      $('vpErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editName ? 'Update pool' : 'Create pool';
    }
  }

  let pendingCreateId = null;

  async function deletePool(name) {
    if (!(await confirmDialog({ title: 'Confirm', message: `Delete volume pool “${name}”? Products stay in the library but are unlinked.`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await clearPool(name);
      if (selectedKey === normPoolName(name)) selectedKey = null;
      closeSheet();
      await refresh();
      toast('Pool deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openPoolForm(editName) {
    const editing = !!(editName && String(editName).trim());
    pendingCreateId = null;
    createFraction = null;

    openSheet({
      title: editing ? 'Edit volume pool' : 'New volume pool',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="vpErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="vpName">Pool name</label>
            <input class="admin-input" type="text" id="vpName" required
              placeholder="e.g. Lemon-lime soft, House Vodka">
          </div>
          ${editing ? '' : `
            <div class="admin-field">
              <label class="admin-label">First product</label>
              <div id="vpCreateSearch"></div>
            </div>
            <div class="admin-field">
              <label class="admin-label" for="vpCreateFraction">Fraction / serving</label>
              <div id="vpCreateFractionMount"></div>
              <p class="wst-form-hint muted">Fraction of one case/SKU per serving — e.g. 1/24, 1/12, 1/28. Stays as typed.</p>
            </div>
          `}
          <p class="wst-form-hint muted">
            Products in a pool are interchangeable for till mapping. Pack sizes stay on each product;
            the fraction is how you declare that a 12-pack serving differs from a 24-pack.
          </p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${editing ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="vpDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="vpCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="vpSave">${editing ? 'Update pool' : 'Create pool'}</button>
          </div>
        </div>`,
    });

    if (editing) {
      $('vpName').value = editName;
    } else {
      const fracMount = $('vpCreateFractionMount');
      createFraction = fracMount
        ? mountFractionInput(fracMount, { value: '1', placeholder: 'e.g. 1/24', id: 'vpCreateFraction' })
        : null;
      const mount = $('vpCreateSearch');
      if (mount) {
        mountProductSearch(mount, {
          products,
          caseSizes,
          placeholder: 'Search product…',
          onSelect: ({ productId, product }) => {
            pendingCreateId = productId || null;
            if (createFraction && product) {
              createFraction.setValue(defaultPoolFractionText(product, caseSizes));
            }
          },
        });
      }
    }

    $('vpCancel').onclick = closeSheet;
    $('vpSave').onclick = async () => saveNewPool(editing ? editName : null);
    if (editing) $('vpDelete').onclick = async () => deletePool(editName);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-volume-pool') {
      e.detail.handled = true;
      openPoolForm();
    }
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}
