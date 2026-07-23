/**
 * Admin product library — sortable table + sheet form (pack, offers, pool).
 */

import { $, escapeHtml, rid, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadLibraryProducts, loadCategories, loadSuppliers, loadCaseSizes,
} from '../../db.js';
import { productStockPack } from '../../pack-metrics.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';

const STOCK_UNIT_OPTS = [
  { value: '', label: 'Auto-detect' },
  { value: 'case', label: 'Cases' },
  { value: 'single', label: 'Singles' },
  { value: 'bottle', label: 'Bottles' },
  { value: 'keg', label: 'Kegs' },
  { value: 'unit', label: 'Units' },
];

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function displayOfferPrice(row) {
  if (row?.case_price != null) return row.case_price;
  if (row?.unit_price != null) return row.unit_price;
  return '';
}

function splitOfferPrice(price, unitsPerCase) {
  if (price == null || price === '' || !Number.isFinite(Number(price))) {
    return { case_price: null, unit_price: null };
  }
  const n = Number(price);
  const upc = Number(unitsPerCase) > 0 ? Number(unitsPerCase) : 1;
  return { case_price: n, unit_price: n / upc };
}

function caseSizeSummary(cs) {
  if (!cs) return '';
  const parts = [];
  if (cs.units_per_case) parts.push(`${cs.units_per_case} per case`);
  if (cs.stock_unit) parts.push(cs.stock_unit);
  if (cs.servings_per_unit != null) parts.push(`${cs.servings_per_unit} servings`);
  return parts.join(' · ') || cs.label || '';
}

function stockUnitLabel(p, caseSizes) {
  if (p.stock_unit) {
    return STOCK_UNIT_OPTS.find((o) => o.value === p.stock_unit)?.label || p.stock_unit;
  }
  const pack = productStockPack(p, caseSizes);
  const map = { case: 'Cases', bottle: 'Bottles', keg: 'Kegs', unit: 'Units', single: 'Singles' };
  return map[pack.stockUnit] || 'Cases';
}

function preferredSupplier(p) {
  const offers = p.product_suppliers || [];
  const pref = offers.find((o) => o.is_preferred) || offers[0];
  if (pref?.supplier?.name) return pref.supplier.name;
  return p.supplier?.name || '';
}

function supplierCellHtml(p) {
  const name = preferredSupplier(p);
  const extra = Math.max(0, (p.product_suppliers?.length || 0) - 1);
  if (!extra) return escapeHtml(name);
  return `${escapeHtml(name)} <span class="catalog-tag">+${extra}</span>`;
}

function categoryBadge(cat) {
  if (!cat?.name) return '<span class="muted">—</span>';
  return `<span class="lib-cat-badge">${escapeHtml(cat.name)}</span>`;
}

function sortValue(p, key, caseSizes) {
  switch (key) {
    case 'category': return (p.category?.name) || '';
    case 'supplier': return preferredSupplier(p);
    case 'units_per_case': return Number(p.units_per_case) || 0;
    case 'stock_unit': return stockUnitLabel(p, caseSizes);
    case 'case_price': return Number(p.case_price) || 0;
    case 'unit_price': return Number(p.unit_price) || 0;
    case 'case_size': return p.case_size || productStockPack(p, caseSizes).label || '';
    default: return String(p[key] || '').toLowerCase();
  }
}

function productHaystack(p, caseSizes) {
  const pack = productStockPack(p, caseSizes);
  return [
    p.name, p.sku, p.case_size, pack.label,
    p.category?.name, preferredSupplier(p),
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderShell() {
  return `
    <div class="admin-page lib-panel">
      <div class="lib-toolbar">
        <select class="admin-select lib-filter" id="libCategory" aria-label="Filter by category">
          <option value="">All categories</option>
        </select>
        <select class="admin-select lib-filter" id="libSupplier" aria-label="Filter by supplier">
          <option value="">All suppliers</option>
        </select>
        <span class="lib-count muted" id="libCount"></span>
      </div>
      <div class="lib-table-wrap admin-surface">
        <table class="lib-table" id="libTable">
          <thead>
            <tr>
              <th data-sort="name">Product</th>
              <th data-sort="case_size">Stock pack</th>
              <th data-sort="stock_unit">Count as</th>
              <th data-sort="category">Category</th>
              <th data-sort="supplier">Supplier</th>
              <th class="lib-num" data-sort="units_per_case">Units/case</th>
              <th class="lib-num" data-sort="case_price">Case £</th>
              <th class="lib-num" data-sort="unit_price">Unit £</th>
              <th class="lib-act"></th>
            </tr>
          </thead>
          <tbody id="libBody">
            <tr><td colspan="9" class="lib-loading muted">Loading products…</td></tr>
          </tbody>
        </table>
        <div class="lib-empty" id="libEmpty" hidden>No products match.</div>
      </div>
    </div>`;
}

function renderTableRows(rows, caseSizes, sortKey, sortDir) {
  const sorted = rows.slice().sort((a, b) => {
    const av = sortValue(a, sortKey, caseSizes);
    const bv = sortValue(b, sortKey, caseSizes);
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sortDir;
    }
    const cmp = String(av).localeCompare(String(bv));
    return cmp * sortDir;
  });

  return sorted.map((p) => {
    const pack = productStockPack(p, caseSizes);
    const packLabel = pack.label || p.case_size || '';
    const countAs = stockUnitLabel(p, caseSizes);
    const auto = !p.stock_unit ? ' <span class="muted lib-auto-tag">auto</span>' : '';
    return `
      <tr data-pid="${escapeHtml(p.id)}" data-product-name="${escapeHtml((p.name || '').toLowerCase())}">
        <td><span class="lib-prod-name">${escapeHtml(p.name || 'Product')}</span></td>
        <td>${escapeHtml(packLabel)}</td>
        <td>${escapeHtml(countAs)}${auto}</td>
        <td>${categoryBadge(p.category)}</td>
        <td>${supplierCellHtml(p)}</td>
        <td class="lib-num">${p.units_per_case != null ? escapeHtml(String(p.units_per_case)) : '—'}</td>
        <td class="lib-num">${fmtMoney(p.case_price) || '—'}</td>
        <td class="lib-num">${fmtMoney(p.unit_price) || '—'}</td>
        <td class="lib-act">
          <button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(p.id)}"
            title="Edit product" aria-label="Edit ${escapeHtml(p.name || 'product')}">
            ${icon('pencil', { size: 16 })}
          </button>
        </td>
      </tr>`;
  }).join('');
}

export function renderLibraryShell() {
  return renderShell();
}

export function mountLibraryPanel() {
  const bodyEl = $('libBody');
  const emptyEl = $('libEmpty');
  const countEl = $('libCount');
  const catSel = $('libCategory');
  const supSel = $('libSupplier');
  const tableEl = $('libTable');
  if (!bodyEl) return () => {};

  let products = [];
  let categories = [];
  let suppliers = [];
  let caseSizes = [];
  let sortKey = 'name';
  let sortDir = 1;
  let filterCat = '';
  let filterSup = '';
  let productFilter = getLastProductFilter();
  let offerPrefName = `libPref_${rid('p')}`;
  let offerLines = [];

  function filteredProducts() {
    const q = (productFilter.query || '').trim().toLowerCase();
    const pid = productFilter.productId;
    return products.filter((p) => {
      if (filterCat && p.category?.name !== filterCat) return false;
      if (filterSup && preferredSupplier(p) !== filterSup) return false;
      if (pid) return p.id === pid;
      if (!q) return true;
      return productHaystack(p, caseSizes).includes(q);
    });
  }

  function updateSortHeaders() {
    tableEl?.querySelectorAll('th[data-sort]').forEach((th) => {
      const key = th.dataset.sort;
      th.classList.toggle('lib-sort-active', key === sortKey);
      th.dataset.sortDir = key === sortKey ? String(sortDir) : '';
    });
  }

  function paintTable() {
    const rows = filteredProducts();
    if (countEl) {
      countEl.textContent = `${rows.length} of ${products.length} product${products.length !== 1 ? 's' : ''}`;
    }
    if (!rows.length) {
      bodyEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (tableEl) tableEl.hidden = true;
    } else {
      if (emptyEl) emptyEl.hidden = true;
      if (tableEl) tableEl.hidden = false;
      bodyEl.innerHTML = renderTableRows(rows, caseSizes, sortKey, sortDir);
      bodyEl.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          openProductForm(btn.dataset.edit);
        };
      });
      bodyEl.querySelectorAll('tr[data-pid]').forEach((row) => {
        row.classList.add('lib-row--clickable');
        row.onclick = () => openProductForm(row.dataset.pid);
        row.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openProductForm(row.dataset.pid);
          }
        };
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.title = 'Edit product';
      });
    }
    updateSortHeaders();

    if (productFilter.productId) {
      const target = bodyEl.querySelector(`[data-pid="${productFilter.productId}"]`);
      target?.scrollIntoView({ block: 'nearest' });
    }
  }

  function populateFilters() {
    const cats = [...new Set(products.map((p) => p.category?.name).filter(Boolean))].sort();
    const sups = [...new Set(products.map((p) => preferredSupplier(p)).filter(Boolean))].sort();
    if (catSel) {
      const cur = catSel.value;
      catSel.innerHTML = '<option value="">All categories</option>' +
        cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
      catSel.value = cats.includes(cur) ? cur : '';
      filterCat = catSel.value;
    }
    if (supSel) {
      const cur = supSel.value;
      supSel.innerHTML = '<option value="">All suppliers</option>' +
        sups.map((s) => `<option>${escapeHtml(s)}</option>`).join('');
      supSel.value = sups.includes(cur) ? cur : '';
      filterSup = supSel.value;
    }
  }

  function offerRowHtml(row = {}) {
    const supOpts = suppliers.map((s) =>
      `<option value="${escapeHtml(s.id)}"${s.id === row.supplier_id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    const priceVal = displayOfferPrice(row);
    return `
      <div class="lib-offer-row" data-offer-id="${rid('o')}">
        <select class="admin-select lib-offer-sup">
          <option value="">— supplier —</option>
          ${supOpts}
        </select>
        <input type="number" step="any" min="0" class="admin-input lib-offer-price" placeholder="Price £"
          value="${priceVal !== '' ? escapeHtml(String(priceVal)) : ''}">
        <label class="lib-offer-pref" title="Preferred purchase option">
          <input type="radio" name="${escapeHtml(offerPrefName)}"${row.is_preferred ? ' checked' : ''}>
          <span>Pref</span>
        </label>
        <button type="button" class="topbar-tool lib-offer-remove" aria-label="Remove offer">
          ${icon('x', { size: 14 })}
        </button>
      </div>`;
  }

  function wireOfferRows() {
    const wrap = $('libOffers');
    if (!wrap) return;
    wrap.querySelectorAll('.lib-offer-remove').forEach((btn) => {
      btn.onclick = () => {
        const row = btn.closest('.lib-offer-row');
        const wasPref = row?.querySelector('.lib-offer-pref input')?.checked;
        row?.remove();
        if (wasPref) {
          const first = wrap.querySelector('.lib-offer-pref input');
          if (first) first.checked = true;
        }
        if (!wrap.querySelector('.lib-offer-row')) addOfferRow({ is_preferred: true });
      };
    });
  }

  function addOfferRow(row = {}) {
    const wrap = $('libOffers');
    if (!wrap) return;
    wrap.insertAdjacentHTML('beforeend', offerRowHtml(row));
    wireOfferRows();
  }

  function collectOffers() {
    const wrap = $('libOffers');
    const out = [];
    wrap?.querySelectorAll('.lib-offer-row').forEach((row) => {
      const supplier_id = row.querySelector('.lib-offer-sup')?.value || '';
      const priceV = (row.querySelector('.lib-offer-price')?.value || '').trim();
      const is_preferred = row.querySelector('.lib-offer-pref input')?.checked;
      if (!supplier_id && !priceV) return;
      out.push({
        supplier_id,
        price: priceV === '' ? null : Number(priceV),
        is_preferred: !!is_preferred,
      });
    });
    if (out.length && !out.some((r) => r.is_preferred)) out[0].is_preferred = true;
    return out;
  }

  function validateOffers(rows) {
    if (!rows?.length) return null;
    const seen = new Set();
    for (const r of rows) {
      if (!r.supplier_id) return 'Choose a supplier for each price row (or remove empty rows).';
      const key = r.supplier_id;
      if (seen.has(key)) return 'Duplicate supplier — keep one row per supplier.';
      seen.add(key);
    }
    return null;
  }

  async function saveProduct(editId) {
    const name = ($('libName')?.value || '').trim();
    if (!name) {
      $('libErr').textContent = 'Name is required.';
      return;
    }
    const offers = collectOffers();
    const offerErr = validateOffers(offers);
    if (offerErr) {
      $('libErr').textContent = offerErr;
      return;
    }

    const caseSizeId = $('libCaseSizeId')?.value || null;
    const cs = caseSizeId ? caseSizes.find((c) => c.id === caseSizeId) : null;
    const existing = editId ? products.find((x) => x.id === editId) : null;
    const poolName = ($('libPoolName')?.value || '').trim() || null;

    const patch = {
      name,
      category_id: $('libCategoryId')?.value || null,
      case_size_id: caseSizeId,
      case_size: cs?.label ?? existing?.case_size ?? null,
      units_per_case: cs?.units_per_case != null
        ? Number(cs.units_per_case) || 1
        : (existing?.units_per_case ?? 1),
      stock_unit: cs?.stock_unit ?? existing?.stock_unit ?? null,
      sku: ($('libSku')?.value || '').trim() || null,
      abv: $('libAbv')?.value !== '' ? Number($('libAbv').value) : null,
      pool_name: poolName,
      pool_servings_per_unit: cs?.servings_per_unit != null
        ? Number(cs.servings_per_unit)
        : (existing?.pool_servings_per_unit ?? null),
    };

    const btn = $('libSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      let productId = editId;
      if (editId) {
        await DB.products.update(editId, patch);
      } else {
        const created = await DB.products.create(patch);
        productId = created.id;
      }
      await DB.productSuppliers.replaceForProduct(productId, offers.map((r) => {
        const prices = splitOfferPrice(r.price, patch.units_per_case);
        return {
          supplier_id: r.supplier_id,
          pack_size: (patch.case_size || '').trim(),
          units_per_case: patch.units_per_case,
          case_price: prices.case_price,
          unit_price: prices.unit_price,
          sku: null,
          is_preferred: r.is_preferred,
        };
      }));
      closeSheet();
      await refresh();
      toast(editId ? 'Product updated' : 'Product created');
    } catch (err) {
      $('libErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editId ? 'Update product' : 'Save product';
    }
  }

  async function deleteProduct(id, name) {
    if (!confirm(`Delete “${name}” from your product library? This removes it from every event and cannot be undone.`)) {
      return;
    }
    try {
      await getDB().products.deleteFull(id);
      closeSheet();
      await refresh();
      toast('Product deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openProductForm(editId) {
    const p = editId ? products.find((x) => x.id === editId) : null;
    offerPrefName = `libPref_${rid('p')}`;
    offerLines = p ? (p.product_suppliers || []).map((r) => ({ ...r })) : [];

    const catOpts = [
      '<option value="">— none —</option>',
      ...categories.map((c) =>
        `<option value="${escapeHtml(c.id)}"${c.id === p?.category_id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`),
    ].join('');

    const csOpts = [
      '<option value="">— custom / manual —</option>',
      ...caseSizes.slice().sort((a, b) =>
        (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''))
        .map((cs) =>
          `<option value="${escapeHtml(cs.id)}"${cs.id === (p?.case_size_id || p?.stock_case_size_id) ? ' selected' : ''}>${escapeHtml(cs.label)} — ${escapeHtml(caseSizeSummary(cs))}</option>`),
    ].join('');

    openSheet({
      title: p ? 'Edit product' : 'New product',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="libErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="libName">Name</label>
            <input class="admin-input" type="text" id="libName" required placeholder="Product name">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="libCategoryId">Category</label>
              <select class="admin-select" id="libCategoryId">${catOpts}</select>
            </div>
            <div class="admin-field">
              <label class="admin-label" for="libSku">SKU</label>
              <input class="admin-input" type="text" id="libSku" placeholder="Optional">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="libCaseSizeId">Standard case size</label>
            <select class="admin-select" id="libCaseSizeId">${csOpts}</select>
            <p class="wst-form-hint muted">Stock pack, units per case, count-as, and servings per unit come from the catalogue.</p>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="libAbv">ABV (%)</label>
            <input class="admin-input" type="number" min="0" step="any" id="libAbv" placeholder="Optional">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="libPoolName">Volume pool</label>
            <input class="admin-input" type="text" id="libPoolName" placeholder="e.g. House Vodka">
            <p class="wst-form-hint muted">Optional group for shared bottle stock across products.</p>
          </div>
          <div class="admin-field">
            <span class="admin-label">Suppliers &amp; prices</span>
            <p class="wst-form-hint muted">One row per supplier. Price is per case (or per bottle/keg for singles).</p>
            <div id="libOffers" class="lib-offers"></div>
            <button type="button" class="admin-drawer-btn" id="libAddOffer">+ Add supplier</button>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${p ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="libDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="libCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="libSave">${p ? 'Update product' : 'Save product'}</button>
          </div>
        </div>`,
    });

    if (p) {
      $('libName').value = p.name || '';
      $('libAbv').value = p.abv != null ? String(p.abv) : '';
      $('libPoolName').value = p.pool_name || '';
    }

    const offersWrap = $('libOffers');
    if (offerLines.length) {
      offerLines.slice()
        .sort((a, b) => (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0))
        .forEach((row) => addOfferRow(row));
    } else {
      addOfferRow({ is_preferred: true });
    }

    $('libAddOffer').onclick = () => {
      const first = !offersWrap.querySelector('.lib-offer-row');
      addOfferRow({ is_preferred: first });
    };
    $('libCancel').onclick = closeSheet;
    $('libSave').onclick = () => saveProduct(editId || null);
    if (p) $('libDelete').onclick = () => deleteProduct(p.id, p.name);
  }

  async function refresh() {
    [products, categories, suppliers, caseSizes] = await Promise.all([
      loadLibraryProducts(),
      loadCategories(),
      loadSuppliers(),
      loadCaseSizes(),
    ]);
    populateFilters();
    paintTable();
  }

  catSel?.addEventListener('change', () => {
    filterCat = catSel.value;
    paintTable();
  });
  supSel?.addEventListener('change', () => {
    filterSup = supSel.value;
    paintTable();
  });

  tableEl?.querySelector('thead')?.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (sortKey === key) sortDir *= -1;
    else {
      sortKey = key;
      sortDir = 1;
    }
    paintTable();
  });

  const onProductFilter = (e) => {
    productFilter = e.detail || {};
    paintTable();
    if (e.detail?.productId) e.detail.handled = true;
  };

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-product') {
      e.detail.handled = true;
      openProductForm();
    }
    if (e.detail?.action === 'merge-products') {
      e.detail.handled = true;
      toast('Merge duplicates — coming soon');
    }
  };

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    bodyEl.innerHTML = `<tr><td colspan="9" class="del-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
  });

  return () => {
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}
