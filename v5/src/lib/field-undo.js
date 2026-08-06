/**
 * Global undo for quantity / number cells (num-math and kit qty).
 * Captures the value when you start editing; after a change, Undo restores it
 * and re-fires input/change so the active panel's save handlers run.
 */

import { toast } from './util.js';

const MAX_STACK = 40;

/** @type {WeakMap<HTMLInputElement, { before: string, captured: boolean }>} */
const focusState = new WeakMap();

/** @type {Array<{ el: HTMLInputElement, id: string, before: string, cleared: boolean }>} */
let undoStack = [];

/** @type {HTMLButtonElement | null} */
let fabEl = null;

/** @type {(el: Element | null | undefined) => boolean} */
let isTarget = () => false;

function ensureFab() {
  if (fabEl?.isConnected) return fabEl;
  let el = document.getElementById('fieldUndoFab');
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'fieldUndoFab';
    el.className = 'field-undo-fab';
    el.hidden = true;
    el.setAttribute('aria-label', 'Undo last number change');
    el.innerHTML = '<span class="field-undo-fab-icon" aria-hidden="true">↶</span><span>Undo</span>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      e.preventDefault();
      undoLastField();
    });
  }
  fabEl = /** @type {HTMLButtonElement} */ (el);
  return fabEl;
}

function syncFab() {
  const fab = ensureFab();
  const has = undoStack.length > 0;
  fab.hidden = !has;
  fab.disabled = !has;
  fab.classList.toggle('is-visible', has);
}

function resolveInput(entry) {
  if (entry?.el?.isConnected) return entry.el;
  if (entry?.id) {
    const byId = document.getElementById(entry.id);
    if (byId && isTarget(byId)) return /** @type {HTMLInputElement} */ (byId);
  }
  return null;
}

function pushEntry(input, before) {
  const now = input.value ?? '';
  if (before === now) return;
  const cleared = String(before).trim() !== '' && String(now).trim() === '';
  undoStack.push({
    el: input,
    id: input.id || '',
    before,
    cleared,
  });
  if (undoStack.length > MAX_STACK) undoStack.shift();
  syncFab();
}

function offerToast(entry) {
  if (!entry) return;
  toast(entry.cleared ? 'Number cleared' : 'Number updated', false, {
    action: { label: 'Undo', onClick: () => { undoLastField(); } },
    duration: 7000,
  });
}

/**
 * Restore the most recent number change across the app.
 * @returns {boolean}
 */
export function undoLastField() {
  const entry = undoStack.pop();
  syncFab();
  if (!entry) return false;
  const el = resolveInput(entry);
  if (!el) {
    toast('Could not restore — that cell was refreshed', true);
    return false;
  }
  focusState.delete(el);
  el.value = entry.before;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  toast('Restored');
  return true;
}

/** Drop stacked undos (e.g. after Discard rebuilds a grid). */
export function clearFieldUndo() {
  undoStack = [];
  syncFab();
}

/**
 * @param {ParentNode} [root]
 * @param {{ isTarget?: (el: Element | null | undefined) => boolean }} [opts]
 * @returns {() => void}
 */
export function initFieldUndo(root = document, opts = {}) {
  if (typeof opts.isTarget === 'function') isTarget = opts.isTarget;
  ensureFab();
  syncFab();

  const onFocusIn = (e) => {
    const input = e.target;
    if (!isTarget(input)) return;
    const el = /** @type {HTMLInputElement} */ (input);
    if (focusState.has(el)) return;
    focusState.set(el, { before: el.value ?? '', captured: false });
  };

  const onInput = (e) => {
    const input = e.target;
    if (!isTarget(input)) return;
    const el = /** @type {HTMLInputElement} */ (input);
    const state = focusState.get(el);
    if (!state || state.captured) return;
    if ((el.value ?? '') === state.before) return;
    pushEntry(el, state.before);
    state.captured = true;
  };

  const onFocusOut = (e) => {
    const input = e.target;
    if (!isTarget(input)) return;
    const el = /** @type {HTMLInputElement} */ (input);
    const state = focusState.get(el);
    if (state?.captured) {
      const entry = [...undoStack].reverse().find((u) => u.el === el || (u.id && u.id === el.id));
      offerToast(entry);
    }
    focusState.delete(el);
  };

  const onKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'z' || e.shiftKey || e.altKey) return;
    if (!undoStack.length) return;
    // While typing in a number cell, keep native character undo.
    if (isTarget(document.activeElement)) return;
    e.preventDefault();
    undoLastField();
  };

  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('input', onInput);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('keydown', onKeyDown);

  return () => {
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('input', onInput);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener('keydown', onKeyDown);
  };
}
