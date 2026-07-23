/**
 * Searchable supplier picker — type-to-filter combobox with optional empty choice.
 */

import { escapeHtml } from '../lib/util.js';

/**
 * @returns {HTMLElement} root element
 */
export function mountSupplierSearch(container, options = {}) {
  const {
    suppliers = [],
    value = '',
    placeholder = 'Search suppliers…',
    emptyLabel = '— Optional —',
    allowEmpty = true,
    hiddenId = 'dfSupplier',
    inputId = 'dfSupplierInput',
    inputClass = 'supplier-search-input admin-input',
    onSelect,
  } = options;

  const items = [...suppliers]
    .filter((s) => s.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  let selectedId = value || '';

  const root = document.createElement('div');
  root.className = 'supplier-search';
  root.innerHTML = `
    <input type="hidden" id="${escapeHtml(hiddenId)}" value="${escapeHtml(selectedId)}">
    <input type="search" id="${escapeHtml(inputId)}" class="${escapeHtml(inputClass)}"
      placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-autocomplete="list" role="combobox">
    <div class="product-search-list supplier-search-list" hidden role="listbox"></div>
  `;

  const hidden = root.querySelector(`#${CSS.escape(hiddenId)}`);
  const input = root.querySelector(`#${CSS.escape(inputId)}`);
  const list = root.querySelector('.supplier-search-list');

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

    list.innerHTML = buttons.length
      ? buttons.join('')
      : '<div class="product-search-empty">No matches</div>';
    list.hidden = false;
  }

  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!selectedId && !input.value.trim()) {
        setSelection('');
        return;
      }
      syncInput();
    }, 150);
  });

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.product-search-item');
    if (!btn) return;
    setSelection(btn.dataset.id || '');
    list.hidden = true;
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) list.hidden = true;
  });

  syncInput();

  container.innerHTML = '';
  container.appendChild(root);
  return root;
}
