/**
 * Searchable supplier picker — type-to-filter combobox with optional empty choice
 * and optional create-via-modal when no match exists.
 *
 *   mountSupplierSearch(container, {
 *     suppliers,
 *     value: supplierId,
 *     allowEmpty: true,
 *     allowCreate: false,
 *     onCreateSupplier, // async ({ name, contact_name, default_sor_pct }) => { supplierId, supplier }
 *     onSelect({ supplierId, supplier }),
 *   })
 */

import { escapeHtml } from '../lib/util.js';
import { openModal, closeModal } from './modal.js';

function sortSuppliers(list) {
  return [...(list || [])]
    .filter((s) => s?.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @returns {HTMLElement} root element (also exposes updateSuppliers)
 */
export function mountSupplierSearch(container, options = {}) {
  const {
    suppliers = [],
    value = '',
    placeholder = 'Search suppliers…',
    emptyLabel = '— Optional —',
    allowEmpty = true,
    allowCreate = false,
    dropdownFixed = false,
    hiddenId = 'dfSupplier',
    inputId = 'dfSupplierInput',
    inputClass = 'supplier-search-input admin-input',
    onCreateSupplier,
    onSelect,
  } = options;

  let items = sortSuppliers(suppliers);
  let selectedId = value || '';

  const root = document.createElement('div');
  root.className = 'supplier-search';
  root.innerHTML = `
    <input type="hidden" class="lib-offer-sup" id="${escapeHtml(hiddenId)}" value="${escapeHtml(selectedId)}">
    <input type="search" id="${escapeHtml(inputId)}" class="${escapeHtml(inputClass)}"
      placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-autocomplete="list" role="combobox">
    <div class="product-search-list supplier-search-list" hidden role="listbox"></div>
  `;

  const hidden = root.querySelector(`#${CSS.escape(hiddenId)}`);
  const input = root.querySelector(`#${CSS.escape(inputId)}`);
  const list = root.querySelector('.supplier-search-list');

  function syncListPosition() {
    if (!dropdownFixed || list.hidden) return;
    const rect = input.getBoundingClientRect();
    // Portal to body: admin drawers use transform, which breaks position:fixed
    // relative to the viewport when the list stays inside the sheet.
    if (list.parentElement !== document.body) {
      document.body.appendChild(list);
    }
    list.style.position = 'fixed';
    list.style.left = `${rect.left}px`;
    list.style.width = `${Math.max(rect.width, 200)}px`;
    list.style.top = `${rect.bottom + 4}px`;
    list.style.right = 'auto';
    list.style.zIndex = '260';
  }

  function resetListPosition() {
    list.style.position = '';
    list.style.left = '';
    list.style.width = '';
    list.style.top = '';
    list.style.right = '';
    list.style.zIndex = '';
    if (list.parentElement !== root) {
      root.appendChild(list);
    }
  }

  function hideList() {
    list.hidden = true;
    resetListPosition();
  }

  if (dropdownFixed) {
    window.addEventListener('resize', syncListPosition, { passive: true });
    container.closest('.sheet-body')?.addEventListener('scroll', () => {
      if (!list.hidden) syncListPosition();
    }, { passive: true });
  }

  function nameFor(id) {
    if (!id) return '';
    return items.find((s) => s.id === id)?.name || '';
  }

  function syncInput() {
    input.value = selectedId ? nameFor(selectedId) : '';
  }

  function setSelection(id) {
    selectedId = id || '';
    hidden.value = selectedId;
    syncInput();
    onSelect?.({
      supplierId: selectedId || null,
      supplier: items.find((s) => s.id === selectedId) || null,
    });
  }

  function openCreateModal(initialName) {
    const name = (initialName || '').trim();
    hideList();

    const modal = openModal({
      title: 'New supplier',
      bodyHtml: `
        <div class="admin-drawer-form product-create-form">
          <div class="admin-field">
            <label class="admin-label" for="ssCreateName">Name</label>
            <input type="text" class="admin-input" id="ssCreateName" value="${escapeHtml(name)}" required placeholder="Supplier name">
          </div>
          <div class="admin-field-grid">
            <div class="admin-field">
              <label class="admin-label" for="ssCreateContact">Contact name</label>
              <input type="text" class="admin-input" id="ssCreateContact" placeholder="Optional">
            </div>
            <div class="admin-field">
              <label class="admin-label" for="ssCreateSor">Default SOR %</label>
              <input type="number" class="admin-input" id="ssCreateSor" min="0" max="100" step="1" placeholder="0">
            </div>
          </div>
          <p class="wst-form-hint muted">You can add contact details later in Suppliers.</p>
          <div class="del-form-err" id="ssCreateErr"></div>
        </div>`,
      footHtml: `
        <div class="admin-modal-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="ssCreateCancel">Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="ssCreateSubmit">Create &amp; select</button>
        </div>`,
    });

    const nameEl = modal.querySelector('#ssCreateName');
    const errEl = modal.querySelector('#ssCreateErr');
    const submitBtn = modal.querySelector('#ssCreateSubmit');

    modal.querySelector('#ssCreateCancel')?.addEventListener('click', closeModal);

    submitBtn?.addEventListener('click', async () => {
      const nameVal = nameEl?.value.trim();
      if (!nameVal) {
        if (errEl) errEl.textContent = 'Supplier name is required.';
        nameEl?.focus();
        return;
      }
      if (!onCreateSupplier) return;

      if (errEl) errEl.textContent = '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating…';
      }

      try {
        const contact = modal.querySelector('#ssCreateContact')?.value.trim() || null;
        const sorRaw = modal.querySelector('#ssCreateSor')?.value;
        let sor = Number(sorRaw);
        if (!Number.isFinite(sor)) sor = 0;
        sor = Math.max(0, Math.min(100, Math.round(sor)));

        const result = await onCreateSupplier({
          name: nameVal,
          contact_name: contact,
          default_sor_pct: sor,
        });
        const supplier = result?.supplier || null;
        const supplierId = result?.supplierId || supplier?.id || '';
        if (supplier?.id && !items.some((s) => s.id === supplier.id)) {
          items = sortSuppliers([...items, supplier]);
        }
        closeModal();
        setSelection(supplierId);
        hideList();
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'Could not create supplier.';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create & select';
        }
      }
    });

    nameEl?.focus();
    nameEl?.select();
  }

  function renderList(q = '') {
    const query = q.trim().toLowerCase();
    const filtered = items.filter((s) => {
      if (!query) return true;
      return s.name.toLowerCase().includes(query);
    }).slice(0, 40);

    const buttons = [];
    if (allowEmpty && (!query || emptyLabel.toLowerCase().includes(query))) {
      buttons.push(`<button type="button" class="product-search-item${!selectedId ? ' selected' : ''}" data-id="">
        <span class="product-search-name">${escapeHtml(emptyLabel)}</span>
      </button>`);
    }
    filtered.forEach((s) => {
      buttons.push(`<button type="button" class="product-search-item${s.id === selectedId ? ' selected' : ''}" data-id="${escapeHtml(s.id)}">
        <span class="product-search-name">${escapeHtml(s.name)}</span>
      </button>`);
    });

    if (allowCreate && onCreateSupplier) {
      if (!filtered.length && query) {
        buttons.push(`
          <div class="product-search-empty">No suppliers match “${escapeHtml(q.trim())}”</div>
          <button type="button" class="product-search-item product-search-create-trigger">
            <span class="product-search-name">+ Add “${escapeHtml(q.trim())}”</span>
            <span class="product-search-meta">Create supplier and select it</span>
          </button>`);
      } else {
        buttons.push(`<button type="button" class="product-search-item product-search-create-trigger">
          <span class="product-search-name">+ Add supplier…</span>
          <span class="product-search-meta">Create a new supplier</span>
        </button>`);
      }
    }

    list.innerHTML = buttons.length
      ? buttons.join('')
      : '<div class="product-search-empty">No matches</div>';
    list.hidden = false;
    syncListPosition();
  }

  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (list.contains(document.activeElement)) return;
      if (!selectedId && !input.value.trim()) {
        setSelection('');
        return;
      }
      // Keep typed text while the list is open so “Add …” stays useful;
      // only snap back once the list has closed without a selection.
      if (list.hidden && selectedId) syncInput();
      else if (list.hidden && !selectedId) input.value = '';
    }, 150);
  });

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  list.addEventListener('click', (e) => {
    if (e.target.closest('.product-search-create-trigger')) {
      e.stopPropagation();
      const typed = input.value.trim();
      const selectedName = selectedId ? nameFor(selectedId) : '';
      openCreateModal(typed && typed !== selectedName ? typed : '');
      return;
    }
    const btn = e.target.closest('.product-search-item');
    if (!btn) return;
    setSelection(btn.dataset.id || '');
    hideList();
  });

  document.addEventListener('click', (e) => {
    if (root.contains(e.target) || list.contains(e.target)) return;
    hideList();
  });

  root.updateSuppliers = (next) => {
    items = sortSuppliers(next);
    if (selectedId && !items.some((s) => s.id === selectedId)) {
      selectedId = '';
      hidden.value = '';
    }
    syncInput();
  };

  syncInput();

  container.innerHTML = '';
  container.appendChild(root);
  return root;
}
