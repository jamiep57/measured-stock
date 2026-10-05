/**
 * Shared serve-size menu. The list is the organisation catalogue.
 * Add at the bottom creates a size every event can use.
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
  const width = Math.max(rect.width, 196);
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
  menuEl = document.createElement('div');
  menuEl.className = 'serve-size-menu';
  menuEl.innerHTML = `
    <div class="serve-size-menu-list" role="listbox">
      ${options.map((option) => `<button type="button" class="serve-size-option${option.current ? ' is-current' : ''}" role="option" data-size="${escapeHtml(option.label)}" aria-selected="${option.current ? 'true' : 'false'}">${escapeHtml(option.label)}</button>`).join('')
        || '<p class="serve-size-empty">No sizes yet</p>'}
    </div>
    <div class="serve-size-menu-foot">
      <button type="button" class="serve-size-add-btn" data-add-size>${icon('plus', { size: 14 })} Add size</button>
    </div>`;
  document.body.appendChild(menuEl);
  placeMenu(anchor);

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

  menuEl.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-size]');
    if (choice) {
      const label = choice.dataset.size;
      closeServeSizeMenu();
      onPick(label);
      return;
    }
    if (!e.target.closest('[data-add-size]')) return;
    const foot = menuEl.querySelector('.serve-size-menu-foot');
    foot.innerHTML = `
      <form class="serve-size-add">
        <input class="admin-input" name="label" maxlength="40" placeholder="New size" aria-label="New size" autocomplete="off">
        <button type="submit" class="admin-drawer-btn admin-drawer-btn--primary">Add</button>
      </form>
      <p class="serve-size-err" hidden></p>`;
    const input = foot.querySelector('input');
    input.focus();
    placeMenu(anchor);
    foot.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = foot.querySelector('.serve-size-err');
      const label = input.value.trim();
      if (!label) {
        err.textContent = 'Name the size';
        err.hidden = false;
        return;
      }
      const button = foot.querySelector('button');
      button.disabled = true;
      try {
        await onCreate(label);
        closeServeSizeMenu();
      } catch (error) {
        button.disabled = false;
        err.textContent = error?.message || 'Could not add that size';
        err.hidden = false;
      }
    });
  });
}
