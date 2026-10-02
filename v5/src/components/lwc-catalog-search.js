/**
 * Typeahead against the public LWC catalogue, attached to an existing name input.
 */

import { escapeHtml } from '../lib/util.js';
import { searchSupplierCatalogs } from '../lib/supplier-catalogs.js';

const DEBOUNCE_MS = 280;

/**
 * @param {HTMLInputElement} input
 * @param {{
 *   dropdownFixed?: boolean,
 *   onPick?: (hit: object) => void,
 * }} [options]
 */
export function attachLwcNameSuggest(input, options = {}) {
  if (!input) return () => {};
  const { dropdownFixed = true, onPick } = options;

  const wrap = document.createElement('div');
  wrap.className = 'lwc-name-search';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement('div');
  list.className = 'product-search-list lwc-suggest-list';
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  wrap.appendChild(list);

  let timer = 0;
  let seq = 0;
  let hits = [];
  let active = -1;
  let abort = null;
  let applying = false;

  function syncListPosition() {
    if (!dropdownFixed || list.hidden) return;
    const rect = input.getBoundingClientRect();
    if (list.parentElement !== document.body) {
      document.body.appendChild(list);
    }
    list.style.position = 'fixed';
    list.style.left = `${rect.left}px`;
    list.style.width = `${Math.max(rect.width, 280)}px`;
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
    if (list.parentElement !== wrap) wrap.appendChild(list);
  }

  function hideList() {
    list.hidden = true;
    hits = [];
    active = -1;
    resetListPosition();
  }

  function render(status = '') {
    if (status) {
      list.innerHTML = `<div class="product-search-empty">${escapeHtml(status)}</div>`;
      list.hidden = false;
      syncListPosition();
      return;
    }
    if (!hits.length) {
      hideList();
      return;
    }
    list.innerHTML = hits.map((hit, i) => {
      const meta = [hit.sku, hit.productCategory || hit.productType, hit.unitSize]
        .filter(Boolean).join(' · ');
      const img = hit.image
        ? `<img class="lwc-suggest-thumb" src="${escapeHtml(hit.image)}" alt="" width="36" height="36">`
        : '<span class="lwc-suggest-thumb lwc-suggest-thumb--empty"></span>';
      const badge = hit.sourceLabel || (hit.source === 'twe' ? 'TWE' : 'LWC');
      return `<button type="button" class="product-search-item lwc-suggest-item${i === active ? ' selected' : ''}"
        data-idx="${i}" role="option">
        ${img}
        <span class="lwc-suggest-copy">
          <span class="product-search-name">${escapeHtml(hit.name)}</span>
          ${meta ? `<span class="product-search-meta">${escapeHtml(meta)}</span>` : ''}
        </span>
        <span class="lwc-suggest-badge">${escapeHtml(badge)}</span>
      </button>`;
    }).join('');
    list.hidden = false;
    syncListPosition();
  }

  function pick(hit) {
    if (!hit) return;
    applying = true;
    hideList();
    window.clearTimeout(timer);
    abort?.abort();
    try {
      onPick?.(hit);
    } finally {
      applying = false;
    }
  }

  async function runSearch(q) {
    const query = String(q || '').trim();
    if (query.length < 3) {
      hideList();
      return;
    }
    abort?.abort();
    abort = new AbortController();
    const mySeq = ++seq;
    render('Searching catalogues…');
    try {
      const results = await searchSupplierCatalogs(query, { signal: abort.signal });
      if (mySeq !== seq) return;
      hits = results;
      active = results.length ? 0 : -1;
      if (!results.length) render('No catalogue matches');
      else render();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (mySeq !== seq) return;
      hits = [];
      render('Catalogues unavailable');
    }
  }

  function schedule() {
    if (applying) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => runSearch(input.value), DEBOUNCE_MS);
  }

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('role', 'combobox');

  const onInput = () => schedule();
  const onFocus = () => {
    if (hits.length) render();
    else if (input.value.trim().length >= 3) schedule();
  };
  const onKeyDown = (e) => {
    if (list.hidden || !hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % hits.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + hits.length) % hits.length;
      render();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') {
      hideList();
    }
  };
  const onDocClick = (e) => {
    if (wrap.contains(e.target) || list.contains(e.target)) return;
    hideList();
  };
  const onScroll = () => {
    if (!list.hidden) syncListPosition();
  };

  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('keydown', onKeyDown);
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-idx]');
    if (!btn) return;
    pick(hits[Number(btn.dataset.idx)]);
  });
  document.addEventListener('click', onDocClick);
  window.addEventListener('resize', onScroll, { passive: true });
  input.closest('.sheet-body')?.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    window.clearTimeout(timer);
    abort?.abort();
    hideList();
    input.removeEventListener('input', onInput);
    input.removeEventListener('focus', onFocus);
    input.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('resize', onScroll);
    list.remove();
  };
}
