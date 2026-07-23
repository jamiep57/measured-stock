/**
 * Admin product library — sortable table + sheet form (pack, offers, pool).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadLibraryProducts, loadCategories, loadSuppliers, loadCaseSizes,
} from '../../db.js';
import { productStockPack } from '../../pack-metrics.js';
import { openProductFormSheet } from '../product-form-sheet.js';
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
        btn.onclick = () => openProductForm(btn.dataset.edit);
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

  function openProductForm(editId) {
    const p = editId ? products.find((x) => x.id === editId) : null;
    openProductFormSheet({
      product: p,
      categories,
      suppliers,
      caseSizes,
      allowDelete: Boolean(p),
      onSaved: async () => { await refresh(); },
      onDeleted: async (id) => {
        await getDB().products.deleteFull(id);
        await refresh();
      },
    });
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
