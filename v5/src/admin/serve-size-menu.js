/**
 * Shared serve-size menu. The list is the organisation catalogue.
 * Type to filter, or add a size every event can use.
 */

import { escapeHtml } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { serveSizeChoices } from '../lib/serve-sizes.js';

let menuEl = null;
let cleanup = null;

export function closeServeSizeMenu() {
  cleanup?.();
  cleanup = null;
  menuEl?.remove();
  menuEl = null;
}

function placeMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(rect.width, 220);
  menuEl.style.width = `${width}px`;
  const height = menuEl.offsetHeight;
  const below = window.innerHeight - rect.bottom;
  const top = below < height + 8 && rect.top > height + 8
    ? rect.top - height - 4
    : rect.bottom + 4;
  const left = Math.min(rect.left, window.innerWidth - width - 8);
  menuEl.style.top = `${Math.max(8, top)}px`;
  menuEl.style.left = `${Math.max(8, left)}px`;
}

function matchesQuery(label, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

/**
 * @param {{
 *   anchor: HTMLElement,
 *   sizes?: object[],
 *   current?: string,
 *   onPick: (label: string) => void,
 *   onCreate: (label: string) => Promise<void>,
 * }} opts
 */
export function openServeSizeMenu({ anchor, sizes = [], current = '', onPick, onCreate }) {
  closeServeSizeMenu();
  const options = serveSizeChoices(sizes, current);
  const listId = 'serve-size-list';
  let query = '';
  let active = Math.max(0, options.findIndex((option) => option.current));
  let creating = false;

  menuEl = document.createElement('div');
  menuEl.className = 'serve-size-menu';
  menuEl.innerHTML = `
    <div class="serve-size-menu-search">
      <input class="admin-input serve-size-search" type="text" placeholder="Find or add a size" aria-label="Find or add a size" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${listId}">
    </div>
    <div class="serve-size-menu-list" id="${listId}" role="listbox"></div>
    <div class="serve-size-menu-foot">
      <button type="button" class="serve-size-add-btn" data-add-size>${icon('plus', { size: 14 })} Add size</button>
    </div>`;
  document.body.appendChild(menuEl);

  const search = menuEl.querySelector('.serve-size-search');
  const list = menuEl.querySelector('.serve-size-menu-list');

  function shownOptions() {
    return options.filter((option) => matchesQuery(option.label, query));
  }

  function exactOption(value) {
    const key = value.trim().toLowerCase();
    if (!key) return null;
    return options.find((option) => option.label.toLowerCase() === key) || null;
  }

  function revealActive() {
    const btn = list.querySelector('.is-active');
    if (!btn) return;
    const listRect = list.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.top < listRect.top) list.scrollTop -= listRect.top - btnRect.top;
    else if (btnRect.bottom > listRect.bottom) list.scrollTop += btnRect.bottom - listRect.bottom;
  }

  function paintActive({ scroll = false } = {}) {
    const buttons = [...list.querySelectorAll('.serve-size-option')];
    buttons.forEach((btn, index) => {
      const on = index === active;
      btn.classList.toggle('is-active', on);
      if (on) search.setAttribute('aria-activedescendant', btn.id);
    });
    if (!buttons.length) search.removeAttribute('aria-activedescendant');
    if (scroll) revealActive();
  }

  function addButtonLabel() {
    const typed = query.trim();
    if (typed && !shownOptions().length) return `Add ${typed}`;
    return 'Add size';
  }

  function renderList() {
    const shown = shownOptions();
    if (active > shown.length - 1) active = Math.max(0, shown.length - 1);
    if (!shown.length) {
      list.innerHTML = `<p class="serve-size-empty">${query.trim() ? 'No sizes match' : 'No sizes yet'}</p>`;
    } else {
      list.innerHTML = shown.map((option, index) => `<button type="button" class="serve-size-option${option.current ? ' is-current' : ''}${index === active ? ' is-active' : ''}" id="serve-size-opt-${index}" role="option" data-size="${escapeHtml(option.label)}">${escapeHtml(option.label)}</button>`).join('');
    }
    const addBtn = menuEl.querySelector('[data-add-size]');
    if (addBtn) addBtn.innerHTML = `${icon('plus', { size: 14 })} ${escapeHtml(addButtonLabel())}`;
    paintActive({ scroll: true });
    placeMenu(anchor);
  }

  function pick(label) {
    closeServeSizeMenu();
    onPick(label);
  }

  async function createLabel(label) {
    const name = String(label || '').trim();
    const foot = menuEl?.querySelector('.serve-size-menu-foot');
    if (!name || !foot || creating) return;
    const existing = exactOption(name);
    if (existing) {
      pick(existing.label);
      return;
    }
    creating = true;
    let err = foot.querySelector('.serve-size-err');
    if (!err) {
      err = document.createElement('p');
      err.className = 'serve-size-err';
      err.hidden = true;
      foot.appendChild(err);
    }
    const button = foot.querySelector('button');
    if (button) button.disabled = true;
    search.disabled = true;
    try {
      await onCreate(name);
      closeServeSizeMenu();
    } catch (error) {
      creating = false;
      if (button) button.disabled = false;
      search.disabled = false;
      err.textContent = error?.message || 'Could not add that size';
      err.hidden = false;
      if (menuEl) placeMenu(anchor);
    }
  }

  function showAddForm() {
    const foot = menuEl.querySelector('.serve-size-menu-foot');
    const prefill = query.trim();
    foot.innerHTML = `
      <form class="serve-size-add">
        <input class="admin-input" name="label" maxlength="40" placeholder="New size" aria-label="New size" autocomplete="off" spellcheck="false">
        <button type="submit" class="admin-drawer-btn admin-drawer-btn--primary">Add</button>
      </form>
      <p class="serve-size-err" hidden></p>`;
    const input = foot.querySelector('input');
    input.value = prefill;
    input.focus();
    if (prefill) input.select();
    placeMenu(anchor);
    foot.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const err = foot.querySelector('.serve-size-err');
      const label = input.value.trim();
      if (!label) {
        err.textContent = 'Name the size';
        err.hidden = false;
        return;
      }
      createLabel(label);
    });
  }

  function onPointerDown(e) {
    if (menuEl?.contains(e.target) || anchor.contains(e.target)) return;
    closeServeSizeMenu();
  }
  function onKey(e) {
    if (e.key === 'Escape') closeServeSizeMenu();
  }
  function onScroll() {
    closeServeSizeMenu();
  }
  const scroller = anchor.closest('.plan-grid-wrap, .sheet-body, .admin-drawer-body');
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onScroll);
  scroller?.addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onScroll);
    scroller?.removeEventListener('scroll', onScroll);
  };

  list.addEventListener('mousemove', (e) => {
    const choice = e.target.closest('[data-size]');
    if (!choice) return;
    const index = [...list.querySelectorAll('.serve-size-option')].indexOf(choice);
    if (index < 0 || index === active) return;
    active = index;
    paintActive();
  });

  menuEl.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-size]');
    if (choice) {
      pick(choice.dataset.size);
      return;
    }
    if (!e.target.closest('[data-add-size]')) return;
    const typed = query.trim();
    if (typed && !shownOptions().length) {
      createLabel(typed);
      return;
    }
    showAddForm();
  });

  search.addEventListener('input', () => {
    query = search.value;
    active = 0;
    renderList();
  });
  search.addEventListener('keydown', (e) => {
    const shown = shownOptions();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!shown.length) return;
      active = Math.min(shown.length - 1, active + 1);
      paintActive({ scroll: true });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      active = Math.max(0, active - 1);
      paintActive({ scroll: true });
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (shown.length) {
      pick(shown[active]?.label || shown[0].label);
      return;
    }
    if (query.trim()) createLabel(query.trim());
  });

  renderList();
  search.focus();
}
