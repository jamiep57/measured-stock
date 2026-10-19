/**
 * Admin suppliers panel — global catalogue (list + detail, sheet to edit).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadSuppliers, loadLibraryProducts } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
} from '../table-filter.js';
import { parseQty } from '../../stock-entry.js';
import { confirmDialog } from '../../components/modal.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';

function fmtGbp(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function colourKey(cat) {
  const key = cat?.colour_key || String(cat?.name || '').toLowerCase();
  if (key.includes('beer')) return 'beer';
  if (key.includes('cider')) return 'cider';
  if (key.includes('wine')) return 'wine';
  if (key.includes('spirit')) return 'spirits';
  if (key.includes('soft') || key.includes('seltzer') || key.includes('water')) return 'softs';
  if (['beer', 'cider', 'wine', 'rtd', 'softs', 'spirits'].includes(key)) return key;
  return 'rtd';
}

function categoryBadge(cat) {
  if (!cat?.name) return '<span class="muted">—</span>';
  const key = colourKey(cat);
  return `<span class="cat-badge cat-badge--${escapeHtml(key)}">${escapeHtml(cat.name)}</span>`;
}

function textOrNull(id) {
  return ($(id)?.value || '').trim() || null;
}

/** Account manager falls back to the original single contact. */
function roleContact(s, role) {
  const name = s?.[`${role}_name`] || (role === 'account_manager' ? s?.contact_name : '') || '';
  const phone = s?.[`${role}_phone`] || (role === 'account_manager' ? s?.phone : '') || '';
  const email = s?.[`${role}_email`] || (role === 'account_manager' ? s?.email : '') || '';
  return {
    name: String(name).trim(),
    phone: String(phone).trim(),
    email: String(email).trim(),
  };
}

function supplierSearchText(s) {
  const roles = ['account_manager', 'orders', 'accounts'].map((role) => roleContact(s, role));
  return [
    s.name, s.address, s.contact_name, s.email, s.phone,
    ...roles.flatMap((c) => [c.name, c.phone, c.email]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function contactCard(label, iconName, contact) {
  const lines = [];
  if (contact.name) {
    lines.push(`<div class="sup-contact-name">${escapeHtml(contact.name)}</div>`);
  }
  if (contact.phone) {
    const tel = contact.phone.replace(/[^\d+]/g, '');
    const inner = `${icon('phone', { size: 13 })}<span>${escapeHtml(contact.phone)}</span>`;
    lines.push(tel
      ? `<a class="sup-contact-line" href="tel:${escapeHtml(tel)}">${inner}</a>`
      : `<span class="sup-contact-line">${inner}</span>`);
  }
  if (contact.email) {
    const inner = `${icon('mail', { size: 13 })}<span>${escapeHtml(contact.email)}</span>`;
    const mailto = /^[^\s@]+@[^\s@]+$/.test(contact.email);
    lines.push(mailto
      ? `<a class="sup-contact-line" href="mailto:${escapeHtml(contact.email)}">${inner}</a>`
      : `<span class="sup-contact-line">${inner}</span>`);
  }
  const body = lines.length
    ? lines.join('')
    : '<p class="sup-contact-empty">No contact yet</p>';
  return `
    <article class="sup-contact-card">
      <header class="sup-contact-role">${icon(iconName, { size: 14 })}<span>${escapeHtml(label)}</span></header>
      ${body}
    </article>`;
}

function contactFormGroup(title, ids) {
  return `
    <section class="sup-form-group">
      <h3 class="sup-form-group-title">${escapeHtml(title)}</h3>
      <div class="admin-field">
        <label class="admin-label" for="${ids.name}">Name</label>
        <input class="admin-input" type="text" id="${ids.name}" placeholder="Optional" autocomplete="name">
      </div>
      <div class="admin-field-grid">
        <div class="admin-field">
          <label class="admin-label" for="${ids.phone}">Phone</label>
          <input class="admin-input" type="tel" id="${ids.phone}" placeholder="Optional" autocomplete="tel">
        </div>
        <div class="admin-field">
          <label class="admin-label" for="${ids.email}">Email</label>
          <input class="admin-input" type="email" id="${ids.email}" placeholder="Optional" autocomplete="email">
        </div>
      </div>
    </section>`;
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
          <div class="catalog-list" id="supList">
            <div class="catalog-list-empty">${loadingWidget('Loading suppliers…')}</div>
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

function renderListItems(suppliers, selectedId, query, sort = 'name') {
  const q = (query || '').trim().toLowerCase();
  const list = (suppliers || [])
    .filter((s) => !q || supplierSearchText(s).includes(q))
    .slice()
    .sort((a, b) => {
      const cmp = (a.name || '').localeCompare(b.name || '');
      return sort === 'name-desc' ? -cmp : cmp;
    });

  if (!list.length) {
    return emptyState({
      iconHtml: icon(suppliers?.length ? 'funnel' : 'truck', { size: 22 }),
      title: suppliers?.length ? 'No matching suppliers' : 'No suppliers yet',
      copy: suppliers?.length
        ? 'No suppliers match your search.'
        : 'Add your first supplier to get started.',
      variant: 'admin',
      className: 'empty--inline',
    });
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
              <th class="num">Case price</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ p, row }) => {
              const pack = (row?.pack_size) || p.case_size || '—';
              const price = row ? row.case_price : p.case_price;
              const pref = row ? row.is_preferred : (p.supplier_id === s.id);
              return `<tr>
                <td>
                  <span class="catalog-table-primary">${escapeHtml(p.name || 'Product')}</span>
                  ${pref ? '<span class="catalog-tag">pref</span>' : ''}
                </td>
                <td>${escapeHtml(pack)}</td>
                <td>${categoryBadge(p.category)}</td>
                <td class="num">${price != null ? escapeHtml(fmtGbp(price)) : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`
    : emptyState({
      iconHtml: icon('package', { size: 22 }),
      title: 'No linked products',
      copy: 'No products linked to this supplier yet.',
      variant: 'admin',
      className: 'empty--inline',
    });

  const manager = roleContact(s, 'account_manager');
  const orders = roleContact(s, 'orders');
  const accounts = roleContact(s, 'accounts');

  return `
    <div class="sup-detail">
      <div class="catalog-detail-head">
        <div class="catalog-detail-head-main">
          <h2 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(s.name || 'Supplier')}</span></h2>
          <div class="sup-chips">
            <span class="sup-chip">${rows.length} price line${rows.length !== 1 ? 's' : ''}</span>
            <span class="sup-chip">SOR ${sor}%</span>
          </div>
        </div>
        <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="supEditBtn"
          title="Edit supplier" aria-label="Edit supplier">
          ${icon('pencil', { size: 16, strokeWidth: 2.5 })}<span>Edit</span>
        </button>
      </div>
      <div class="sup-contacts">
        ${contactCard('Account manager', 'user', manager)}
        ${contactCard('Orders', 'shopping-cart', orders)}
        ${contactCard('Accounts', 'wallet', accounts)}
      </div>
      <div class="sup-address">
        <span class="catalog-ro-label">Address</span>
        <span class="sup-address-value">${roValue(s.address)}</span>
      </div>
      <div class="catalog-detail-section">
        <div class="sup-section-head">
          <h3 class="catalog-section-title">Products</h3>
          <span class="sup-section-meta">${rows.length} linked</span>
        </div>
        ${productTable}
      </div>
    </div>`;
}

export function renderSuppliersShell() {
  return renderShell();
}

export function mountSuppliersPanel() {
  const listEl = $('supList');
  const detailEmpty = $('supDetailEmpty');
  const detailBody = $('supDetailBody');
  if (!listEl) return () => {};

  let suppliers = [];
  let products = [];
  let selectedId = null;
  let searchQuery = '';
  let sortKey = 'name';

  const seeded = getTableFilterValues('suppliers');
  if (seeded) {
    searchQuery = seeded.query || '';
    sortKey = seeded.sort || 'name';
  }

  function paintList() {
    listEl.innerHTML = renderListItems(suppliers, selectedId, searchQuery, sortKey);
    listEl.querySelectorAll('[data-sup-id]').forEach((btn) => {
      btn.onclick = () => selectSupplier(btn.dataset.supId);
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
    $('supEditBtn')?.addEventListener('click', () => openSupplierForm(s.id));
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

    const managerName = textOrNull('supAmName');
    const managerPhone = textOrNull('supAmPhone');
    const managerEmail = textOrNull('supAmEmail');
    const patch = {
      name,
      account_manager_name: managerName,
      account_manager_phone: managerPhone,
      account_manager_email: managerEmail,
      orders_name: textOrNull('supOrdName'),
      orders_phone: textOrNull('supOrdPhone'),
      orders_email: textOrNull('supOrdEmail'),
      accounts_name: textOrNull('supAccName'),
      accounts_phone: textOrNull('supAccPhone'),
      accounts_email: textOrNull('supAccEmail'),
      // Keep the original contact columns aligned with the account manager.
      contact_name: managerName,
      phone: managerPhone,
      email: managerEmail,
      address: textOrNull('supAddress'),
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
          <div class="admin-field">
            <label class="admin-label" for="supSor">Default SOR %</label>
            <input class="admin-input num-math" type="text" inputmode="decimal" autocomplete="off" id="supSor" placeholder="0">
          </div>
          ${contactFormGroup('Account manager', { name: 'supAmName', phone: 'supAmPhone', email: 'supAmEmail' })}
          ${contactFormGroup('Orders', { name: 'supOrdName', phone: 'supOrdPhone', email: 'supOrdEmail' })}
          ${contactFormGroup('Accounts', { name: 'supAccName', phone: 'supAccPhone', email: 'supAccEmail' })}
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
      const manager = roleContact(s, 'account_manager');
      const orders = roleContact(s, 'orders');
      const accounts = roleContact(s, 'accounts');
      $('supName').value = s.name || '';
      $('supSor').value = s.default_sor_pct != null ? String(s.default_sor_pct) : '';
      $('supAmName').value = manager.name;
      $('supAmPhone').value = manager.phone;
      $('supAmEmail').value = manager.email;
      $('supOrdName').value = orders.name;
      $('supOrdPhone').value = orders.phone;
      $('supOrdEmail').value = orders.email;
      $('supAccName').value = accounts.name;
      $('supAccPhone').value = accounts.phone;
      $('supAccEmail').value = accounts.email;
      $('supAddress').value = s.address || '';
    }

    $('supCancel').onclick = closeSheet;
    $('supSave').onclick = () => saveSupplier(editId || null);
    if (s) $('supDelete').onclick = () => deleteSupplier(s.id);
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-supplier') {
      e.detail.handled = true;
      openSupplierForm();
    }
  };
  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'suppliers') return;
    const values = e.detail?.values;
    if (!values) return;
    searchQuery = values.query || '';
    sortKey = values.sort || 'name';
    paintList();
  };
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  refresh().catch((err) => {
    listEl.innerHTML = errorState({
      title: 'Couldn’t load suppliers',
      copy: err.message || 'Failed to load',
      variant: 'admin',
    });
    bindEmptyRetry(listEl, () => refresh());
    reportError(err, { source: 'admin.suppliers.load', silent: true });
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
