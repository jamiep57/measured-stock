/**
 * Admin kit library — equipment catalogue with stock, notes, barcodes, and containers.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import {
  getDB, loadKitLibraryProducts, loadKitCategories,
  loadKitContainerContents, replaceKitContainerContents,
} from '../../db.js';
import { contentsByContainer } from '../../lib/kit-stock.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openModal, closeModal, confirmDialog} from '../../components/modal.js';
import { loadingTableRow } from '../../components/loading-widget.js';
import { mountProductSearch } from '../../components/product-search.js';
import {
  buildKitImageQuery, searchKitImages, downloadKitImageFile, findKitImageCandidate,
} from '../../lib/kit-image-search.js';
import {
  printKitLabel as printKitLabelPdf,
  resolveKitLabelPayload,
} from '../../lib/kit-label-pdf.js';
import {
  loadPendingKitLabelQueue,
  markKitLabelsPrinted,
  removeKitLabelQueueItem,
  setKitLabelQueueCopies,
  pendingLabelQueueStats,
} from '../../lib/kit-label-queue.js';
import { qrImageUrl, resolvePhoneOrigin } from '../../lib/kit-scan-session.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
  patchTableFilterState,
} from '../table-filter.js';

const PRODUCT_IMAGE_BUCKET = 'product-images';

const CATEGORY_COLOURS = [
  { value: 'beer', label: 'Beer (amber)' },
  { value: 'cider', label: 'Cider (green)' },
  { value: 'wine', label: 'Wine (purple)' },
  { value: 'rtd', label: 'RTD / mixers (blue)' },
  { value: 'softs', label: 'Softs (teal)' },
  { value: 'spirits', label: 'Spirits (red)' },
];

function colourKey(name) {
  const k = String(name || '').toLowerCase();
  if (k.includes('beer') || k.includes('ale')) return 'beer';
  if (k.includes('cider')) return 'cider';
  if (k.includes('wine')) return 'wine';
  if (k.includes('spirit')) return 'spirits';
  if (k.includes('soft') || k.includes('water') || k.includes('cup')) return 'softs';
  return 'rtd';
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function qtyDisplay(n) {
  const v = round1(n);
  return Number.isFinite(v) ? String(v) : '0';
}

function productHaystack(p) {
  return [p.name, p.sku, p.barcode, p.notes, p.category?.name]
    .filter(Boolean).join(' ').toLowerCase();
}

function parseContentsQty(raw) {
  const n = Number(String(raw || '').trim());
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n * 1000) / 1000;
}

function imageExt(file) {
  const fromName = (file.name || '').split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const type = (file.type || '').split('/')[1];
  if (type === 'jpeg') return 'jpg';
  if (type && /^[a-z0-9]+$/.test(type)) return type;
  return 'jpg';
}

function paintKitFormPhoto(imageUrl) {
  const preview = $('kitLibImagePreview');
  const clearBtn = $('kitLibImageClear');
  const pickBtn = $('kitLibImagePick');
  if (!preview) return;
  if (imageUrl) {
    preview.classList.remove('kit-lib-image-preview--empty');
    preview.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="Kit item photo">`;
    if (clearBtn) clearBtn.hidden = false;
    if (pickBtn) pickBtn.innerHTML = `${icon('upload', { size: 14 })} Change photo`;
  } else {
    preview.classList.add('kit-lib-image-preview--empty');
    preview.innerHTML = icon('image', { size: 20 });
    if (clearBtn) clearBtn.hidden = true;
    if (pickBtn) pickBtn.innerHTML = `${icon('upload', { size: 14 })} Add photo`;
  }
}

function categorySortOrder(categories, name) {
  const cat = (categories || []).find((c) => c.name === name);
  return cat?.sort_order ?? 9999;
}

function groupByCategory(products, categories) {
  const grouped = {};
  (products || []).forEach((p) => {
    const cat = p.category?.name || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(p);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });
  const keys = Object.keys(grouped).sort((a, b) => {
    const oa = categorySortOrder(categories, a);
    const ob = categorySortOrder(categories, b);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
  return { grouped, keys };
}

async function loadKitStockMap() {
  const DB = getDB();
  try {
    const rows = await DB.select(
      'warehouse_stock',
      '?select=product_id,qty_on_hand&qty_on_hand=gt.0',
    );
    const map = new Map();
    for (const row of rows || []) {
      const pid = row.product_id;
      if (!pid) continue;
      map.set(pid, round1((map.get(pid) || 0) + (Number(row.qty_on_hand) || 0)));
    }
    return map;
  } catch {
    return new Map();
  }
}

function renderShell() {
  return `
    <div class="admin-page lib-panel kit-lib-panel">
      <div class="lib-toolbar kit-lib-toolbar" id="kitLibToolbar"></div>
      <div class="lib-table-wrap admin-surface">
        <table class="lib-table kit-lib-table" id="kitLibTable">
          <thead>
            <tr>
              <th class="kit-lib-thumb-col" aria-label="Photo"></th>
              <th data-sort="name">Item</th>
              <th data-sort="barcode">Barcode</th>
              <th data-sort="sku">SKU</th>
              <th class="lib-num" data-sort="stock">On hand</th>
              <th data-sort="notes">Notes</th>
              <th class="lib-act"></th>
            </tr>
          </thead>
          <tbody id="kitLibBody">
            ${loadingTableRow(7, 'Loading kit…')}
          </tbody>
        </table>
        <div class="lib-empty" id="kitLibEmpty" hidden>No kit items match.</div>
      </div>
    </div>`;
}

function renderToolbar(countLabel) {
  return `<span class="lib-count muted" id="kitLibCount">${escapeHtml(countLabel)}</span>`;
}

function sortWithinGroups(list, sortKey, sortDir) {
  const dir = sortDir >= 0 ? 1 : -1;
  return list.slice().sort((a, b) => {
    let av;
    let bv;
    if (sortKey === 'stock') {
      av = Number(a._stock) || 0;
      bv = Number(b._stock) || 0;
      return (av - bv) * dir;
    }
    if (sortKey === 'sku') {
      av = (a.sku || '').toLowerCase();
      bv = (b.sku || '').toLowerCase();
    } else if (sortKey === 'barcode') {
      av = (a.barcode || '').toLowerCase();
      bv = (b.barcode || '').toLowerCase();
    } else if (sortKey === 'notes') {
      av = (a.notes || '').toLowerCase();
      bv = (b.notes || '').toLowerCase();
    } else {
      av = (a.name || '').toLowerCase();
      bv = (b.name || '').toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function renderGroupedRows(rows, categories, sortKey, sortDir) {
  const { grouped, keys } = groupByCategory(rows, categories);
  let html = '';
  keys.forEach((cat) => {
    const list = sortWithinGroups(grouped[cat], sortKey, sortDir);
    html += `
      <tr class="kit-lib-cat-row">
        <td colspan="7">
          <span class="kit-lib-cat-name">${escapeHtml(cat)}</span>
          <span class="kit-lib-cat-count muted">${list.length}</span>
        </td>
      </tr>`;
    list.forEach((p) => {
      const stock = Number(p._stock) || 0;
      const archived = !!p.archived;
      const isContainer = !!p.is_container;
      const notes = (p.notes || '').trim();
      const notesShort = notes.length > 72 ? `${notes.slice(0, 72)}…` : notes;
      const contents = p._contents || [];
      const thumb = (p.image_url || '').trim();
      html += `
        <tr class="kit-lib-item-row${archived ? ' kit-lib-item-row--archived' : ''}${stock ? '' : ' kit-lib-item-row--zero'}${isContainer ? ' kit-lib-item-row--container' : ''}"
          data-pid="${escapeHtml(p.id)}"
          data-product-name="${escapeHtml((p.name || '').toLowerCase())}"
          data-barcode="${escapeHtml((p.barcode || '').toLowerCase())}"
          tabindex="0" role="button"
          title="Edit ${escapeHtml(p.name || 'item')}">
          <td class="kit-lib-thumb-cell">
            ${thumb
              ? `<img class="kit-lib-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">`
              : '<span class="kit-lib-thumb kit-lib-thumb--empty" aria-hidden="true"></span>'}
          </td>
          <td>
            <span class="lib-prod-name">${escapeHtml(p.name || 'Item')}</span>
            ${isContainer ? '<span class="kit-lib-container-tag" title="Counted as 1 unit with contents inside">Container</span>' : ''}
            ${archived ? '<span class="kit-lib-archived-tag">Archived</span>' : ''}
          </td>
          <td class="kit-lib-barcode">${p.barcode ? escapeHtml(p.barcode) : '<span class="muted">—</span>'}</td>
          <td class="kit-lib-sku">${p.sku ? escapeHtml(p.sku) : '<span class="muted">—</span>'}</td>
          <td class="lib-num kit-lib-stock${stock ? '' : ' muted'}">${stock ? escapeHtml(qtyDisplay(stock)) : '—'}</td>
          <td class="kit-lib-notes">${notes ? `<span title="${escapeHtml(notes)}">${escapeHtml(notesShort)}</span>` : '<span class="muted">—</span>'}</td>
          <td class="lib-act">
            <button type="button" class="topbar-tool del-card-action" data-print-label="${escapeHtml(p.id)}"
              title="Print QL-800 label" aria-label="Print label for ${escapeHtml(p.name || 'item')}">
              ${icon('printer', { size: 16 })}
            </button>
            <button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(p.id)}"
              title="Edit kit item" aria-label="Edit ${escapeHtml(p.name || 'item')}">
              ${icon('pencil', { size: 16 })}
            </button>
          </td>
        </tr>`;

      if (isContainer) {
        if (!contents.length) {
          html += `
            <tr class="kit-lib-nested-row kit-lib-nested-row--empty">
              <td class="kit-lib-thumb-cell"></td>
              <td colspan="6">
                <span class="kit-lib-nested-empty muted">No contents yet — edit to add items inside</span>
              </td>
            </tr>`;
        } else {
          contents.forEach((c, i) => {
            const child = c.child || {};
            const childName = child.name || 'Item';
            const childId = c.child_product_id || child.id || '';
            const qty = Number(c.qty) || 0;
            const isLast = i === contents.length - 1;
            html += `
              <tr class="kit-lib-nested-row${isLast ? ' kit-lib-nested-row--last' : ''}${childId ? ' kit-lib-nested-row--clickable' : ''}"
                ${childId ? `data-pid="${escapeHtml(childId)}" tabindex="0" role="button" title="Edit ${escapeHtml(childName)}"` : ''}>
                <td class="kit-lib-thumb-cell kit-lib-nested-rail" aria-hidden="true">
                  <span class="kit-lib-nested-branch${isLast ? ' kit-lib-nested-branch--last' : ''}"></span>
                </td>
                <td class="kit-lib-nested-name">
                  <span class="kit-lib-nested-qty">${escapeHtml(qtyDisplay(qty))}×</span>
                  <span class="lib-prod-name">${escapeHtml(childName)}</span>
                </td>
                <td class="kit-lib-barcode">${child.barcode ? escapeHtml(child.barcode) : '<span class="muted">—</span>'}</td>
                <td class="kit-lib-sku">${child.sku ? escapeHtml(child.sku) : '<span class="muted">—</span>'}</td>
                <td class="lib-num muted">—</td>
                <td class="kit-lib-notes muted">Inside container</td>
                <td class="lib-act">
                  ${childId ? `
                    <button type="button" class="topbar-tool del-card-action" data-print-label="${escapeHtml(childId)}"
                      title="Print QL-800 label" aria-label="Print label for ${escapeHtml(childName)}">
                      ${icon('printer', { size: 16 })}
                    </button>
                    <button type="button" class="topbar-tool del-card-action" data-edit="${escapeHtml(childId)}"
                      title="Edit kit item" aria-label="Edit ${escapeHtml(childName)}">
                      ${icon('pencil', { size: 16 })}
                    </button>` : ''}
                </td>
              </tr>`;
          });
        }
      }
    });
  });
  return html;
}

export function renderKitLibraryShell() {
  return renderShell();
}

export function mountKitLibraryPanel() {
  const bodyEl = $('kitLibBody');
  const emptyEl = $('kitLibEmpty');
  const toolbarEl = $('kitLibToolbar');
  const tableEl = $('kitLibTable');
  if (!bodyEl || !toolbarEl) return () => {};

  let products = [];
  let categories = [];
  let stockMap = new Map();
  let contentsMap = new Map();
  let filterCat = '';
  let stockFilter = 'all';
  let showArchived = false;
  let sortKey = 'name';
  let sortDir = 1;
  let productFilter = getLastProductFilter();
  let autoPhotoRunning = false;

  const seeded = getTableFilterValues('kit-library');
  if (seeded) {
    filterCat = seeded.categoryFilter || '';
    stockFilter = seeded.stockFilter || 'all';
    showArchived = Boolean(seeded.showArchived);
    sortKey = seeded.sortKey || 'name';
    sortDir = seeded.sortDir === 'desc' ? -1 : 1;
  }

  function enrichedProducts() {
    return products.map((p) => ({
      ...p,
      _stock: Number(stockMap.get(p.id)) || 0,
      _contents: contentsMap.get(p.id) || [],
    }));
  }

  /**
   * Ensure barcode is set (Current RMS URL from sku, or product id), then
   * print to QL-800 over WebUSB (Chrome / Edge).
   * @param {{ id: string, name?: string, barcode?: string|null, sku?: string|null, is_container?: boolean }} product
   */
  async function printKitLabel(product) {
    if (!product?.id) {
      toast('Save the item before printing a label.', true);
      return;
    }
    try {
      const resolved = resolveKitLabelPayload(product);
      let barcode = resolved.barcode;
      if (resolved.shouldPersist) {
        await getDB().products.update(product.id, { barcode });
        const local = products.find((x) => x.id === product.id);
        if (local) local.barcode = barcode;
        product.barcode = barcode;
      }
      await printKitLabelPdf({
        name: product.name || 'Kit item',
        barcode,
        isContainer: !!product.is_container,
        copies: 1,
      });
      toast('Printed to QL-800 · 62mm continuous');
      paintTable();
    } catch (err) {
      toast(err.message || 'Label print failed', true);
    }
  }

  function filteredProducts() {
    const q = (productFilter.query || '').trim().toLowerCase();
    const pid = productFilter.productId;
    return enrichedProducts().filter((p) => {
      if (!showArchived && p.archived) return false;
      if (filterCat && p.category?.name !== filterCat) return false;
      if (stockFilter === 'in-stock' && !(p._stock > 0)) return false;
      if (stockFilter === 'zero' && p._stock > 0) return false;
      if (pid) return p.id === pid;
      if (!q) return true;
      return productHaystack(p).includes(q);
    });
  }

  function countLabel(rows) {
    const visible = showArchived
      ? products.length
      : products.filter((p) => !p.archived).length;
    return `${rows.length} of ${visible} item${visible !== 1 ? 's' : ''}`;
  }

  function applyTableFilterValues(values) {
    if (!values) return;
    filterCat = values.categoryFilter || '';
    stockFilter = values.stockFilter || 'all';
    showArchived = Boolean(values.showArchived);
    sortKey = values.sortKey || 'name';
    sortDir = values.sortDir === 'desc' ? -1 : 1;
  }

  function paintToolbar(rows) {
    toolbarEl.innerHTML = renderToolbar(countLabel(rows));
  }

  function paintSortHeaders() {
    tableEl?.querySelectorAll('th[data-sort]').forEach((th) => {
      const key = th.dataset.sort;
      th.classList.toggle('lib-sort-active', key === sortKey);
      th.dataset.sortDir = key === sortKey ? String(sortDir) : '';
    });
  }

  function paintTable() {
    const rows = filteredProducts();
    paintToolbar(rows);
    paintSortHeaders();
    if (!rows.length) {
      bodyEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (tableEl) tableEl.hidden = true;
    } else {
      if (emptyEl) emptyEl.hidden = true;
      if (tableEl) tableEl.hidden = false;
      bodyEl.innerHTML = renderGroupedRows(rows, categories, sortKey, sortDir);
      bodyEl.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          openKitForm(btn.dataset.edit);
        };
      });
      bodyEl.querySelectorAll('[data-print-label]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const id = btn.dataset.printLabel;
          const product = products.find((x) => x.id === id);
          if (!product) {
            toast('Item not found', true);
            return;
          }
          printKitLabel(product).catch((err) => toast(err.message || 'Print failed', true));
        };
      });
      bodyEl.querySelectorAll('.kit-lib-item-row, .kit-lib-nested-row--clickable').forEach((row) => {
        row.onclick = (e) => {
          if (e.target.closest('[data-edit], [data-print-label]')) return;
          if (!row.dataset.pid) return;
          openKitForm(row.dataset.pid);
        };
        row.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (row.dataset.pid) openKitForm(row.dataset.pid);
          }
        };
      });
    }

    if (productFilter.productId) {
      const target = bodyEl.querySelector(`[data-pid="${productFilter.productId}"]`);
      target?.scrollIntoView({ block: 'nearest' });
    }
  }

  function openKitForm(editId) {
    const p = editId ? products.find((x) => x.id === editId) : null;
    const stock = p ? (Number(stockMap.get(p.id)) || 0) : 0;
    const catOpts = [
      '<option value="">— none —</option>',
      ...categories
        .slice()
        .sort((a, b) => (a.sort_order - b.sort_order) || (a.name || '').localeCompare(b.name || ''))
        .map((c) =>
          `<option value="${escapeHtml(c.id)}"${c.id === p?.category_id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`),
    ].join('');

    /** @type {Array<{ child_product_id: string, qty: number, child?: object }>} */
    let draftContents = p
      ? (contentsMap.get(p.id) || []).map((c) => ({
        child_product_id: c.child_product_id,
        qty: Number(c.qty) || 1,
        child: c.child || products.find((x) => x.id === c.child_product_id) || null,
      }))
      : [];
    let isContainer = !!p?.is_container;
    let imageUrl = (p?.image_url || '').trim() || null;
    /** @type {File | null} */
    let pendingImageFile = null;
    /** @type {string | null} */
    let pendingRemoteUrl = null;
    let clearImage = false;
    let previewObjectUrl = null;

    openSheet({
      title: p ? 'Edit kit item' : 'New kit item',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="kitLibErr"></div>
          <div class="admin-field">
            <label class="admin-label">Photo</label>
            <div class="kit-lib-image-row">
              <div class="kit-lib-image-preview kit-lib-image-preview--empty" id="kitLibImagePreview" aria-hidden="true">
                ${icon('image', { size: 20 })}
              </div>
              <div class="kit-lib-image-actions">
                <input type="file" id="kitLibImageFile" accept="image/*" hidden>
                <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="kitLibImagePick">
                  ${icon('upload', { size: 14 })} Upload
                </button>
                <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="kitLibImageFind">
                  ${icon('search', { size: 14 })} Find online
                </button>
                <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="kitLibImageClear" hidden>
                  Remove
                </button>
              </div>
            </div>
            <div class="kit-lib-image-search" id="kitLibImageSearch" hidden>
              <p class="admin-hint muted">Searches the web for photos matching the name (same kind of results as a browser image search). Pick one, then save the item.</p>
              <div class="kit-lib-image-search-bar">
                <input class="admin-input" type="search" id="kitLibImageQuery"
                  placeholder="e.g. pump truck tools" autocomplete="off">
                <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="kitLibImageSearchBtn">
                  Search
                </button>
              </div>
              <div class="kit-lib-image-results" id="kitLibImageResults"></div>
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="kitLibName">Name</label>
            <input class="admin-input" type="text" id="kitLibName" required placeholder="e.g. 8ft trestle table">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="kitLibCategoryId">Category</label>
              <select class="admin-select" id="kitLibCategoryId">${catOpts}</select>
            </div>
            <div class="admin-field">
              <label class="admin-label" for="kitLibSku">SKU</label>
              <input class="admin-input" type="text" id="kitLibSku" placeholder="Optional">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="kitLibBarcode">Barcode</label>
            <input class="admin-input" type="text" id="kitLibBarcode"
              placeholder="Scan or paste from Current RMS" autocomplete="off" inputmode="text">
            <p class="admin-hint muted">Printed QL labels use this value as a QR. If empty, a Current RMS URL is built from a numeric SKU.</p>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="kitLibNotes">Notes</label>
            <textarea class="admin-textarea" id="kitLibNotes" rows="3" placeholder="Specs, packing hints, hire notes…"></textarea>
          </div>
          <label class="kit-lib-container-check">
            <input type="checkbox" id="kitLibIsContainer"${isContainer ? ' checked' : ''}>
            <span>Container (pallet box, kitbox…) — counts as <strong>1</strong> with a contents list</span>
          </label>
          <div class="kit-lib-contents-block" id="kitLibContentsBlock"${isContainer ? '' : ' hidden'}>
            <div class="kit-lib-contents-head">
              <span class="admin-label">Contents inside</span>
              <span class="muted kit-lib-contents-count" id="kitLibContentsCount"></span>
            </div>
            <p class="admin-hint muted">Stock still counts one container. Contents are the packing list for what’s inside.</p>
            <div id="kitLibContentsList" class="kit-lib-contents-list"></div>
            <div class="kit-lib-contents-add">
              <div id="kitLibContentsSearch"></div>
              <input class="admin-input kit-lib-contents-qty" type="text" inputmode="decimal"
                id="kitLibContentsQty" value="1" aria-label="Qty inside container">
              <button type="button" class="admin-drawer-btn" id="kitLibContentsAdd">Add</button>
            </div>
          </div>
          ${p ? `
            <div class="kit-lib-form-meta muted">
              <span>Warehouse on hand: <strong>${escapeHtml(qtyDisplay(stock))}</strong></span>
            </div>
            <label class="kit-lib-archive-check">
              <input type="checkbox" id="kitLibArchived"${p.archived ? ' checked' : ''}>
              <span>Archived (hide from default lists)</span>
            </label>` : ''}
          <p class="wst-form-hint muted">Kit items are counted as whole units. Add them to an event from the Kit tab.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${p ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="kitLibDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitLibCancel">Cancel</button>
            ${p ? `<button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitLibPrintLabel">
              ${icon('printer', { size: 14 })} Print label
            </button>` : ''}
            ${p ? '' : `<button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitLibSavePrint">
              ${icon('printer', { size: 14 })} Save &amp; print
            </button>`}
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="kitLibSave">${p ? 'Update item' : 'Save item'}</button>
          </div>
        </div>`,
    });

    if (p) {
      $('kitLibName').value = p.name || '';
      $('kitLibSku').value = p.sku || '';
      $('kitLibBarcode').value = p.barcode || '';
      $('kitLibNotes').value = p.notes || '';
    }
    paintKitFormPhoto(imageUrl);

    const fileInput = $('kitLibImageFile');
    const searchPanel = $('kitLibImageSearch');
    const resultsEl = $('kitLibImageResults');
    const queryEl = $('kitLibImageQuery');

    function categoryNameForForm() {
      const id = $('kitLibCategoryId')?.value || '';
      return categories.find((c) => c.id === id)?.name || '';
    }

    function applyPickedImage({ file = null, remoteUrl = null, preview = null }) {
      if (previewObjectUrl) {
        try { URL.revokeObjectURL(previewObjectUrl); } catch { /* ignore */ }
        previewObjectUrl = null;
      }
      pendingImageFile = file;
      pendingRemoteUrl = remoteUrl;
      clearImage = false;
      if (file) {
        previewObjectUrl = URL.createObjectURL(file);
        paintKitFormPhoto(previewObjectUrl);
      } else if (preview || remoteUrl) {
        paintKitFormPhoto(preview || remoteUrl);
      }
      if (searchPanel) searchPanel.hidden = true;
    }

    async function runImageSearch() {
      const q = (queryEl?.value || '').trim();
      if (!q) {
        if (resultsEl) {
          resultsEl.innerHTML = '<p class="muted kit-lib-image-results-msg">Enter a search term.</p>';
        }
        return;
      }
      if (resultsEl) {
        resultsEl.innerHTML = '<p class="muted kit-lib-image-results-msg">Searching…</p>';
      }
      try {
        const hits = await searchKitImages(q, { pageSize: 12 });
        if (!resultsEl) return;
        if (!hits.length) {
          resultsEl.innerHTML = '<p class="muted kit-lib-image-results-msg">No images found — try a simpler name.</p>';
          return;
        }
        resultsEl.innerHTML = hits.map((hit) => `
          <button type="button" class="kit-lib-image-result" data-image-id="${escapeHtml(hit.id)}"
            title="${escapeHtml(hit.title)}${hit.source ? ` · ${hit.source}` : ''}">
            <img src="${escapeHtml(hit.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
            <span class="kit-lib-image-result-cap">${escapeHtml(hit.title)}</span>
          </button>`).join('');
        resultsEl.querySelectorAll('.kit-lib-image-result').forEach((btn) => {
          btn.onclick = async () => {
            const hit = hits.find((h) => h.id === btn.dataset.imageId);
            if (!hit) return;
            btn.disabled = true;
            btn.classList.add('is-loading');
            try {
              const file = await downloadKitImageFile(
                hit.url,
                ($('kitLibName')?.value || 'kit').trim() || 'kit',
              );
              if (file) {
                applyPickedImage({ file });
                toast('Photo selected — save the item to keep it');
              } else {
                // CORS blocked download — keep remote URL and upload path will hotlink
                applyPickedImage({ remoteUrl: hit.url, preview: hit.thumb || hit.url });
                toast('Photo selected — save the item to keep it');
              }
            } catch (err) {
              toast(err.message || 'Could not use that image', true);
            } finally {
              btn.disabled = false;
              btn.classList.remove('is-loading');
            }
          };
        });
      } catch (err) {
        if (resultsEl) {
          resultsEl.innerHTML = `<p class="del-form-err kit-lib-image-results-msg">${escapeHtml(err.message || 'Search failed')}</p>`;
        }
      }
    }

    $('kitLibImagePick')?.addEventListener('click', () => fileInput?.click());
    $('kitLibImageFind')?.addEventListener('click', () => {
      if (!searchPanel) return;
      const opening = searchPanel.hidden;
      searchPanel.hidden = !opening;
      if (opening) {
        const q = buildKitImageQuery(
          ($('kitLibName')?.value || '').trim() || (p?.name || ''),
          categoryNameForForm(),
        );
        if (queryEl) queryEl.value = q;
        if (q) runImageSearch();
        else if (resultsEl) {
          resultsEl.innerHTML = '<p class="muted kit-lib-image-results-msg">Add a name (and category) then search.</p>';
        }
        queryEl?.focus();
      }
    });
    $('kitLibImageSearchBtn')?.addEventListener('click', () => runImageSearch());
    queryEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runImageSearch();
      }
    });
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      applyPickedImage({ file });
      if (fileInput) fileInput.value = '';
    });
    $('kitLibImageClear')?.addEventListener('click', () => {
      pendingImageFile = null;
      pendingRemoteUrl = null;
      clearImage = true;
      if (previewObjectUrl) {
        try { URL.revokeObjectURL(previewObjectUrl); } catch { /* ignore */ }
        previewObjectUrl = null;
      }
      if (fileInput) fileInput.value = '';
      imageUrl = null;
      paintKitFormPhoto(null);
    });

    let pendingChildId = '';
    let pendingChild = null;

    function paintContentsList() {
      const listEl = $('kitLibContentsList');
      const countEl = $('kitLibContentsCount');
      if (countEl) {
        countEl.textContent = draftContents.length
          ? `${draftContents.length} item${draftContents.length === 1 ? '' : 's'}`
          : 'Empty';
      }
      if (!listEl) return;
      if (!draftContents.length) {
        listEl.innerHTML = '<p class="muted kit-lib-contents-empty">No contents yet — add kit items stored inside this container.</p>';
        return;
      }
      listEl.innerHTML = draftContents.map((c, i) => {
        const name = c.child?.name || 'Item';
        return `
          <div class="kit-lib-contents-row" data-idx="${i}">
            <span class="kit-lib-contents-name">${escapeHtml(name)}</span>
            <input type="text" inputmode="decimal" class="admin-input kit-lib-contents-row-qty"
              data-qty-idx="${i}" value="${escapeHtml(String(c.qty))}" aria-label="Qty of ${escapeHtml(name)}">
            <button type="button" class="topbar-tool" data-remove-content="${i}"
              title="Remove" aria-label="Remove ${escapeHtml(name)}">
              ${icon('x', { size: 14 })}
            </button>
          </div>`;
      }).join('');
      listEl.querySelectorAll('[data-remove-content]').forEach((btn) => {
        btn.onclick = () => {
          const idx = Number(btn.dataset.removeContent);
          draftContents = draftContents.filter((_, j) => j !== idx);
          paintContentsList();
        };
      });
      listEl.querySelectorAll('[data-qty-idx]').forEach((inp) => {
        inp.onchange = () => {
          const idx = Number(inp.dataset.qtyIdx);
          if (!draftContents[idx]) return;
          draftContents[idx].qty = parseContentsQty(inp.value);
          inp.value = String(draftContents[idx].qty);
        };
      });
    }

    function syncContainerUi() {
      isContainer = !!$('kitLibIsContainer')?.checked;
      const block = $('kitLibContentsBlock');
      if (block) block.hidden = !isContainer;
    }

    function addContentLine() {
      const childId = pendingChildId;
      if (!childId) {
        $('kitLibErr').textContent = 'Pick a kit item to add inside the container.';
        return;
      }
      if (p && childId === p.id) {
        $('kitLibErr').textContent = 'A container cannot contain itself.';
        return;
      }
      if (draftContents.some((c) => c.child_product_id === childId)) {
        $('kitLibErr').textContent = 'That item is already in the contents list.';
        return;
      }
      $('kitLibErr').textContent = '';
      draftContents.push({
        child_product_id: childId,
        qty: parseContentsQty($('kitLibContentsQty')?.value),
        child: pendingChild || products.find((x) => x.id === childId) || null,
      });
      $('kitLibContentsQty').value = '1';
      pendingChildId = '';
      pendingChild = null;
      const searchInput = $('kitLibContentsSearch')?.querySelector('.product-search-input');
      if (searchInput) searchInput.value = '';
      paintContentsList();
    }

    $('kitLibIsContainer')?.addEventListener('change', syncContainerUi);
    paintContentsList();
    syncContainerUi();

    const contentCandidates = products.filter((x) =>
      (!x.archived || x.id === p?.id)
      && (!p || x.id !== p.id));
    mountProductSearch($('kitLibContentsSearch'), {
      products: contentCandidates,
      placeholder: 'Search kit to store inside…',
      onSelect: ({ productId, product }) => {
        pendingChildId = productId || '';
        pendingChild = product || null;
      },
    });
    $('kitLibContentsAdd').onclick = addContentLine;

    $('kitLibCancel').onclick = () => {
      if (previewObjectUrl) {
        try { URL.revokeObjectURL(previewObjectUrl); } catch { /* ignore */ }
      }
      closeSheet();
    };

    async function saveKitForm({ printAfter = false } = {}) {
      const name = ($('kitLibName')?.value || '').trim();
      if (!name) {
        $('kitLibErr').textContent = 'Name is required.';
        return;
      }
      isContainer = !!$('kitLibIsContainer')?.checked;
      // Capture qty edits still focused
      $('kitLibContentsList')?.querySelectorAll('[data-qty-idx]')?.forEach((inp) => {
        const idx = Number(inp.dataset.qtyIdx);
        if (draftContents[idx]) draftContents[idx].qty = parseContentsQty(inp.value);
      });
      let barcode = ($('kitLibBarcode')?.value || '').trim() || null;
      const sku = ($('kitLibSku')?.value || '').trim() || null;
      // Pre-resolve barcode for new/print so the label QR is ready after create
      if (printAfter && !barcode) {
        try {
          const preview = resolveKitLabelPayload({
            id: p?.id || 'pending',
            sku,
            barcode,
          });
          // Only auto-fill RMS URL from sku before save; UUID needs real id after create
          if (preview.shouldPersist && /^\d+$/.test(String(sku || ''))) {
            barcode = preview.barcode;
            if ($('kitLibBarcode')) $('kitLibBarcode').value = barcode;
          }
        } catch { /* wait until after create */ }
      }
      const patch = {
        name,
        category_id: $('kitLibCategoryId')?.value || null,
        sku,
        barcode,
        notes: ($('kitLibNotes')?.value || '').trim() || null,
        is_container: isContainer,
        product_kind: 'kit',
        stock_unit: 'unit',
        units_per_case: 1,
        case_size: 'unit',
      };
      if (p) {
        patch.archived = !!$('kitLibArchived')?.checked;
      } else {
        patch.archived = false;
      }
      if (clearImage && !pendingImageFile && !pendingRemoteUrl) {
        patch.image_url = null;
      }
      if (pendingRemoteUrl && !pendingImageFile) {
        patch.image_url = pendingRemoteUrl;
      }
      const saveBtn = $('kitLibSave');
      const savePrintBtn = $('kitLibSavePrint');
      const printBtn = $('kitLibPrintLabel');
      if (saveBtn) saveBtn.disabled = true;
      if (savePrintBtn) savePrintBtn.disabled = true;
      if (printBtn) printBtn.disabled = true;
      try {
        const DB = getDB();
        let saved = p;
        if (p) {
          saved = await DB.products.update(p.id, patch);
        } else {
          saved = await DB.products.create(patch);
        }
        const productId = saved?.id || p?.id;
        if (productId) {
          await replaceKitContainerContents(
            productId,
            isContainer
              ? draftContents.map((c) => ({
                child_product_id: c.child_product_id,
                qty: c.qty,
              }))
              : [],
          );
          if (pendingImageFile) {
            const path = `kit/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${imageExt(pendingImageFile)}`;
            const url = await DB.uploadImage(PRODUCT_IMAGE_BUCKET, path, pendingImageFile);
            await DB.products.update(productId, { image_url: url });
          }
        }
        if (previewObjectUrl) {
          try { URL.revokeObjectURL(previewObjectUrl); } catch { /* ignore */ }
        }
        closeSheet();
        await refresh();
        toast(p ? 'Kit item updated' : 'Kit item created');

        if (printAfter && productId) {
          const fresh = products.find((x) => x.id === productId) || {
            id: productId,
            name: patch.name,
            sku: patch.sku,
            barcode: patch.barcode,
            is_container: patch.is_container,
          };
          await printKitLabel(fresh);
        }
      } catch (err) {
        const msg = String(err?.message || err);
        if (/idx_products_barcode_unique|duplicate key|unique/i.test(msg)) {
          $('kitLibErr').textContent = 'That barcode is already used on another item.';
        } else {
          $('kitLibErr').textContent = err.message || 'Save failed';
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (savePrintBtn) savePrintBtn.disabled = false;
        if (printBtn) printBtn.disabled = false;
      }
    }

    $('kitLibSave').onclick = () => {
      saveKitForm({ printAfter: false }).catch((err) => toast(err.message || 'Save failed', true));
    };
    $('kitLibSavePrint')?.addEventListener('click', () => {
      saveKitForm({ printAfter: true }).catch((err) => toast(err.message || 'Save failed', true));
    });
    $('kitLibPrintLabel')?.addEventListener('click', async () => {
      // Persist form fields first so the label matches what you see
      await saveKitForm({ printAfter: true });
    });

    if (p) {
      $('kitLibDelete').onclick = async () => {
        if (!(await confirmDialog({ title: 'Confirm', message: `Delete “${p.name}”? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
        try {
          await getDB().products.deleteFull(p.id);
          closeSheet();
          await refresh();
          toast('Kit item deleted');
        } catch (err) {
          toast(err.message || 'Delete failed', true);
        }
      };
    }
  }

  async function runAutoPhotos() {
    if (autoPhotoRunning) {
      toast('Auto photos already running…');
      return;
    }

    const active = products.filter((p) => !p.archived);
    const missing = active.filter((p) => !(p.image_url || '').trim());
    const already = active.length - missing.length;

    openSheet({
      title: 'Auto photos',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="muted">
            ${active.length} kit item${active.length === 1 ? '' : 's'}
            · <strong>${missing.length}</strong> missing a photo
            · ${already} already have one
          </p>
          <label class="kit-lib-archive-check">
            <input type="checkbox" id="kitAutoSkipExisting" checked>
            <span>Skip items that already have a photo</span>
          </label>
          <p class="admin-hint muted">
            Uses the first web result for each name. You can skip the current item or cancel anytime.
          </p>
          <div class="del-form-err" id="kitAutoPhotoSetupErr"></div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitAutoPhotoClose">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="kitAutoPhotoStart">Start</button>
          </div>
        </div>`,
    });

    $('kitAutoPhotoClose').onclick = closeSheet;
    $('kitAutoPhotoStart').onclick = async () => {
      const skipExisting = !!$('kitAutoSkipExisting')?.checked;
      const targets = skipExisting
        ? missing.slice()
        : active.slice();
      if (!targets.length) {
        $('kitAutoPhotoSetupErr').textContent = skipExisting
          ? 'Nothing to do — every item already has a photo.'
          : 'No kit items to process.';
        return;
      }
      const estMin = Math.max(1, Math.ceil((targets.length * 1.4) / 60));
      if (!(await confirmDialog({ title: 'Confirm', message: `Process ${targets.length} item${targets.length === 1 ? '' : 's'}`
        + (skipExisting ? ' (missing photos only)' : ' (including replace existing)')
        + `?\n\nAbout ${estMin} min.`, confirmLabel: 'Confirm', danger: true }))) return;
      startAutoPhotoRun(targets, { skipExisting });
    };
  }

  async function startAutoPhotoRun(targets, { skipExisting }) {
    autoPhotoRunning = true;
    let cancelled = false;
    let skipCurrent = false;
    let done = 0;
    let filled = 0;
    let skippedExisting = 0;
    let skippedNoMatch = 0;
    let skippedManual = 0;
    let failed = 0;

    openSheet({
      title: 'Auto photos',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="muted" id="kitAutoPhotoStatus">Starting…</p>
          <div class="kit-lib-auto-progress" aria-hidden="true">
            <div class="kit-lib-auto-progress-bar" id="kitAutoPhotoBar" style="width:0%"></div>
          </div>
          <p class="muted kit-lib-auto-meta" id="kitAutoPhotoMeta">0 / ${targets.length}</p>
          <div class="kit-lib-auto-log" id="kitAutoPhotoLog"></div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitAutoPhotoSkip">Skip</button>
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitAutoPhotoCancel">Cancel</button>
          </div>
        </div>`,
    });

    const statusEl = $('kitAutoPhotoStatus');
    const barEl = $('kitAutoPhotoBar');
    const metaEl = $('kitAutoPhotoMeta');
    const logEl = $('kitAutoPhotoLog');
    $('kitAutoPhotoCancel').onclick = () => {
      cancelled = true;
      if (statusEl) statusEl.textContent = 'Cancelling after current item…';
    };
    $('kitAutoPhotoSkip').onclick = () => {
      skipCurrent = true;
      if (statusEl) statusEl.textContent = 'Skipping…';
    };

    function logLine(text, kind = '') {
      if (!logEl) return;
      const row = document.createElement('div');
      row.className = `kit-lib-auto-log-line${kind ? ` kit-lib-auto-log-line--${kind}` : ''}`;
      row.textContent = text;
      logEl.prepend(row);
    }

    function paintProgress() {
      const pct = targets.length ? Math.round((done / targets.length) * 100) : 0;
      if (barEl) barEl.style.width = `${pct}%`;
      if (metaEl) {
        metaEl.textContent = `${done} / ${targets.length} · ${filled} set`
          + (skippedExisting ? ` · ${skippedExisting} already had` : '')
          + (skippedManual ? ` · ${skippedManual} skipped` : '')
          + (skippedNoMatch ? ` · ${skippedNoMatch} no match` : '')
          + (failed ? ` · ${failed} failed` : '');
      }
    }

    const DB = getDB();
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    for (const p of targets) {
      if (cancelled) break;
      skipCurrent = false;

      // Re-check in case a photo was added since the run started
      if (skipExisting && (p.image_url || '').trim()) {
        skippedExisting += 1;
        done += 1;
        logLine(`${p.name}: already has photo — skipped`, 'skip');
        paintProgress();
        continue;
      }

      if (statusEl) statusEl.textContent = `Searching “${p.name || 'item'}”…`;
      try {
        const candidate = await findKitImageCandidate(p);
        if (cancelled) break;
        if (skipCurrent) {
          skippedManual += 1;
          logLine(`${p.name}: skipped`, 'skip');
        } else if (!candidate) {
          skippedNoMatch += 1;
          logLine(`${p.name}: no match`, 'skip');
        } else if (candidate.file) {
          if (statusEl) statusEl.textContent = `Saving “${p.name || 'item'}”…`;
          const path = `kit/${p.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${imageExt(candidate.file)}`;
          const url = await DB.uploadImage(PRODUCT_IMAGE_BUCKET, path, candidate.file);
          if (cancelled || skipCurrent) {
            skippedManual += 1;
            logLine(`${p.name}: skipped`, 'skip');
          } else {
            await DB.products.update(p.id, { image_url: url });
            p.image_url = url;
            filled += 1;
            logLine(`${p.name}: photo set`, 'ok');
          }
        } else if (candidate.remoteUrl) {
          if (cancelled || skipCurrent) {
            skippedManual += 1;
            logLine(`${p.name}: skipped`, 'skip');
          } else {
            await DB.products.update(p.id, { image_url: candidate.remoteUrl });
            p.image_url = candidate.remoteUrl;
            filled += 1;
            logLine(`${p.name}: photo linked`, 'ok');
          }
        } else {
          skippedNoMatch += 1;
          logLine(`${p.name}: no match`, 'skip');
        }
      } catch (err) {
        if (skipCurrent) {
          skippedManual += 1;
          logLine(`${p.name}: skipped`, 'skip');
        } else {
          failed += 1;
          logLine(`${p.name}: ${err.message || 'failed'}`, 'err');
        }
      }
      done += 1;
      paintProgress();
      if (!cancelled && done < targets.length) await delay(1100);
      if (done % 8 === 0) paintTable();
    }

    autoPhotoRunning = false;
    paintTable();
    if (statusEl) {
      statusEl.textContent = cancelled
        ? `Stopped early — ${filled} photo${filled === 1 ? '' : 's'} set.`
        : `Done — ${filled} photo${filled === 1 ? '' : 's'} set`
          + (skippedExisting ? `, ${skippedExisting} already had a photo` : '')
          + (skippedManual ? `, ${skippedManual} skipped` : '')
          + (skippedNoMatch ? `, ${skippedNoMatch} no match` : '')
          + (failed ? `, ${failed} failed` : '')
          + '.';
    }
    const skipBtn = $('kitAutoPhotoSkip');
    if (skipBtn) skipBtn.hidden = true;
    const cancelBtn = $('kitAutoPhotoCancel');
    if (cancelBtn) {
      cancelBtn.textContent = 'Close';
      cancelBtn.onclick = closeSheet;
    }
    toast(cancelled
      ? `Auto photos stopped (${filled} set)`
      : `Auto photos finished (${filled} set)`);
  }

  function openCategoriesManager() {
    function paintCatList() {
      const list = categories
        .slice()
        .sort((a, b) => (a.sort_order - b.sort_order) || (a.name || '').localeCompare(b.name || ''));
      const el = $('kitCatList');
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<p class="muted" style="font-size:13px">No kit categories yet.</p>';
        return;
      }
      el.innerHTML = `
        <div class="kit-cat-list">
          ${list.map((c) => {
            const count = products.filter((p) => p.category_id === c.id).length;
            return `
              <div class="kit-cat-row" data-cat-id="${escapeHtml(c.id)}">
                <div class="kit-cat-row-main">
                  <span class="kit-cat-name">${escapeHtml(c.name)}</span>
                  <span class="muted kit-cat-count">${count} item${count === 1 ? '' : 's'}</span>
                </div>
                <button type="button" class="topbar-tool" data-edit-cat="${escapeHtml(c.id)}"
                  title="Edit category" aria-label="Edit ${escapeHtml(c.name)}">
                  ${icon('pencil', { size: 14 })}
                </button>
              </div>`;
          }).join('')}
        </div>`;
      el.querySelectorAll('[data-edit-cat]').forEach((btn) => {
        btn.onclick = () => openCategoryForm(btn.dataset.editCat);
      });
    }

    openSheet({
      title: 'Kit categories',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="kitCatMgrErr"></div>
          <div id="kitCatList"></div>
          <button type="button" class="admin-drawer-btn" id="kitCatAdd">+ New category</button>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitCatClose">Close</button>
          </div>
        </div>`,
    });

    paintCatList();
    $('kitCatClose').onclick = closeSheet;
    $('kitCatAdd').onclick = () => openCategoryForm(null);
  }

  function openCategoryForm(editId) {
    const c = editId ? categories.find((x) => x.id === editId) : null;
    const colourOpts = CATEGORY_COLOURS.map((o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === (c?.colour_key || colourKey(c?.name) || 'rtd') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');

    openSheet({
      title: c ? 'Edit kit category' : 'New kit category',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="kitCatErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="kitCatName">Name</label>
            <input class="admin-input" type="text" id="kitCatName" required placeholder="e.g. Power">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="kitCatColour">Badge colour</label>
            <select class="admin-select" id="kitCatColour">${colourOpts}</select>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${c ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="kitCatDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="kitCatCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="kitCatSave">${c ? 'Update' : 'Save'}</button>
          </div>
        </div>`,
    });

    if (c) $('kitCatName').value = c.name || '';

    $('kitCatCancel').onclick = () => {
      closeSheet();
      openCategoriesManager();
    };
    $('kitCatSave').onclick = async () => {
      const name = ($('kitCatName')?.value || '').trim();
      if (!name) {
        $('kitCatErr').textContent = 'Name is required.';
        return;
      }
      const dupe = categories.find((x) =>
        x.name.toLowerCase() === name.toLowerCase() && (!c || x.id !== c.id));
      if (dupe) {
        $('kitCatErr').textContent = 'A kit category with that name already exists.';
        return;
      }
      const patch = {
        name,
        colour_key: $('kitCatColour')?.value || colourKey(name),
        kind: 'kit',
      };
      const btn = $('kitCatSave');
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
        openCategoriesManager();
      } catch (err) {
        $('kitCatErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };

    if (c) {
      $('kitCatDelete').onclick = async () => {
        const linked = products.filter((p) => p.category_id === c.id).length;
        if (linked) {
          toast(`Move or reassign ${linked} item${linked === 1 ? '' : 's'} before deleting.`, true);
          return;
        }
        if (!(await confirmDialog({ title: 'Confirm', message: `Delete category “${c.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
        try {
          await getDB().categories.remove(c.id);
          closeSheet();
          await refresh();
          toast('Category deleted');
          openCategoriesManager();
        } catch (err) {
          toast(err.message || 'Delete failed', true);
        }
      };
    }
  }

  async function refresh() {
    const [prods, cats, stock, contentRows] = await Promise.all([
      loadKitLibraryProducts(),
      loadKitCategories(),
      loadKitStockMap(),
      loadKitContainerContents(),
    ]);
    products = prods || [];
    categories = cats || [];
    stockMap = stock;
    contentsMap = contentsByContainer(contentRows || []);
    // Keep category filter if still valid
    if (filterCat && !categories.some((c) => c.name === filterCat)
      && !products.some((p) => p.category?.name === filterCat)) {
      filterCat = '';
    }
    paintTable();
  }

  tableEl?.querySelectorAll('th[data-sort]').forEach((th) => {
    th.style.cursor = 'pointer';
    th.onclick = () => {
      const key = th.dataset.sort;
      if (!key) return;
      const nextDir = sortKey === key
        ? (sortDir === 1 ? 'desc' : 'asc')
        : 'asc';
      sortKey = key;
      sortDir = nextDir === 'desc' ? -1 : 1;
      paintTable();
      patchTableFilterState('kit-library', { sort: key, sortDir: nextDir });
    };
  });

  const onProductFilter = (e) => {
    productFilter = e.detail || {};
    paintTable();
    if (e.detail?.productId) e.detail.handled = true;
  };

  const onToolbarAction = (e) => {
    const action = e.detail?.action;
    if (action === 'new-kit-item') {
      e.detail.handled = true;
      openKitForm(null);
    } else if (action === 'kit-mobile-count') {
      e.detail.handled = true;
      openMobileCountPairing();
    } else if (action === 'kit-label-queue') {
      e.detail.handled = true;
      openLabelPrintQueue();
    } else if (action === 'manage-kit-categories') {
      e.detail.handled = true;
      openCategoriesManager();
    } else if (action === 'auto-kit-photos') {
      e.detail.handled = true;
      runAutoPhotos();
    }
  };

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'kit-library') return;
    applyTableFilterValues(e.detail?.values);
    paintTable();
  };

  function openMobileCountPairing() {
    openMobileCountPairingAsync().catch((err) => toast(err.message || 'Could not open', true));
  }

  async function openLabelPrintQueue() {
    let rows = [];
    try {
      rows = await loadPendingKitLabelQueue(getDB());
    } catch (err) {
      toast(err.message || 'Could not load print queue', true);
      return;
    }

    const paintQueue = () => {
      const stats = pendingLabelQueueStats(rows);
      const listEl = $('kitLabelQueueList');
      const metaEl = $('kitLabelQueueMeta');
      const printAllBtn = $('kitLabelQueuePrintAll');
      if (metaEl) {
        metaEl.textContent = stats.items
          ? `${stats.items} item${stats.items === 1 ? '' : 's'} · ${stats.copies} label${stats.copies === 1 ? '' : 's'}`
          : 'Queue empty';
      }
      if (printAllBtn) printAllBtn.disabled = !stats.items;
      if (!listEl) return;
      if (!rows.length) {
        listEl.innerHTML = '<p class="muted">No labels waiting. Queue them from mobile kit count when you create or count items.</p>';
        return;
      }
      listEl.innerHTML = rows.map((row) => {
        const p = row.product || products.find((x) => x.id === row.product_id) || {};
        const name = p.name || 'Kit item';
        const meta = [
          p.is_container ? 'Container' : null,
          p.category?.name || null,
          p.barcode ? 'Has barcode' : 'Needs barcode',
        ].filter(Boolean).join(' · ');
        return `
          <div class="kit-label-queue-row" data-qid="${escapeHtml(row.id)}" data-pid="${escapeHtml(row.product_id)}">
            <div class="kit-label-queue-main">
              <strong>${escapeHtml(name)}</strong>
              <span class="muted">${escapeHtml(meta)}</span>
            </div>
            <input type="number" min="1" max="50" class="admin-input kit-label-queue-copies"
              value="${escapeHtml(String(row.copies || 1))}" aria-label="Copies for ${escapeHtml(name)}">
            <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-print-one>Print</button>
            <button type="button" class="topbar-tool" data-remove-one title="Remove" aria-label="Remove ${escapeHtml(name)}">
              ${icon('x', { size: 14 })}
            </button>
          </div>`;
      }).join('');

      listEl.querySelectorAll('.kit-label-queue-row').forEach((el) => {
        const qid = el.dataset.qid;
        const pid = el.dataset.pid;
        el.querySelector('[data-print-one]')?.addEventListener('click', async () => {
          const product = products.find((x) => x.id === pid)
            || rows.find((r) => r.id === qid)?.product;
          if (!product) {
            toast('Product missing', true);
            return;
          }
          const copiesInp = el.querySelector('.kit-label-queue-copies');
          const copies = Math.max(1, Math.min(50, Number(copiesInp?.value) || 1));
          try {
            await printQueuedLabel(product, copies);
            await markKitLabelsPrinted(getDB(), [qid]);
            rows = rows.filter((r) => r.id !== qid);
            paintQueue();
            toast(`Printed ${copies} · removed from queue`);
          } catch (err) {
            toast(err.message || 'Print failed', true);
          }
        });
        el.querySelector('[data-remove-one]')?.addEventListener('click', async () => {
          try {
            await removeKitLabelQueueItem(getDB(), qid);
            rows = rows.filter((r) => r.id !== qid);
            paintQueue();
          } catch (err) {
            toast(err.message || 'Remove failed', true);
          }
        });
        el.querySelector('.kit-label-queue-copies')?.addEventListener('change', async (ev) => {
          const copies = Math.max(1, Math.min(50, Number(ev.target.value) || 1));
          ev.target.value = String(copies);
          try {
            await setKitLabelQueueCopies(getDB(), qid, copies);
            const row = rows.find((r) => r.id === qid);
            if (row) row.copies = copies;
            paintQueue();
          } catch (err) {
            toast(err.message || 'Could not update copies', true);
          }
        });
      });
    };

    openModal({
      title: 'Kit label print queue',
      bodyHtml: `
        <div class="kit-label-queue">
          <p class="admin-hint muted" id="kitLabelQueueMeta"></p>
          <p class="admin-hint muted">Prints to the Brother QL-800 over USB (Chrome / Edge). Queue items from mobile kit count.</p>
          <div id="kitLabelQueueList" class="kit-label-queue-list"></div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot-actions" style="justify-content:flex-end;width:100%;gap:8px">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="kitLabelQueueClose">Close</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="kitLabelQueuePrintAll">Print all</button>
        </div>`,
    });

    $('kitLabelQueueClose').onclick = () => closeModal();
    $('kitLabelQueuePrintAll').onclick = async () => {
      if (!rows.length) return;
      const btn = $('kitLabelQueuePrintAll');
      if (btn) btn.disabled = true;
      const printedIds = [];
      try {
        for (const row of [...rows]) {
          const product = products.find((x) => x.id === row.product_id) || row.product;
          if (!product?.id) continue;
          const copies = Math.max(1, Math.min(50, Number(row.copies) || 1));
          await printQueuedLabel(product, copies);
          printedIds.push(row.id);
        }
        if (printedIds.length) {
          await markKitLabelsPrinted(getDB(), printedIds);
          rows = rows.filter((r) => !printedIds.includes(r.id));
          paintQueue();
          toast(`Printed ${printedIds.length} queue item${printedIds.length === 1 ? '' : 's'}`);
        }
      } catch (err) {
        if (printedIds.length) {
          await markKitLabelsPrinted(getDB(), printedIds).catch(() => {});
          rows = rows.filter((r) => !printedIds.includes(r.id));
          paintQueue();
        }
        toast(err.message || 'Print failed', true);
      } finally {
        if (btn) btn.disabled = !rows.length;
      }
    };

    paintQueue();
  }

  /**
   * @param {object} product
   * @param {number} copies
   */
  async function printQueuedLabel(product, copies) {
    const resolved = resolveKitLabelPayload(product);
    let barcode = resolved.barcode;
    if (resolved.shouldPersist) {
      await getDB().products.update(product.id, { barcode });
      const local = products.find((x) => x.id === product.id);
      if (local) local.barcode = barcode;
      product.barcode = barcode;
    }
    await printKitLabelPdf({
      name: product.name || 'Kit item',
      barcode,
      isContainer: !!product.is_container,
      copies,
    });
  }

  async function openMobileCountPairingAsync() {
    let phoneOrigin = location.origin;
    try {
      const resolved = await resolvePhoneOrigin();
      if (resolved?.origin) phoneOrigin = resolved.origin;
    } catch { /* use location.origin */ }
    const url = `${String(phoneOrigin).replace(/\/$/, '')}/app/?tab=kit`;
    openModal({
      title: 'Mobile kit count',
      bodyHtml: `
        <div class="kit-scan-pair" style="padding:4px 0 8px">
          <img class="kit-scan-qr" src="${escapeHtml(qrImageUrl(url, 160))}"
            width="160" height="160" alt="QR code for Measured kit count">
          <div class="kit-scan-pair-meta">
            <p class="admin-hint" style="margin:0 0 8px">
              Opens Measured on your phone (Kit tab). Install / Add to Home Screen for the app icon.
              Choose event or warehouse, then count containers and what’s inside.
            </p>
            <a class="kit-scan-pair-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>
          </div>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot-actions" style="justify-content:flex-end;width:100%">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="kitMobileCountClose">Close</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="kitMobileCountOpen">Open here</button>
        </div>`,
    });
    $('kitMobileCountClose').onclick = () => closeModal();
    $('kitMobileCountOpen').onclick = () => {
      window.open(url, '_blank', 'noopener');
      closeModal();
    };
  }

  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  refresh().catch((err) => {
    bodyEl.innerHTML = `<tr><td colspan="7" class="del-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
  });

  return () => {
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
