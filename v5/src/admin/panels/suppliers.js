/**
 * Admin suppliers panel — global catalogue (list + detail, sheet to edit).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadSuppliers, loadLibraryProducts } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { parseQty } from '../../stock-entry.js';
import { confirmDialog } from '../../components/modal.js';

function fmtGbp(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function clampSor(raw) {
  let sor = parseQty(raw);
  if (!Number.isFinite(sor)) sor = 0;
  return Math.max(0, Math.min(100, Math.round(sor)));
}

function linkedProductRows(supplierId, products) {
  const rows = [];
  (products || []).forEach((p) => {
    const offers = (p.product_suppliers || []).filter((ps) => ps.supplier_id === supplierId);
    if (offers.length) {
      offers.forEach((row) => rows.push({ p, row }));
    } else if (p.supplier_id === supplierId) {
      rows.push({ p, row: null });
    }
  });
  rows.sort((a, b) => (a.p.name || '').localeCompare(b.p.name || '') ||
    ((a.row?.pack_size) || '').localeCompare((b.row?.pack_size) || ''));
  return rows;
}

function isSupplierLinked(supplierId, products) {
  return (products || []).some((p) =>
    p.supplier_id === supplierId ||
    (p.product_suppliers || []).some((ps) => ps.supplier_id === supplierId));
}

function renderShell() {
  return `
    <div class="admin-page sup-panel">
      <div class="catalog-layout">
        <aside class="catalog-list-card admin-surface">
          <div class="catalog-list-head">
            <input type="search" class="admin-input" id="supSearch"
              placeholder="Search suppliers…" autocomplete="off" aria-label="Search suppliers">
          </div>
          <div class="catalog-list" id="supList">
            <div class="catalog-list-empty muted">Loading suppliers…</div>
          </div>
        </aside>
        <section class="catalog-detail admin-surface" id="supDetail">
          <div class="catalog-detail-empty" id="supDetailEmpty">
            ${icon('truck', { size: 32, strokeWidth: 1.5 })}
            <p>Select a supplier to view details, or add a new one from the toolbar.</p>
          </div>
          <div id="supDetailBody" hidden></div>
        </section>
      </div>
    </div>`;
}

function renderListItems(suppliers, selectedId, query) {
  const q = (query || '').trim().toLowerCase();
  const list = (suppliers || [])
    .filter((s) => !q || (s.name || '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!list.length) {
    return `<div class="catalog-list-empty">${suppliers?.length
      ? 'No suppliers match your search.'
      : 'No suppliers yet. Add your first one.'}</div>`;
  }

  return list.map((s) => {
    const sor = Number(s.default_sor_pct) || 0;
    const active = s.id === selectedId ? ' catalog-list-item--active' : '';
    return `
      <button type="button" class="catalog-list-item${active}" data-sup-id="${escapeHtml(s.id)}">
        <span class="catalog-list-name">${escapeHtml(s.name || 'Supplier')}</span>
        <span class="catalog-list-meta">SOR ${sor}%</span>
      </button>`;
  }).join('');
}

function roValue(val) {
  const has = val != null && String(val).trim() !== '';
  return has ? escapeHtml(val) : '<span class="catalog-ro-empty">—</span>';
}

function renderDetail(s, products) {
  if (!s) return '';

  const rows = linkedProductRows(s.id, products);
  const sor = Number(s.default_sor_pct) || 0;

  const productTable = rows.length
    ? `<div class="catalog-table-wrap">
        <table class="catalog-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Pack size</th>
              <th>Category</th>
              <th>Case price</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ p, row }) => {
              const pack = (row?.pack_size) || p.case_size || '—';
              const price = row ? row.case_price : p.case_price;
              const pref = row ? row.is_preferred : (p.supplier_id === s.id);
              const cat = p.category?.name || '—';
              return `<tr>
                <td>
                  <span class="catalog-table-primary">${escapeHtml(p.name || 'Product')}</span>
                  ${pref ? '<span class="catalog-tag">pref</span>' : ''}
                </td>
                <td>${escapeHtml(pack)}</td>
                <td>${escapeHtml(cat)}</td>
                <td>${price != null ? escapeHtml(fmtGbp(price)) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`
    : '<div class="catalog-list-empty">No products linked to this supplier yet.</div>';

  return `
    <div class="catalog-detail-head">
      <div class="catalog-detail-head-main">
        <h2 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(s.name || 'Supplier')}</span></h2>
        <p class="catalog-detail-meta">
          ${rows.length} price line${rows.length !== 1 ? 's' : ''} · SOR ${sor}%
        </p>
      </div>
      <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="supEditBtn"
        title="Edit supplier" aria-label="Edit supplier">
        ${icon('pencil', { size: 16, strokeWidth: 2.5 })}<span>Edit</span>
      </button>
    </div>
    <div class="catalog-ro-grid">
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Contact name</span>
        <span class="catalog-ro-value">${roValue(s.contact_name)}</span>
      </div>
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Email</span>
        <span class="catalog-ro-value">${roValue(s.email)}</span>
      </div>
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Phone</span>
        <span class="catalog-ro-value">${roValue(s.phone)}</span>
      </div>
      <div class="catalog-ro-field">
        <span class="catalog-ro-label">Default SOR %</span>
        <span class="catalog-ro-value">${sor}%</span>
      </div>
      <div class="catalog-ro-field catalog-ro-field--full">
        <span class="catalog-ro-label">Address</span>
        <span class="catalog-ro-value">${roValue(s.address)}</span>
      </div>
    </div>
    <div class="catalog-detail-section">
      <h3 class="catalog-section-title">Products</h3>
      ${productTable}
    </div>`;
}

export function renderSuppliersShell() {
  return renderShell();
}

export async function mountSuppliersPanel() {
  const listEl = $('supList');
  const detailEmpty = $('supDetailEmpty');
  const detailBody = $('supDetailBody');
  const searchEl = $('supSearch');
  if (!listEl) return () => {};

  let suppliers = [];
  let products = [];
  let selectedId = null;
  let searchQuery = '';

  function paintList() {
    listEl.innerHTML = renderListItems(suppliers, selectedId, searchQuery);
    listEl.querySelectorAll('[data-sup-id]').forEach((btn) => {
      btn.onclick = async () => selectSupplier(btn.dataset.supId);
    });
  }

  function paintDetail() {
    const s = selectedId ? suppliers.find((x) => x.id === selectedId) : null;
    if (!s) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(s, products);
    $('supEditBtn')?.addEventListener('click', async () => openSupplierForm(s.id));
  }

  function selectSupplier(id) {
    selectedId = id;
    paintList();
    paintDetail();
  }

  async function refresh() {
    const DB = getDB();
    [suppliers, products] = await Promise.all([
      loadSuppliers(),
      loadLibraryProducts(),
    ]);
    if (selectedId && !suppliers.some((s) => s.id === selectedId)) {
      selectedId = suppliers[0]?.id || null;
    }
    if (!selectedId && suppliers.length === 1) {
      selectedId = suppliers[0].id;
    }
    paintList();
    paintDetail();
  }

  async function saveSupplier(editId) {
    const name = ($('supName')?.value || '').trim();
    if (!name) {
      $('supErr').textContent = 'Name is required.';
      return;
    }

    const patch = {
      name,
      contact_name: ($('supContact')?.value || '').trim() || null,
      email: ($('supEmail')?.value || '').trim() || null,
      phone: ($('supPhone')?.value || '').trim() || null,
      address: ($('supAddress')?.value || '').trim() || null,
      default_sor_pct: clampSor($('supSor')?.value),
    };

    const btn = $('supSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      if (editId) {
        await DB.suppliers.update(editId, patch);
      } else {
        const created = await DB.suppliers.create(patch);
        if (created?.id) selectedId = created.id;
      }
      closeSheet();
      await refresh();
      toast(editId ? 'Supplier updated' : 'Supplier created');
    } catch (err) {
      $('supErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editId ? 'Update supplier' : 'Save supplier';
    }
  }

  async function deleteSupplier(id) {
    if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this supplier? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    if (isSupplierLinked(id, products)) {
      toast('Can\'t delete — products are still linked to this supplier. Reassign them first.', true);
      return;
    }
    try {
      await getDB().suppliers.remove(id);
      if (selectedId === id) selectedId = null;
      closeSheet();
      await refresh();
      toast('Supplier deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openSupplierForm(editId) {
    const s = editId ? suppliers.find((x) => x.id === editId) : null;

    openSheet({
      title: s ? 'Edit supplier' : 'New supplier',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="supErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="supName">Name</label>
            <input class="admin-input" type="text" id="supName" required placeholder="Supplier name">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="supContact">Contact name</label>
              <input class="admin-input" type="text" id="supContact" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="supSor">Default SOR %</label>
              <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="supSor" placeholder="0">
            </div>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="supEmail">Email</label>
              <input class="admin-input" type="email" id="supEmail" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="supPhone">Phone</label>
              <input class="admin-input" type="tel" id="supPhone" placeholder="Optional">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="supAddress">Address</label>
            <textarea class="admin-textarea" id="supAddress" rows="3" placeholder="Optional"></textarea>
          </div>
          <p class="wst-form-hint muted">SOR % is the default sale-or-return allowance for products from this supplier.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${s ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="supDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="supCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="supSave">${s ? 'Update supplier' : 'Save supplier'}</button>
          </div>
        </div>`,
    });

    if (s) {
      $('supName').value = s.name || '';
      $('supContact').value = s.contact_name || '';
      $('supSor').value = s.default_sor_pct != null ? String(s.default_sor_pct) : '';
      $('supEmail').value = s.email || '';
      $('supPhone').value = s.phone || '';
      $('supAddress').value = s.address || '';
    }

    $('supCancel').onclick = closeSheet;
    $('supSave').onclick = async () => saveSupplier(editId || null);
    if (s) $('supDelete').onclick = async () => deleteSupplier(s.id);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-supplier') {
      e.detail.handled = true;
      openSupplierForm();
    }
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}function paintList() {
    listEl.innerHTML = renderListItems(suppliers, selectedId, searchQuery);
    listEl.querySelectorAll('[data-sup-id]').forEach((btn) => {
      btn.onclick = async () => selectSupplier(btn.dataset.supId);
    });
  }

  function paintDetail() {
    const s = selectedId ? suppliers.find((x) => x.id === selectedId) : null;
    if (!s) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(s, products);
    $('supEditBtn')?.addEventListener('click', async () => openSupplierForm(s.id));
  }

  function selectSupplier(id) {
    selectedId = id;
    paintList();
    paintDetail();
  }

  async function refresh() {
    const DB = getDB();
    [suppliers, products] = await Promise.all([
      loadSuppliers(),
      loadLibraryProducts(),
    ]);
    if (selectedId && !suppliers.some((s) => s.id === selectedId)) {
      selectedId = suppliers[0]?.id || null;
    }
    if (!selectedId && suppliers.length === 1) {
      selectedId = suppliers[0].id;
    }
    paintList();
    paintDetail();
  }

  async function saveSupplier(editId) {
    const name = ($('supName')?.value || '').trim();
    if (!name) {
      $('supErr').textContent = 'Name is required.';
      return;
    }

    const patch = {
      name,
      contact_name: ($('supContact')?.value || '').trim() || null,
      email: ($('supEmail')?.value || '').trim() || null,
      phone: ($('supPhone')?.value || '').trim() || null,
      address: ($('supAddress')?.value || '').trim() || null,
      default_sor_pct: clampSor($('supSor')?.value),
    };

    const btn = $('supSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      if (editId) {
        await DB.suppliers.update(editId, patch);
      } else {
        const created = await DB.suppliers.create(patch);
        if (created?.id) selectedId = created.id;
      }
      closeSheet();
      await refresh();
      toast(editId ? 'Supplier updated' : 'Supplier created');
    } catch (err) {
      $('supErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editId ? 'Update supplier' : 'Save supplier';
    }
  }

  async function deleteSupplier(id) {
    if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this supplier? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    if (isSupplierLinked(id, products)) {
      toast('Can\'t delete — products are still linked to this supplier. Reassign them first.', true);
      return;
    }
    try {
      await getDB().suppliers.remove(id);
      if (selectedId === id) selectedId = null;
      closeSheet();
      await refresh();
      toast('Supplier deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openSupplierForm(editId) {
    const s = editId ? suppliers.find((x) => x.id === editId) : null;

    openSheet({
      title: s ? 'Edit supplier' : 'New supplier',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="supErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="supName">Name</label>
            <input class="admin-input" type="text" id="supName" required placeholder="Supplier name">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="supContact">Contact name</label>
              <input class="admin-input" type="text" id="supContact" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="supSor">Default SOR %</label>
              <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="supSor" placeholder="0">
            </div>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="supEmail">Email</label>
              <input class="admin-input" type="email" id="supEmail" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="supPhone">Phone</label>
              <input class="admin-input" type="tel" id="supPhone" placeholder="Optional">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="supAddress">Address</label>
            <textarea class="admin-textarea" id="supAddress" rows="3" placeholder="Optional"></textarea>
          </div>
          <p class="wst-form-hint muted">SOR % is the default sale-or-return allowance for products from this supplier.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${s ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="supDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="supCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="supSave">${s ? 'Update supplier' : 'Save supplier'}</button>
          </div>
        </div>`,
    });

    if (s) {
      $('supName').value = s.name || '';
      $('supContact').value = s.contact_name || '';
      $('supSor').value = s.default_sor_pct != null ? String(s.default_sor_pct) : '';
      $('supEmail').value = s.email || '';
      $('supPhone').value = s.phone || '';
      $('supAddress').value = s.address || '';
    }

    $('supCancel').onclick = closeSheet;
    $('supSave').onclick = async () => saveSupplier(editId || null);
    if (s) $('supDelete').onclick = async () => deleteSupplier(s.id);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-supplier') {
      e.detail.handled = true;
      openSupplierForm();
    }
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refresh().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}function paintList() {
    listEl.innerHTML = renderListItems(suppliers, selectedId, searchQuery);
    listEl.querySelectorAll('[data-sup-id]').forEach((btn) => {
      btn.onclick = async () => selectSupplier(btn.dataset.supId);
    });
  }

  function paintDetail() {
    const s = selectedId ? suppliers.find((x) => x.id === selectedId) : null;
    if (!s) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = renderDetail(s, products);
    $('supEditBtn')?.addEventListener('click', async () => openSupplierForm(s.id));
  }

  function selectSupplier(id) {
    selectedId = id;
    paintList();
    paintDetail();
  }

  async function refresh() {
    const DB = getDB();
    [suppliers, products] = await Promise.all([
      loadSuppliers(),
      loadLibraryProducts(),
    ]);
    if (selectedId && !suppliers.some((s) => s.id === selectedId)) {
      selectedId = suppliers[0]?.id || null;
    }
    if (!selectedId && suppliers.length === 1) {
      selectedId = suppliers[0].id;
    }
    paintList();
    paintDetail();
  }

  async function saveSupplier(editId) {
    const name = ($('supName')?.value || '').trim();
    if (!name) {
      $('supErr').textContent = 'Name is required.';
      return;
    }

    const patch = {
      name,
      contact_name: ($('supContact')?.value || '').trim() || null,
      email: ($('supEmail')?.value || '').trim() || null,
      phone: ($('supPhone')?.value || '').trim() || null,
      address: ($('supAddress')?.value || '').trim() || null,
      default_sor_pct: clampSor($('supSor')?.value),
    };

    const btn = $('supSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      if (editId) {
        await DB.suppliers.update(editId, patch);
      } else {
        const created = await DB.suppliers.create(patch);
        if (created?.id) selectedId = created.id;
      }
      closeSheet();
      await refresh();
      toast(editId ? 'Supplier updated' : 'Supplier created');
    } catch (err) {
      $('supErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = editId ? 'Update supplier' : 'Save supplier';
    }
  }

  async function deleteSupplier(id) {
    if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this supplier? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    if (isSupplierLinked(id, products)) {
      toast('Can\'t delete — products are still linked to this supplier. Reassign them first.', true);
      return;
    }
    try {
      await getDB().suppliers.remove(id);
      if (selectedId === id) selectedId = null;
      closeSheet();
      await refresh();
      toast('Supplier deleted');
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  function openSupplierForm(editId) {
    const s = editId ? suppliers.find((x) => x.id === editId) : null;

    openSheet({
      title: s ? 'Edit supplier' : 'New supplier',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="supErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="supName">Name</label>
            <input class="admin-input" type="text" id="supName" required placeholder="Supplier name">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="supContact">Contact name</label>
              <input class="admin-input" type="text" id="supContact" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="supSor">Default SOR %</label>
              <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="supSor" placeholder="0">
            </div>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="supEmail">Email</label>
              <input class="admin-input" type="email" id="supEmail" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="supPhone">Phone</label>
              <input class="admin-input" type="tel" id="supPhone" placeholder="Optional">
            </div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="supAddress">Address</label>
            <textarea class="admin-textarea" id="supAddress" rows="3" placeholder="Optional"></textarea>
          </div>
          <p class="wst-form-hint muted">SOR % is the default sale-or-return allowance for products from this supplier.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${s ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="supDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="supCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="supSave">${s ? 'Update supplier' : 'Save supplier'}</button>
          </div>
        </div>`,
    });

    if (s) {
      $('supName').value = s.name || '';
      $('supContact').value = s.contact_name || '';
      $('supSor').value = s.default_sor_pct != null ? String(s.default_sor_pct) : '';
      $('supEmail').value = s.email || '';
      $('supPhone').value = s.phone || '';
      $('supAddress').value = s.address || '';
    }

    $('supCancel').onclick = closeSheet;
    $('supSave').onclick = async () => saveSupplier(editId || null);
    if (s) $('supDelete').onclick = async () => deleteSupplier(s.id);
  }

  searchEl?.addEventListener('input', () => {
    searchQuery = searchEl.value;
    paintList();
  });

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-supplier') {
      e.detail.handled = true;
      openSupplierForm();
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
