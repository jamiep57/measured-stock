/**
 * Accounts — clients and suppliers in one list, with contacts and
 * third-party rider pricing. Supplier accounts stay in step with the
 * Suppliers catalogue (database triggers, migration 071).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { getDB, loadCaseSizes, loadCategories, loadLibraryProducts } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { openModal, closeModal, confirmDialog } from '../../components/modal.js';
import { mountProductSearch } from '../../components/product-search.js';
import { navigate } from '../router.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { ADMIN_TABLE_FILTER, getTableFilterValues } from '../table-filter.js';
import { parsePlanningNumber } from '../../lib/planning-menu.js';
import { listPriceYears } from '../../lib/planning-data.js';
import {
  AGREEMENT_STATUSES,
  CONTACT_ROLES,
  accountKinds,
  contactsByRole,
  matchesKind,
  roleLabel,
  validateAccount,
  validateContact,
} from '../../lib/accounts.js';
import {
  accountErrorMessage,
  accountUsage,
  createAccount,
  createAgreement,
  createContact,
  deleteAgreement,
  deleteContact,
  isAccountsSchemaMissing,
  listAccounts,
  listAgreements,
  updateAccount,
  updateAgreement,
  updateContact,
  upsertRiderLine,
} from '../../lib/accounts-data.js';

const SAVE_DEBOUNCE_MS = 450;

function ro(val) {
  const has = val != null && String(val).trim() !== '';
  return has ? escapeHtml(val) : '<span class="catalog-ro-empty">—</span>';
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function money(n) {
  const v = Number(n);
  return n == null || !Number.isFinite(v) ? '' : v.toFixed(2);
}

function goTo(route) {
  navigate(route);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function renderAccountsShell() {
  return `
    <div class="admin-page acct-panel">
      <div class="catalog-layout">
        <aside class="catalog-list-card admin-surface">
          <div class="catalog-list" id="acctList">
            <div class="catalog-list-empty">${loadingWidget('Loading accounts…')}</div>
          </div>
        </aside>
        <section class="catalog-detail admin-surface" id="acctDetail">
          <div class="catalog-detail-empty" id="acctDetailEmpty">
            ${icon('building-2', { size: 32, strokeWidth: 1.5 })}
            <p>Select an account to see contacts, events and rider pricing — or add one from the toolbar.</p>
          </div>
          <div id="acctDetailBody" hidden></div>
        </section>
      </div>
    </div>`;
}

export function mountAccountsPanel() {
  const listEl = $('acctList');
  const detailEmpty = $('acctDetailEmpty');
  const detailBody = $('acctDetailBody');
  if (!listEl) return () => {};

  const ctx = {
    accounts: [],
    selectedId: sessionStorage.getItem('v5-admin-account') || null,
    filter: getTableFilterValues('accounts') || {},
    usage: null,
    agreements: [],
    events: [],
    years: [],
    products: [],
    productById: new Map(),
    categories: [],
    caseSizes: [],
    saveTimers: {},
    abort: false,
  };

  const selected = () => ctx.accounts.find((a) => a.id === ctx.selectedId) || null;

  // ---------- list ---------------------------------------------------

  function visibleAccounts() {
    const q = (ctx.filter.query || '').trim().toLowerCase();
    const kind = ctx.filter.kind || 'all';
    const showArchived = ctx.filter.archived === 'show';
    const list = ctx.accounts.filter((a) => {
      if (!showArchived && a.archived) return false;
      if (!matchesKind(a, kind)) return false;
      if (q && !a.name.toLowerCase().includes(q)
        && !(a.account_contacts || []).some((c) => `${c.name} ${c.email || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
    list.sort((a, b) => (ctx.filter.sort === 'name-desc' ? -1 : 1) * a.name.localeCompare(b.name));
    return list;
  }

  function paintList() {
    const list = visibleAccounts();
    if (!list.length) {
      listEl.innerHTML = emptyState({
        iconHtml: icon(ctx.accounts.length ? 'funnel' : 'building-2', { size: 22 }),
        title: ctx.accounts.length ? 'No matching accounts' : 'No accounts yet',
        copy: ctx.accounts.length ? 'Nothing matches the current filter.' : 'Add a client or supplier from the toolbar.',
        variant: 'admin',
        className: 'empty--inline',
      });
      return;
    }
    listEl.innerHTML = list.map((a) => `
      <button type="button" class="catalog-list-item${a.id === ctx.selectedId ? ' catalog-list-item--active' : ''}${a.archived ? ' acct-item--archived' : ''}" data-acct-id="${escapeHtml(a.id)}">
        <span class="catalog-list-name">${escapeHtml(a.name)}</span>
        <span class="catalog-list-meta">${escapeHtml(accountKinds(a).join(' · ') || '—')}${a.archived ? ' · archived' : ''}</span>
      </button>`).join('');
  }

  // ---------- detail -------------------------------------------------

  function contactsHtml(a) {
    const groups = contactsByRole(a.account_contacts);
    const rows = [];
    groups.forEach((list, role) => {
      list.forEach((c) => {
        rows.push(`<tr>
          <td><span class="catalog-table-primary">${escapeHtml(c.name)}</span>${c.is_primary ? '<span class="catalog-tag">primary</span>' : ''}
            ${c.job_title ? `<span class="acct-sub">${escapeHtml(c.job_title)}</span>` : ''}</td>
          <td>${escapeHtml(roleLabel(role))}</td>
          <td>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '—'}</td>
          <td>${c.phone ? `<a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a>` : '—'}</td>
          <td class="acct-row-actions"><button type="button" class="acct-icon-btn" data-contact-edit="${escapeHtml(c.id)}" aria-label="Edit contact">${icon('pencil', { size: 14 })}</button></td>
        </tr>`);
      });
    });
    return rows.length
      ? `<div class="catalog-table-wrap"><table class="catalog-table">
          <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th></th></tr></thead>
          <tbody>${rows.join('')}</tbody></table></div>`
      : '<p class="muted acct-none">No contacts yet — add the account manager, order and transfer contacts.</p>';
  }

  function usageHtml() {
    if (!ctx.usage) return `<p class="muted acct-none">${loadingWidget('Loading…')}</p>`;
    const { events, recipients } = ctx.usage;
    const ev = events.length
      ? `<ul class="acct-links">${events.map((e) => `<li><button type="button" class="acct-link" data-event="${escapeHtml(e.id)}">${escapeHtml(e.name)}</button>
          <span class="muted">${escapeHtml(fmtDate(e.start_date))}${e.status ? ` · ${escapeHtml(e.status)}` : ''}</span></li>`).join('')}</ul>`
      : '<p class="muted acct-none">Not the client on any event yet — set it from an event’s Menu &amp; GP page.</p>';
    const rc = recipients.length
      ? `<ul class="acct-links">${recipients.map((r) => `<li>${escapeHtml(r.event?.name || 'Event')}<span class="muted"> · ${escapeHtml(r.name)}${r.department ? ` (${escapeHtml(r.department)})` : ''}</span></li>`).join('')}</ul>`
      : '';
    return `<h4 class="acct-mini-title">Client on events</h4>${ev}${rc ? `<h4 class="acct-mini-title">Transfer recipient on</h4>${rc}` : ''}`;
  }

  function agreementHtml(ag) {
    const status = AGREEMENT_STATUSES.find((s) => s.value === ag.status)?.label || ag.status;
    const ev = ctx.events.find((e) => e.id === ag.event_id);
    const year = ctx.years.find((y) => y.id === ag.price_year_id);
    const scope = [ev ? ev.name : 'All events', year?.label, ag.valid_from || ag.valid_to
      ? `${fmtDate(ag.valid_from) || '…'} – ${fmtDate(ag.valid_to) || '…'}` : null].filter(Boolean).join(' · ');
    const lines = (ag.rider_price_lines || []).slice().sort((x, y) =>
      (ctx.productById.get(x.product_id)?.name || '').localeCompare(ctx.productById.get(y.product_id)?.name || ''));
    return `<div class="acct-agreement" data-agreement="${escapeHtml(ag.id)}">
      <div class="acct-agreement-head">
        <div>
          <span class="acct-agreement-name">${escapeHtml(ag.name)}</span>
          ${ag.reference ? `<span class="muted"> · ${escapeHtml(ag.reference)}</span>` : ''}
          <span class="lta-badge ${ag.status === 'active' ? 'lta-ok' : 'lta-neutral'}">${escapeHtml(status)}</span>
          <span class="acct-sub">${escapeHtml(scope)} · prices ${ag.prices_include_vat ? 'inc' : 'ex'} VAT</span>
        </div>
        <button type="button" class="acct-icon-btn" data-agreement-edit="${escapeHtml(ag.id)}" aria-label="Edit agreement">${icon('pencil', { size: 14 })}</button>
      </div>
      <table class="ord-lines acct-rider-lines">
        <thead><tr><th>Product</th><th class="num">Rider price £</th><th></th></tr></thead>
        <tbody>${lines.length ? lines.map((l) => `<tr data-pid="${escapeHtml(l.product_id)}">
            <td>${escapeHtml(ctx.productById.get(l.product_id)?.name || 'Unknown product')}</td>
            <td class="num"><input type="text" inputmode="decimal" class="num-math plan-cell-input" data-rider-price value="${escapeHtml(money(l.price))}" aria-label="Rider price"></td>
            <td><button type="button" class="ord-line-remove" data-rider-remove aria-label="Remove">${icon('x', { size: 14 })}</button></td>
          </tr>`).join('') : '<tr><td colspan="3" class="muted ord-lines-empty">No prices yet.</td></tr>'}</tbody>
      </table>
      <div class="ord-add-line" data-rider-add="${escapeHtml(ag.id)}"></div>
    </div>`;
  }

  function paintDetail() {
    const a = selected();
    if (!a) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailBody.innerHTML = `
      <div class="catalog-detail-head">
        <div class="catalog-detail-head-main">
          <h2 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(a.name)}</span></h2>
          <p class="catalog-detail-meta">${escapeHtml(accountKinds(a).join(' · '))}${a.archived ? ' · archived' : ''}${a.legal_name ? ` · ${escapeHtml(a.legal_name)}` : ''}</p>
        </div>
        <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="acctEditBtn" title="Edit account">
          ${icon('pencil', { size: 16, strokeWidth: 2.5 })}<span>Edit</span>
        </button>
      </div>
      <div class="catalog-ro-grid">
        <div class="catalog-ro-field"><span class="catalog-ro-label">Email</span><span class="catalog-ro-value">${ro(a.email)}</span></div>
        <div class="catalog-ro-field"><span class="catalog-ro-label">Phone</span><span class="catalog-ro-value">${ro(a.phone)}</span></div>
        <div class="catalog-ro-field"><span class="catalog-ro-label">Website</span><span class="catalog-ro-value">${ro(a.website)}</span></div>
        <div class="catalog-ro-field"><span class="catalog-ro-label">VAT number</span><span class="catalog-ro-value">${ro(a.vat_number)}</span></div>
        <div class="catalog-ro-field catalog-ro-field--full"><span class="catalog-ro-label">Address</span><span class="catalog-ro-value">${ro(a.address)}</span></div>
        ${a.notes ? `<div class="catalog-ro-field catalog-ro-field--full"><span class="catalog-ro-label">Notes</span><span class="catalog-ro-value">${ro(a.notes)}</span></div>` : ''}
      </div>
      <div class="catalog-detail-section">
        <div class="acct-section-head">
          <h3 class="catalog-section-title">Contacts</h3>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid acct-small-btn" id="acctAddContact">${icon('plus', { size: 14 })} Contact</button>
        </div>
        ${contactsHtml(a)}
      </div>
      ${a.is_supplier && a.supplier_id ? `<div class="catalog-detail-section">
        <h3 class="catalog-section-title">Supplier</h3>
        <p class="acct-none">Product offers, SOR % and purchase orders use this account’s supplier record.
          <button type="button" class="acct-link" data-goto="suppliers">Open in Suppliers</button></p>
      </div>` : ''}
      <div class="catalog-detail-section" id="acctUsage">${usageHtml()}</div>
      <div class="catalog-detail-section">
        <div class="acct-section-head">
          <h3 class="catalog-section-title">Rider pricing</h3>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid acct-small-btn" id="acctAddAgreement">${icon('plus', { size: 14 })} Agreement</button>
        </div>
        <p class="muted acct-none">Prices agreed with this third party — used on client exports and recharges instead of menu prices.</p>
        <div id="acctAgreements">${ctx.agreements.length ? ctx.agreements.map(agreementHtml).join('') : ''}</div>
      </div>`;
    mountRiderSearches();
  }

  function mountRiderSearches() {
    detailBody.querySelectorAll('[data-rider-add]').forEach((el) => {
      const ag = ctx.agreements.find((x) => x.id === el.dataset.riderAdd);
      if (!ag) return;
      const used = new Set((ag.rider_price_lines || []).map((l) => l.product_id));
      mountProductSearch(el, {
        products: ctx.products.filter((p) => !used.has(p.id)),
        categories: ctx.categories,
        caseSizes: ctx.caseSizes,
        placeholder: 'Add product…',
        onSelect: ({ productId }) => promptRiderPrice(ag, productId),
      });
    });
  }

  function promptRiderPrice(ag, productId) {
    const p = ctx.productById.get(productId);
    const el = openModal({
      title: `Rider price — ${p?.name || 'product'}`,
      bodyHtml: `<div class="admin-drawer-form">
        <label class="admin-field"><span class="admin-label">Price £ (${ag.prices_include_vat ? 'inc' : 'ex'} VAT)</span>
          <input class="admin-input num-math" id="riderPriceNew" inputmode="decimal"></label>
        <p class="plan-form-err" id="riderPriceErr" hidden></p></div>`,
      footHtml: `<div class="admin-modal-confirm-foot">
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Add</button></div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const parsed = parsePlanningNumber(el.querySelector('#riderPriceNew').value, { max: 100000 });
      const err = el.querySelector('#riderPriceErr');
      if (!parsed.ok || parsed.value == null) { err.textContent = 'Enter a price'; err.hidden = false; return; }
      try {
        const line = await upsertRiderLine(ag.id, productId, parsed.value);
        ag.rider_price_lines = [...(ag.rider_price_lines || []).filter((l) => l.product_id !== productId), line || { product_id: productId, price: parsed.value }];
        closeModal();
        paintDetail();
      } catch (e) {
        err.textContent = accountErrorMessage(e);
        err.hidden = false;
      }
    };
    requestAnimationFrame(() => el.querySelector('#riderPriceNew')?.focus());
  }

  // ---------- forms --------------------------------------------------

  function openAccountForm(editId) {
    const a = editId ? ctx.accounts.find((x) => x.id === editId) : null;
    const f = (k) => escapeHtml(a?.[k] ?? '');
    openSheet({
      title: a ? 'Edit account' : 'New account',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="acctErr"></div>
          <div class="admin-field"><label class="admin-label" for="acctName">Name</label>
            <input class="admin-input" id="acctName" maxlength="120" value="${f('name')}" placeholder="Trading name"></div>
          <div class="acct-kind-row">
            <label class="plan-check"><input type="checkbox" id="acctClient" ${a ? (a.is_client ? 'checked' : '') : 'checked'}> Client</label>
            <label class="plan-check"><input type="checkbox" id="acctSupplier" ${a?.is_supplier ? 'checked' : ''}> Supplier</label>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field"><label class="admin-label" for="acctLegal">Legal name</label>
              <input class="admin-input" id="acctLegal" value="${f('legal_name')}" placeholder="Optional"></div>
            <div class="admin-field"><label class="admin-label" for="acctVat">VAT number</label>
              <input class="admin-input" id="acctVat" value="${f('vat_number')}" placeholder="Optional"></div>
          </div>
          <div class="admin-field-grid">
            <div class="admin-field"><label class="admin-label" for="acctEmail">Email</label>
              <input class="admin-input" type="email" id="acctEmail" value="${f('email')}" placeholder="Optional"></div>
            <div class="admin-field"><label class="admin-label" for="acctPhone">Phone</label>
              <input class="admin-input" type="tel" id="acctPhone" value="${f('phone')}" placeholder="Optional"></div>
          </div>
          <div class="admin-field"><label class="admin-label" for="acctWebsite">Website</label>
            <input class="admin-input" id="acctWebsite" value="${f('website')}" placeholder="Optional"></div>
          <div class="admin-field"><label class="admin-label" for="acctAddress">Address</label>
            <textarea class="admin-textarea" id="acctAddress" rows="3" placeholder="Optional">${f('address')}</textarea></div>
          <div class="admin-field"><label class="admin-label" for="acctNotes">Notes</label>
            <textarea class="admin-textarea" id="acctNotes" rows="2" placeholder="Optional">${f('notes')}</textarea></div>
          ${a?.is_supplier ? '<p class="wst-form-hint muted">Name, email, phone and address also update the linked supplier.</p>' : ''}
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${a ? `<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="acctArchive">${a.archived ? 'Restore' : 'Archive'}</button>` : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="acctCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="acctSave">${a ? 'Update account' : 'Save account'}</button>
          </div>
        </div>`,
    });
    $('acctCancel').onclick = closeSheet;
    $('acctSave').onclick = async () => {
      const r = validateAccount({
        name: $('acctName').value,
        is_client: $('acctClient').checked,
        is_supplier: $('acctSupplier').checked,
        legal_name: $('acctLegal').value,
        vat_number: $('acctVat').value,
        email: $('acctEmail').value,
        phone: $('acctPhone').value,
        website: $('acctWebsite').value,
        address: $('acctAddress').value,
        notes: $('acctNotes').value,
      }, ctx.accounts, a?.id || null);
      if (!r.ok) { $('acctErr').textContent = Object.values(r.errors)[0]; return; }
      if (a?.is_supplier && !r.value.is_supplier) {
        $('acctErr').textContent = 'Supplier accounts stay suppliers — products and orders depend on them. Archive it instead.';
        return;
      }
      const btn = $('acctSave');
      btn.disabled = true;
      try {
        const saved = a ? await updateAccount(a.id, r.value) : await createAccount(r.value);
        if (saved?.id) ctx.selectedId = saved.id;
        closeSheet();
        await refresh();
        toast(a ? 'Account updated' : 'Account created');
      } catch (e) {
        btn.disabled = false;
        $('acctErr').textContent = accountErrorMessage(e);
      }
    };
    if (a) {
      $('acctArchive').onclick = async () => {
        try {
          await updateAccount(a.id, { archived: !a.archived });
          closeSheet();
          await refresh();
          toast(a.archived ? 'Account restored' : 'Account archived — kept on past events and orders');
        } catch (e) {
          toast(accountErrorMessage(e), true);
        }
      };
    }
    requestAnimationFrame(() => $('acctName')?.focus());
  }

  function openContactForm(contactId) {
    const a = selected();
    if (!a) return;
    const c = contactId ? (a.account_contacts || []).find((x) => x.id === contactId) : null;
    const f = (k) => escapeHtml(c?.[k] ?? '');
    const el = openModal({
      title: c ? 'Edit contact' : 'New contact',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="admin-field-grid">
            <label class="admin-field"><span class="admin-label">Name</span><input class="admin-input" id="ctName" maxlength="120" value="${f('name')}"></label>
            <label class="admin-field"><span class="admin-label">Role</span>
              <select class="admin-select" id="ctRole">${CONTACT_ROLES.map((r) => `<option value="${r.value}" ${(c?.role || 'order') === r.value ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}</select></label>
          </div>
          <label class="admin-field"><span class="admin-label">Job title</span><input class="admin-input" id="ctTitle" value="${f('job_title')}" placeholder="Optional"></label>
          <div class="admin-field-grid">
            <label class="admin-field"><span class="admin-label">Email</span><input class="admin-input" type="email" id="ctEmail" value="${f('email')}"></label>
            <label class="admin-field"><span class="admin-label">Phone</span><input class="admin-input" type="tel" id="ctPhone" value="${f('phone')}"></label>
          </div>
          <label class="plan-check"><input type="checkbox" id="ctPrimary" ${c?.is_primary ? 'checked' : ''}> Primary contact for this role</label>
          <p class="plan-form-err" id="ctErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          ${c ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" data-delete>Delete</button>' : ''}
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Save</button>
        </div>`,
    });
    const err = el.querySelector('#ctErr');
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const r = validateContact({
        name: el.querySelector('#ctName').value,
        role: el.querySelector('#ctRole').value,
        job_title: el.querySelector('#ctTitle').value,
        email: el.querySelector('#ctEmail').value,
        phone: el.querySelector('#ctPhone').value,
        is_primary: el.querySelector('#ctPrimary').checked,
      }, a.account_contacts, c?.id || null);
      if (!r.ok) { err.textContent = Object.values(r.errors)[0]; err.hidden = false; return; }
      try {
        if (c) await updateContact(c.id, a.id, r.value);
        else await createContact(a.id, r.value);
        closeModal();
        await refresh();
      } catch (e) {
        err.textContent = accountErrorMessage(e);
        err.hidden = false;
      }
    };
    if (c) {
      el.querySelector('[data-delete]').onclick = async () => {
        closeModal();
        if (!(await confirmDialog({ title: 'Delete contact', message: `Remove ${c.name} from ${a.name}?`, confirmLabel: 'Delete' }))) return;
        try {
          await deleteContact(c.id);
          await refresh();
        } catch (e) {
          toast(accountErrorMessage(e), true);
        }
      };
    }
    requestAnimationFrame(() => el.querySelector('#ctName')?.focus());
  }

  function openAgreementForm(agreementId) {
    const a = selected();
    if (!a) return;
    const ag = agreementId ? ctx.agreements.find((x) => x.id === agreementId) : null;
    const f = (k) => escapeHtml(ag?.[k] ?? '');
    const el = openModal({
      title: ag ? 'Edit rider agreement' : 'New rider agreement',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="admin-field-grid">
            <label class="admin-field"><span class="admin-label">Name</span><input class="admin-input" id="agName" maxlength="120" value="${f('name')}" placeholder="e.g. 2027 artist rider"></label>
            <label class="admin-field"><span class="admin-label">Reference</span><input class="admin-input" id="agRef" maxlength="80" value="${f('reference')}" placeholder="Optional"></label>
          </div>
          <div class="admin-field-grid">
            <label class="admin-field"><span class="admin-label">Event</span>
              <select class="admin-select" id="agEvent"><option value="">All events</option>
                ${ctx.events.map((e) => `<option value="${escapeHtml(e.id)}" ${ag?.event_id === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}</select></label>
            <label class="admin-field"><span class="admin-label">Price year</span>
              <select class="admin-select" id="agYear"><option value="">—</option>
                ${ctx.years.map((y) => `<option value="${escapeHtml(y.id)}" ${ag?.price_year_id === y.id ? 'selected' : ''}>${escapeHtml(y.label)}</option>`).join('')}</select></label>
          </div>
          <div class="admin-field-grid">
            <label class="admin-field"><span class="admin-label">Valid from</span><input type="date" class="admin-input" id="agFrom" value="${f('valid_from')}"></label>
            <label class="admin-field"><span class="admin-label">Valid to</span><input type="date" class="admin-input" id="agTo" value="${f('valid_to')}"></label>
          </div>
          <div class="admin-field-grid">
            <label class="admin-field"><span class="admin-label">Status</span>
              <select class="admin-select" id="agStatus">${AGREEMENT_STATUSES.map((s) => `<option value="${s.value}" ${(ag?.status || 'draft') === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
            <label class="plan-check acct-check-inline"><input type="checkbox" id="agVat" ${ag ? (ag.prices_include_vat ? 'checked' : '') : 'checked'}> Prices include VAT</label>
          </div>
          <label class="admin-field"><span class="admin-label">Notes</span><textarea class="admin-textarea" id="agNotes" rows="2">${f('notes')}</textarea></label>
          <p class="plan-form-err" id="agErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          ${ag ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" data-delete>Delete</button>' : ''}
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Save</button>
        </div>`,
    });
    const err = el.querySelector('#agErr');
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const name = el.querySelector('#agName').value.trim();
      const from = el.querySelector('#agFrom').value || null;
      const to = el.querySelector('#agTo').value || null;
      if (!name) { fail('Name is required'); return; }
      if (from && to && to < from) { fail('Valid to is before valid from'); return; }
      const patch = {
        name,
        reference: el.querySelector('#agRef').value.trim() || null,
        event_id: el.querySelector('#agEvent').value || null,
        price_year_id: el.querySelector('#agYear').value || null,
        valid_from: from,
        valid_to: to,
        status: el.querySelector('#agStatus').value,
        prices_include_vat: el.querySelector('#agVat').checked,
        notes: el.querySelector('#agNotes').value.trim() || null,
      };
      try {
        if (ag) await updateAgreement(ag.id, patch);
        else await createAgreement({ ...patch, account_id: a.id });
        closeModal();
        await loadAccountExtras();
      } catch (e) {
        fail(accountErrorMessage(e));
      }
    };
    if (ag) {
      el.querySelector('[data-delete]').onclick = async () => {
        closeModal();
        if (!(await confirmDialog({ title: 'Delete agreement', message: `Delete “${ag.name}” and its ${ag.rider_price_lines?.length || 0} prices? Set it to Ended instead to keep the history.`, confirmLabel: 'Delete' }))) return;
        try {
          await deleteAgreement(ag.id);
          await loadAccountExtras();
        } catch (e) {
          toast(accountErrorMessage(e), true);
        }
      };
    }
  }

  // ---------- events -------------------------------------------------

  function onDetailClick(e) {
    if (e.target.closest('#acctEditBtn')) { openAccountForm(ctx.selectedId); return; }
    if (e.target.closest('#acctAddContact')) { openContactForm(null); return; }
    if (e.target.closest('#acctAddAgreement')) { openAgreementForm(null); return; }
    const ce = e.target.closest('[data-contact-edit]');
    if (ce) { openContactForm(ce.dataset.contactEdit); return; }
    const ae = e.target.closest('[data-agreement-edit]');
    if (ae) { openAgreementForm(ae.dataset.agreementEdit); return; }
    const ev = e.target.closest('[data-event]');
    if (ev) { goTo({ view: 'event', eventId: ev.dataset.event, panel: 'planning' }); return; }
    const g = e.target.closest('[data-goto]');
    if (g) { goTo({ view: g.dataset.goto }); return; }
    const rm = e.target.closest('[data-rider-remove]');
    if (rm) {
      const agEl = rm.closest('[data-agreement]');
      const pid = rm.closest('tr').dataset.pid;
      const ag = ctx.agreements.find((x) => x.id === agEl.dataset.agreement);
      upsertRiderLine(ag.id, pid, null)
        .then(() => {
          ag.rider_price_lines = (ag.rider_price_lines || []).filter((l) => l.product_id !== pid);
          paintDetail();
        })
        .catch((err) => toast(accountErrorMessage(err), true));
    }
  }

  function onDetailInput(e) {
    if (!e.target.hasAttribute('data-rider-price')) return;
    const agEl = e.target.closest('[data-agreement]');
    const pid = e.target.closest('tr').dataset.pid;
    const ag = ctx.agreements.find((x) => x.id === agEl.dataset.agreement);
    const parsed = parsePlanningNumber(e.target.value, { max: 100000 });
    const ok = parsed.ok && parsed.value != null;
    e.target.classList.toggle('is-invalid', !ok);
    if (!ok || !ag) return;
    const line = (ag.rider_price_lines || []).find((l) => l.product_id === pid);
    if (line) line.price = parsed.value;
    const key = `${ag.id}:${pid}`;
    clearTimeout(ctx.saveTimers[key]?.timer);
    const fn = () => upsertRiderLine(ag.id, pid, parsed.value).catch((err) => toast(accountErrorMessage(err), true));
    const timer = setTimeout(() => { delete ctx.saveTimers[key]; void fn(); }, SAVE_DEBOUNCE_MS);
    ctx.saveTimers[key] = { timer, fn };
  }

  function onListClick(e) {
    const btn = e.target.closest('[data-acct-id]');
    if (!btn) return;
    ctx.selectedId = btn.dataset.acctId;
    sessionStorage.setItem('v5-admin-account', ctx.selectedId);
    paintList();
    void loadAccountExtras();
  }

  function onToolbarAction(e) {
    if (e.detail?.action !== 'new-account') return;
    e.detail.handled = true;
    openAccountForm(null);
  }

  function onTableFilter(e) {
    if (e.detail?.panel !== 'accounts') return;
    ctx.filter = e.detail.values || {};
    paintList();
  }

  // ---------- load ---------------------------------------------------

  async function loadAccountExtras() {
    const id = ctx.selectedId;
    ctx.usage = null;
    ctx.agreements = [];
    paintDetail();
    if (!id) return;
    try {
      const [usage, agreements] = await Promise.all([accountUsage(id), listAgreements(id)]);
      if (ctx.abort || id !== ctx.selectedId) return;
      ctx.usage = usage;
      ctx.agreements = agreements || [];
      paintDetail();
    } catch (err) {
      reportError(err, { source: 'admin.accounts.extras', silent: true });
      toast(err.message || 'Could not load account details', true);
    }
  }

  async function refresh() {
    ctx.accounts = await listAccounts({ force: true });
    if (ctx.abort) return;
    if (ctx.selectedId && !ctx.accounts.some((a) => a.id === ctx.selectedId)) ctx.selectedId = null;
    paintList();
    await loadAccountExtras();
  }

  async function load() {
    const [accounts, events, years, products, categories, caseSizes] = await Promise.all([
      listAccounts({ force: true }),
      getDB().select('events', '?select=id,name,start_date&order=start_date.desc.nullslast&limit=300'),
      listPriceYears().catch(() => []),
      loadLibraryProducts(),
      loadCategories(),
      loadCaseSizes(),
    ]);
    if (ctx.abort) return;
    ctx.accounts = accounts || [];
    ctx.events = events || [];
    ctx.years = years || [];
    ctx.products = (products || []).filter((p) => !p.archived);
    ctx.productById = new Map((products || []).map((p) => [p.id, p]));
    ctx.categories = categories || [];
    ctx.caseSizes = caseSizes || [];
    if (ctx.selectedId && !ctx.accounts.some((a) => a.id === ctx.selectedId)) ctx.selectedId = null;
    paintList();
    await loadAccountExtras();
  }

  function onLoadError(err) {
    reportError(err, { source: 'admin.accounts.load', silent: true });
    const missing = isAccountsSchemaMissing(err);
    listEl.innerHTML = errorState({
      title: missing ? 'Accounts aren’t set up yet' : 'Couldn’t load accounts',
      copy: missing ? 'Apply migration 071_accounts.sql, then retry.' : (err.message || 'Failed to load'),
      variant: 'admin',
    });
    bindEmptyRetry(listEl, () => load().catch(onLoadError));
  }

  listEl.addEventListener('click', onListClick);
  detailBody.addEventListener('click', onDetailClick);
  detailBody.addEventListener('input', onDetailInput);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  load().catch(onLoadError);

  return () => {
    ctx.abort = true;
    Object.values(ctx.saveTimers).forEach(({ timer, fn }) => { clearTimeout(timer); void fn(); });
    ctx.saveTimers = {};
    listEl.removeEventListener('click', onListClick);
    detailBody.removeEventListener('click', onDetailClick);
    detailBody.removeEventListener('input', onDetailInput);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}
