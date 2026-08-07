/**
 * Admin product library — sortable table + sheet form (pack, offers, pool).
 * Supports merge mode to fold duplicate SKUs into one keeper via merge_products RPC.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadLibraryProducts, loadCategories, loadSuppliers, loadCaseSizes,
} from '../../db.js';
import { productStockPack } from '../../pack-metrics.js';
import { productSupplierSearchText } from '../../components/product-search.js';
import { skeletonTableRows } from '../../components/loading-widget.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openProductFormSheet } from '../product-form-sheet.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
  patchTableFilterState,
} from '../table-filter.js';
import {
  MERGE_FIELD_DEFS,
  buildMergeFieldsPayload,
  defaultMergeFieldSources,
  findDuplicateProductIds,
  mergeOffersPreview,
  pickDefaultKeeper,
} from '../../lib/product-merge.js';

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

function preferredSupplierId(p) {
  const offers = p.product_suppliers || [];
  const pref = offers.find((o) => o.is_preferred) || offers[0];
  if (pref?.supplier_id) return pref.supplier_id;
  if (pref?.supplier?.id) return pref.supplier.id;
  return p.supplier?.id || '';
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
    p.category?.name, preferredSupplier(p), productSupplierSearchText(p),
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderShell() {
  return `
    <div class="admin-page lib-panel">
      <div class="lib-toolbar">
        <span class="lib-count muted" id="libCount"></span>
        <div class="lib-merge-bar" id="libMergeBar" hidden>
          <span class="lib-merge-count" id="libMergeCount">0 selected</span>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="libMergeAuto"
            title="Select products that share a name or SKU">Auto-select duplicates</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="libMergeBtn" disabled>
            Merge selected…
          </button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="libMergeCancel">Cancel</button>
        </div>
      </div>
      <div class="lib-table-wrap admin-surface">
        <table class="lib-table" id="libTable">
          <thead>
            <tr>
              <th class="lib-sel-col" aria-label="Select"></th>
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
            ${skeletonTableRows(10, { rows: 8 })}
          </tbody>
        </table>
        <div class="lib-empty" id="libEmpty" hidden>No products match.</div>
      </div>
    </div>`;
}

function renderTableRows(rows, caseSizes, sortKey, sortDir, mergeMode, selected) {
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
    const isSel = selected.has(p.id);
    const skuMeta = p.sku
      ? `<span class="lib-prod-sku muted">SKU ${escapeHtml(p.sku)}</span>`
      : '';
    return `
      <tr data-pid="${escapeHtml(p.id)}" data-product-name="${escapeHtml((p.name || '').toLowerCase())}"
        class="${isSel ? 'lib-selected' : ''}${mergeMode ? ' lib-row--merge' : ''}">
        <td class="lib-sel-col">
          ${mergeMode ? `<input type="checkbox" class="lib-sel-check" data-sel="${escapeHtml(p.id)}"
            ${isSel ? 'checked' : ''} aria-label="Select ${escapeHtml(p.name || 'product')}">` : ''}
        </td>
        <td>
          <span class="lib-prod-name">${escapeHtml(p.name || 'Product')}</span>
          ${skuMeta}
        </td>
        <td>${escapeHtml(packLabel)}</td>
        <td>${escapeHtml(countAs)}${auto}</td>
        <td>${categoryBadge(p.category)}</td>
        <td>${supplierCellHtml(p)}</td>
        <td class="lib-num">${p.units_per_case != null ? escapeHtml(String(p.units_per_case)) : '—'}</td>
        <td class="lib-num">${fmtMoney(p.case_price) || '—'}</td>
        <td class="lib-num">${fmtMoney(p.unit_price) || '—'}</td>
        <td class="lib-act">
          ${mergeMode ? '' : `<button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(p.id)}"
            title="Edit product" aria-label="Edit ${escapeHtml(p.name || 'product')}">
            ${icon('pencil', { size: 16 })}
          </button>`}
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
  const tableEl = $('libTable');
  const mergeBar = $('libMergeBar');
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
  let mergeMode = false;
  const selected = new Set();

  const seeded = getTableFilterValues('library');
  if (seeded) {
    filterCat = seeded.categoryFilter || '';
    filterSup = seeded.supplierFilter || '';
    sortKey = seeded.sortKey || 'name';
    sortDir = seeded.sortDir === 'desc' ? -1 : 1;
  }

  let mergeChosen = [];
  let mergeKeepId = null;
  let mergeFieldSource = {};

  function supplierNameById(id) {
    return suppliers.find((s) => s.id === id)?.name || '';
  }

  function filteredProducts() {
    const q = (productFilter.query || '').trim().toLowerCase();
    const pid = productFilter.productId;
    return products.filter((p) => {
      if (filterCat && p.category?.name !== filterCat) return false;
      if (filterSup) {
        const sid = preferredSupplierId(p);
        if (filterSup === '__none__') {
          if (sid || preferredSupplier(p)) return false;
        } else if (sid !== filterSup) {
          return false;
        }
      }
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

  function updateMergeBar() {
    const n = selected.size;
    const countNode = $('libMergeCount');
    const mergeBtn = $('libMergeBtn');
    if (countNode) countNode.textContent = `${n} selected`;
    if (mergeBtn) mergeBtn.disabled = n < 2;
  }

  function setMergeMode(on) {
    mergeMode = on;
    selected.clear();
    if (mergeBar) mergeBar.hidden = !mergeMode;
    tableEl?.classList.toggle('merge-mode', mergeMode);
    updateMergeBar();
    paintTable();
  }

  function toggleRowSel(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    updateMergeBar();
    paintTable();
  }

  function paintTable() {
    const rows = filteredProducts();
    if (countEl) {
      countEl.textContent = `${rows.length} of ${products.length} product${products.length !== 1 ? 's' : ''}`;
      countEl.hidden = mergeMode;
    }
    if (!rows.length) {
      bodyEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (tableEl) tableEl.hidden = true;
    } else {
      if (emptyEl) emptyEl.hidden = true;
      if (tableEl) tableEl.hidden = false;
      bodyEl.innerHTML = renderTableRows(rows, caseSizes, sortKey, sortDir, mergeMode, selected);
      bodyEl.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          openProductForm(btn.dataset.edit);
        };
      });
      bodyEl.querySelectorAll('[data-sel]').forEach((input) => {
        input.onchange = (e) => {
          e.stopPropagation();
          const id = input.dataset.sel;
          if (input.checked) selected.add(id);
          else selected.delete(id);
          updateMergeBar();
          input.closest('tr')?.classList.toggle('lib-selected', input.checked);
        };
        input.onclick = (e) => e.stopPropagation();
      });
      if (mergeMode) {
        bodyEl.querySelectorAll('tr[data-pid]').forEach((tr) => {
          tr.onclick = () => toggleRowSel(tr.dataset.pid);
        });
      }
    }
    updateSortHeaders();

    if (productFilter.productId) {
      const target = bodyEl.querySelector(`[data-pid="${productFilter.productId}"]`);
      target?.scrollIntoView({ block: 'nearest' });
    }
  }

  function applyTableFilterValues(values) {
    if (!values) return;
    filterCat = values.categoryFilter || '';
    filterSup = values.supplierFilter || '';
    sortKey = values.sortKey || 'name';
    sortDir = values.sortDir === 'desc' ? -1 : 1;
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

  function renderMergeFieldTable() {
    const box = $('libMergeFieldTable');
    if (!box || !mergeChosen.length) return;
    const nameChecked = (id) => mergeFieldSource.name === id;
    const cols = mergeChosen.map((p) => {
      const short = (p.name || '').length > 22 ? `${(p.name || '').slice(0, 20)}…` : (p.name || '—');
      return `
        <th class="mm-prod${nameChecked(p.id) ? ' chosen' : ''}" title="${escapeHtml(p.name || '')}">
          <label class="mm-prod-label">
            <input type="radio" name="mergeField_name" value="${escapeHtml(p.id)}"
              ${nameChecked(p.id) ? 'checked' : ''} data-merge-field="name" data-merge-pid="${escapeHtml(p.id)}">
            <span class="mm-prod-name">${escapeHtml(short)}</span>
          </label>
        </th>`;
    }).join('');
    const rows = MERGE_FIELD_DEFS.filter((def) => def.key !== 'name').map((def) => {
      const cells = mergeChosen.map((p) => {
        const checked = mergeFieldSource[def.key] === p.id;
        return `
          <td class="mm-prod">
            <label class="mm-prod-label">
              <input type="radio" name="mergeField_${escapeHtml(def.key)}" value="${escapeHtml(p.id)}"
                ${checked ? 'checked' : ''} data-merge-field="${escapeHtml(def.key)}" data-merge-pid="${escapeHtml(p.id)}">
              <div class="mm-val">${escapeHtml(def.display(p))}</div>
            </label>
          </td>`;
      }).join('');
      return `<tr class="mm-field-row"><th>${escapeHtml(def.label)}</th>${cells}</tr>`;
    }).join('');
    box.innerHTML = `
      <table class="mm-field-table">
        <thead><tr><th class="mm-corner">Keep details from</th>${cols}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    box.querySelectorAll('[data-merge-field]').forEach((input) => {
      input.onchange = () => {
        mergeFieldSource[input.dataset.mergeField] = input.dataset.mergePid;
        renderMergeFieldTable();
      };
    });
  }

  function renderMergeOffersPreview() {
    const box = $('libMergeOffersPreview');
    if (!box) return;
    const offers = mergeOffersPreview(mergeChosen, supplierNameById);
    if (!offers.length) {
      box.innerHTML = '<p class="muted mm-offers-empty">No supplier prices on these products.</p>';
      return;
    }
    box.innerHTML = `
      <div class="mm-offers-head">Resulting suppliers &amp; prices (all kept)</div>
      <div class="mm-offers">
        ${offers.map((o) => `
          <div class="mm-offer${o.is_preferred ? ' pref' : ''}">
            <div class="mm-offer-main">${escapeHtml(o.supplier_name)}
              ${o.pack_size ? ` <span class="mm-offer-sub">· ${escapeHtml(o.pack_size)}</span>` : ''}
              ${o.sku ? ` <span class="mm-offer-sub">· SKU ${escapeHtml(o.sku)}</span>` : ''}
            </div>
            <div class="mm-offer-price">${o.case_price != null ? escapeHtml(fmtMoney(o.case_price)) : '—'}
              ${o.is_preferred ? ' <span class="mm-offer-sub">pref</span>' : ''}
            </div>
          </div>`).join('')}
      </div>`;
  }

  function openMergeDialog() {
    const chosen = products.filter((p) => selected.has(p.id));
    if (chosen.length < 2) return;
    const sorted = pickDefaultKeeper(chosen);
    mergeChosen = sorted;
    mergeKeepId = sorted[0].id;
    mergeFieldSource = defaultMergeFieldSources(sorted);

    openSheet({
      title: 'Merge products',
      variant: 'admin-wide',
      bodyHtml: `
        <div class="admin-drawer-form lib-merge-form">
          <p class="muted" style="margin:0 0 12px">
            Event stock, deliveries, and counts on the duplicates move onto the keeper.
            Pick which details to keep; every supplier price is retained.
          </p>
          <div class="del-form-err" id="libMergeErr"></div>
          <div id="libMergeFieldTable"></div>
          <div id="libMergeOffersPreview"></div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="libMergeDialogCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="libMergeConfirm">
              Merge ${chosen.length} into 1
            </button>
          </div>
        </div>`,
    });

    renderMergeFieldTable();
    renderMergeOffersPreview();

    $('libMergeDialogCancel').onclick = closeSheet;
    $('libMergeConfirm').onclick = async () => {
      const dupIds = mergeChosen.map((p) => p.id).filter((id) => id !== mergeKeepId);
      if (!dupIds.length) {
        $('libMergeErr').textContent = 'Need at least two products to merge.';
        return;
      }
      const btn = $('libMergeConfirm');
      const cancel = $('libMergeDialogCancel');
      btn.disabled = true;
      cancel.disabled = true;
      btn.textContent = 'Merging…';
      $('libMergeErr').textContent = '';
      try {
        const res = await getDB().products.merge(mergeKeepId, dupIds, buildMergeFieldsPayload(mergeChosen, mergeFieldSource));
        const merged = res?.merged != null ? res.merged : dupIds.length;
        closeSheet();
        setMergeMode(false);
        await refresh();
        toast(`Merged ${merged} duplicate${merged === 1 ? '' : 's'}`);
      } catch (err) {
        $('libMergeErr').textContent = err.message || 'Merge failed';
        btn.disabled = false;
        cancel.disabled = false;
        btn.textContent = `Merge ${mergeChosen.length} into 1`;
      }
    };
  }

  async function refresh() {
    [products, categories, suppliers, caseSizes] = await Promise.all([
      loadLibraryProducts(),
      loadCategories(),
      loadSuppliers(),
      loadCaseSizes(),
    ]);
    paintTable();
  }

  tableEl?.querySelector('thead')?.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    const nextDir = sortKey === key
      ? (sortDir === 1 ? 'desc' : 'asc')
      : 'asc';
    sortKey = key;
    sortDir = nextDir === 'desc' ? -1 : 1;
    paintTable();
    patchTableFilterState('library', { sort: key, sortDir: nextDir });
  });

  $('libMergeCancel')?.addEventListener('click', () => setMergeMode(false));
  $('libMergeBtn')?.addEventListener('click', () => openMergeDialog());
  $('libMergeAuto')?.addEventListener('click', () => {
    const ids = findDuplicateProductIds(filteredProducts());
    selected.clear();
    ids.forEach((id) => selected.add(id));
    updateMergeBar();
    paintTable();
    if (!ids.length) toast('No duplicate names or SKUs in the current list');
    else toast(`Selected ${ids.length} likely duplicate${ids.length === 1 ? '' : 's'}`);
  });

  const onProductFilter = (e) => {
    productFilter = e.detail || {};
    paintTable();
    if (e.detail?.productId) e.detail.handled = true;
  };

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-product') {
      e.detail.handled = true;
      if (mergeMode) setMergeMode(false);
      openProductForm();
    }
    if (e.detail?.action === 'merge-products') {
      e.detail.handled = true;
      setMergeMode(!mergeMode);
    }
  };

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'library') return;
    applyTableFilterValues(e.detail?.values);
    paintTable();
  };

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  refresh().catch((err) => {
    bodyEl.innerHTML = `<tr><td colspan="10" class="del-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
  });

  return () => {
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
