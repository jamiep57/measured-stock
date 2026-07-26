/**
 * Generic searchable dropdown — use on mobile instead of native <select>.
 *
 *   mountSearchSelect(container, {
 *     options: [{ value, label, meta?, group?, searchText? }],
 *     value: '',
 *     placeholder: 'Search…',
 *     emptyLabel: '— Select —',
 *     allowEmpty: true,
 *     dropdownFixed: false,
 *     onSelect({ value, option }),
 *   })
 *
 * Root exposes: getValue(), setValue(v), updateOptions(opts)
 */

import { escapeHtml } from '../lib/util.js';

/**
 * @typedef {{ value: string, label: string, meta?: string, group?: string, searchText?: string }} SearchSelectOption
 */

/**
 * @param {HTMLElement} container
 * @param {{
 *   options?: SearchSelectOption[],
 *   value?: string,
 *   placeholder?: string,
 *   emptyLabel?: string,
 *   allowEmpty?: boolean,
 *   dropdownFixed?: boolean,
 *   hiddenId?: string,
 *   inputId?: string,
 *   inputClass?: string,
 *   onSelect?: (sel: { value: string, option: SearchSelectOption | null }) => void,
 * }} [options]
 */
export function mountSearchSelect(container, options = {}) {
  const {
    options: initialOptions = [],
    value = '',
    placeholder = 'Search…',
    emptyLabel = '— Select —',
    allowEmpty = true,
    dropdownFixed = false,
    hiddenId = '',
    inputId = '',
    inputClass = 'search-select-input',
    onSelect,
  } = options;

  let items = Array.isArray(initialOptions) ? [...initialOptions] : [];
  let selectedValue = value || '';

  const uid = `ss-${Math.random().toString(36).slice(2, 9)}`;
  const hid = hiddenId || `${uid}-value`;
  const iid = inputId || `${uid}-input`;

  const root = document.createElement('div');
  root.className = 'search-select';
  root.innerHTML = `
    <input type="hidden" id="${escapeHtml(hid)}" value="${escapeHtml(selectedValue)}">
    <input type="search" id="${escapeHtml(iid)}" class="${escapeHtml(inputClass)}"
      placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-autocomplete="list" role="combobox">
    <div class="product-search-list search-select-list" hidden role="listbox"></div>
  `;

  const hidden = root.querySelector(`#${CSS.escape(hid)}`);
  const input = root.querySelector(`#${CSS.escape(iid)}`);
  const list = root.querySelector('.search-select-list');

  function findOption(val) {
    if (!val) return null;
    return items.find((o) => o.value === val) || null;
  }

  function syncListPosition() {
    if (!dropdownFixed || list.hidden) return;
    const rect = input.getBoundingClientRect();
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
    container.closest('.sheet-body, .admin-drawer-body, .kc-sheet-card')?.addEventListener('scroll', () => {
      if (!list.hidden) syncListPosition();
    }, { passive: true });
  }

  function syncInput() {
    const opt = findOption(selectedValue);
    input.value = opt?.label || '';
  }

  function setSelection(val, { silent = false } = {}) {
    selectedValue = val || '';
    hidden.value = selectedValue;
    syncInput();
    if (!silent) {
      onSelect?.({
        value: selectedValue,
        option: findOption(selectedValue),
      });
    }
  }

  function matchesQuery(opt, query) {
    if (!query) return true;
    const hay = [
      opt.label,
      opt.meta,
      opt.group,
      opt.searchText,
      opt.value,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(query);
  }

  function renderList(q = '') {
    const query = q.trim().toLowerCase();
    const filtered = items.filter((o) => matchesQuery(o, query)).slice(0, 60);

    const buttons = [];
    if (allowEmpty && (!query || emptyLabel.toLowerCase().includes(query))) {
      buttons.push(`<button type="button" class="product-search-item${!selectedValue ? ' selected' : ''}" data-value="">
        <span class="product-search-name">${escapeHtml(emptyLabel)}</span>
      </button>`);
    }

    let lastGroup = null;
    filtered.forEach((o) => {
      const group = (o.group || '').trim();
      if (group && group !== lastGroup) {
        lastGroup = group;
        buttons.push(`<div class="search-select-group" role="presentation">${escapeHtml(group)}</div>`);
      }
      const selected = o.value === selectedValue ? ' selected' : '';
      buttons.push(`<button type="button" class="product-search-item${selected}" data-value="${escapeHtml(o.value)}">
        <span class="product-search-name">${escapeHtml(o.label)}</span>
        ${o.meta ? `<span class="product-search-meta">${escapeHtml(o.meta)}</span>` : ''}
      </button>`);
    });

    list.innerHTML = buttons.length
      ? buttons.join('')
      : '<div class="product-search-empty">No matches</div>';
    list.hidden = false;
    syncListPosition();

    // Keep the field in view above results + keyboard on mobile.
    requestAnimationFrame(() => {
      try {
        input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch { /* ignore */ }
    });
  }

  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideList();
      syncInput();
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (list.contains(document.activeElement)) return;
      if (list.hidden) {
        if (selectedValue) syncInput();
        else if (!allowEmpty) syncInput();
        else input.value = '';
      }
    }, 150);
  });

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.product-search-item');
    if (!btn) return;
    setSelection(btn.dataset.value || '');
    hideList();
  });

  document.addEventListener('click', (e) => {
    if (root.contains(e.target) || list.contains(e.target)) return;
    hideList();
  });

  root.getValue = () => selectedValue;
  root.setValue = (val, opts) => setSelection(val || '', { silent: !!opts?.silent });
  root.updateOptions = (next) => {
    items = Array.isArray(next) ? [...next] : [];
    if (selectedValue && !items.some((o) => o.value === selectedValue)) {
      selectedValue = '';
      hidden.value = '';
    }
    syncInput();
  };

  Object.defineProperty(root, 'value', {
    get: () => selectedValue,
    set: (v) => setSelection(v || '', { silent: true }),
  });

  syncInput();
  container.innerHTML = '';
  container.appendChild(root);
  return root;
}
