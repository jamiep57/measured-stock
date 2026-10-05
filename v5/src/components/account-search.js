/**
 * Searchable account picker (clients / suppliers) with duplicate-safe create.
 *
 *   mountAccountSearch(container, {
 *     accounts, value, kind: 'client' | 'supplier' | 'all',
 *     allowEmpty, allowCreate, onCreate: async ({ name, is_client, is_supplier }) => account,
 *     onSelect({ accountId, account }),
 *   })
 */

import { escapeHtml, toast } from '../lib/util.js';
import { accountKinds, findDuplicateAccount, matchesKind, primaryContact } from '../lib/accounts.js';
import { openModal, closeModal } from './modal.js';

function sortAccounts(list) {
  return [...(list || [])].filter((a) => a?.name).sort((a, b) => a.name.localeCompare(b.name));
}

export function mountAccountSearch(container, options = {}) {
  const {
    accounts = [],
    value = '',
    kind = 'all',
    placeholder = 'Search accounts…',
    emptyLabel = '— None —',
    allowEmpty = true,
    allowCreate = false,
    inputId = 'acctSearchInput',
    disabled = false,
    onCreate,
    onSelect,
  } = options;

  let items = sortAccounts(accounts);
  let selectedId = value || '';

  const root = document.createElement('div');
  root.className = 'supplier-search account-search';
  root.innerHTML = `
    <input type="search" id="${escapeHtml(inputId)}" class="supplier-search-input admin-input"
      placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-autocomplete="list" role="combobox" ${disabled ? 'disabled' : ''}>
    <div class="product-search-list supplier-search-list" hidden role="listbox"></div>`;
  const input = root.querySelector('input');
  const list = root.querySelector('.supplier-search-list');

  const nameFor = (id) => items.find((a) => a.id === id)?.name || '';
  const syncInput = () => { input.value = selectedId ? nameFor(selectedId) : ''; };
  const hideList = () => { list.hidden = true; };

  function setSelection(id) {
    selectedId = id || '';
    syncInput();
    onSelect?.({ accountId: selectedId || null, account: items.find((a) => a.id === selectedId) || null });
  }

  function meta(a) {
    const kinds = accountKinds(a).join(' · ');
    const c = primaryContact(a.account_contacts, kind === 'supplier' ? 'order' : 'account_manager')
      || (a.account_contacts || [])[0];
    return [kinds, c?.name].filter(Boolean).join(' — ');
  }

  function renderList(q = '') {
    const query = q.trim().toLowerCase();
    const pool = items.filter((a) => !a.archived && matchesKind(a, kind));
    const filtered = pool.filter((a) => !query || a.name.toLowerCase().includes(query)
      || (a.account_contacts || []).some((c) => c.name.toLowerCase().includes(query))).slice(0, 40);
    const html = [];
    if (allowEmpty && !query) {
      html.push(`<button type="button" class="product-search-item${!selectedId ? ' selected' : ''}" data-id="">
        <span class="product-search-name">${escapeHtml(emptyLabel)}</span></button>`);
    }
    filtered.forEach((a) => {
      html.push(`<button type="button" class="product-search-item${a.id === selectedId ? ' selected' : ''}" data-id="${escapeHtml(a.id)}">
        <span class="product-search-name">${escapeHtml(a.name)}</span>
        <span class="product-search-meta">${escapeHtml(meta(a))}</span></button>`);
    });
    if (allowCreate && onCreate && query) {
      const dup = findDuplicateAccount(q, items);
      if (dup && !matchesKind(dup, kind)) {
        html.push(`<button type="button" class="product-search-item" data-id="${escapeHtml(dup.id)}" data-promote="1">
          <span class="product-search-name">Use “${escapeHtml(dup.name)}”</span>
          <span class="product-search-meta">Existing ${escapeHtml(accountKinds(dup).join(' / ').toLowerCase())} account — also mark as ${kind}</span></button>`);
      } else if (!dup) {
        html.push(`<button type="button" class="product-search-item product-search-create-trigger">
          <span class="product-search-name">+ Add “${escapeHtml(q.trim())}”</span>
          <span class="product-search-meta">Create a new ${kind === 'all' ? '' : `${kind} `}account</span></button>`);
      }
    }
    list.innerHTML = html.length ? html.join('') : '<div class="product-search-empty">No matching accounts</div>';
    list.hidden = false;
  }

  function openCreate(name) {
    hideList();
    const modal = openModal({
      title: 'New account',
      bodyHtml: `
        <div class="admin-drawer-form">
          <label class="admin-field"><span class="admin-label">Name</span>
            <input class="admin-input" id="acctCreateName" maxlength="120" value="${escapeHtml(name)}"></label>
          <div class="acct-kind-row">
            <label class="plan-check"><input type="checkbox" id="acctCreateClient" ${kind !== 'supplier' ? 'checked' : ''}> Client</label>
            <label class="plan-check"><input type="checkbox" id="acctCreateSupplier" ${kind === 'supplier' ? 'checked' : ''}> Supplier</label>
          </div>
          <p class="plan-form-err" id="acctCreateErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Create &amp; select</button>
        </div>`,
    });
    const err = modal.querySelector('#acctCreateErr');
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    modal.querySelector('[data-cancel]').onclick = closeModal;
    modal.querySelector('[data-ok]').onclick = async () => {
      const nameVal = modal.querySelector('#acctCreateName').value.trim();
      const isClient = modal.querySelector('#acctCreateClient').checked;
      const isSupplier = modal.querySelector('#acctCreateSupplier').checked;
      if (!nameVal) { fail('Name is required'); return; }
      if (!isClient && !isSupplier) { fail('Choose client, supplier or both'); return; }
      const dup = findDuplicateAccount(nameVal, items);
      if (dup) { fail(`“${dup.name}” already exists — pick it from the list`); return; }
      const btn = modal.querySelector('[data-ok]');
      btn.disabled = true;
      try {
        const account = await onCreate({ name: nameVal, is_client: isClient, is_supplier: isSupplier });
        if (account?.id) items = sortAccounts([...items.filter((a) => a.id !== account.id), account]);
        closeModal();
        setSelection(account?.id || '');
      } catch (e) {
        btn.disabled = false;
        fail(e.message || 'Could not create account');
      }
    };
    requestAnimationFrame(() => modal.querySelector('#acctCreateName')?.focus());
  }

  input.addEventListener('focus', () => renderList(input.value === nameFor(selectedId) ? '' : input.value));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideList(); syncInput(); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!list.hidden && list.matches(':hover')) return;
      hideList();
      if (!input.value.trim() && allowEmpty && selectedId) setSelection('');
      else syncInput();
    }, 150);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', async (e) => {
    if (e.target.closest('.product-search-create-trigger')) {
      openCreate(input.value.trim());
      return;
    }
    const btn = e.target.closest('.product-search-item');
    if (!btn) return;
    if (btn.dataset.promote && options.onPromote) {
      try {
        const updated = await options.onPromote(btn.dataset.id, kind);
        if (updated?.id) items = sortAccounts([...items.filter((a) => a.id !== updated.id), { ...items.find((a) => a.id === updated.id), ...updated }]);
      } catch (err) {
        hideList();
        toast(err.message || 'Could not update account', true);
        return;
      }
    }
    setSelection(btn.dataset.id || '');
    hideList();
  });

  root.setValue = (id) => { selectedId = id || ''; syncInput(); };
  root.updateAccounts = (next) => { items = sortAccounts(next); syncInput(); };

  syncInput();
  container.innerHTML = '';
  container.appendChild(root);
  return root;
}
