/**
 * Global undo/redo for quantity / number cells (num-math and kit qty).
 * Captures the value when you start editing; after a change, Undo restores it
 * and re-fires input/change so the active panel's save handlers run.
 *
 * Toolbar controls: `.field-undo-btn` / `.field-redo-btn` (e.g. topbar edit strip).
 */

import { toast } from './util.js';

const MAX_STACK = 40;

/** @type {WeakMap<HTMLInputElement, { before: string, captured: boolean }>} */
const focusState = new WeakMap();

/** @type {Array<{ el: HTMLInputElement, id: string, before: string, after: string, cleared: boolean }>} */
let undoStack = [];

/** @type {Array<{ el: HTMLInputElement, id: string, before: string, after: string, cleared: boolean }>} */
let redoStack = [];

/** @type {(el: Element | null | undefined) => boolean} */
let isTarget = () => false;

function undoButtons() {
  return [...document.querySelectorAll('.field-undo-btn')];
}

function redoButtons() {
  return [...document.querySelectorAll('.field-redo-btn')];
}

function syncUndoButtons() {
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  undoButtons().forEach((btn) => {
    btn.disabled = !canUndo;
    btn.setAttribute('aria-disabled', canUndo ? 'false' : 'true');
  });
  redoButtons().forEach((btn) => {
    btn.disabled = !canRedo;
    btn.setAttribute('aria-disabled', canRedo ? 'false' : 'true');
  });
}

function resolveInput(entry) {
  if (entry?.el?.isConnected) return entry.el;
  if (entry?.id) {
    const byId = document.getElementById(entry.id);
    if (byId && isTarget(byId)) return /** @type {HTMLInputElement} */ (byId);
  }
  return null;
}

/**
 * @param {HTMLInputElement} el
 * @param {string} value
 */
function applyValue(el, value) {
  focusState.delete(el);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
}

function pushEntry(input, before) {
  const now = input.value ?? '';
  if (before === now) return;
  const cleared = String(before).trim() !== '' && String(now).trim() === '';
  undoStack.push({
    el: input,
    id: input.id || '',
    before,
    after: now,
    cleared,
  });
  if (undoStack.length > MAX_STACK) undoStack.shift();
  redoStack = [];
  syncUndoButtons();
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
  syncUndoButtons();
  if (!entry) return false;
  const el = resolveInput(entry);
  if (!el) {
    toast('Could not restore — that cell was refreshed', true);
    return false;
  }
  const current = el.value ?? '';
  applyValue(el, entry.before);
  redoStack.push({
    ...entry,
    after: current === entry.before ? entry.after : current,
  });
  if (redoStack.length > MAX_STACK) redoStack.shift();
  syncUndoButtons();
  toast('Restored');
  return true;
}

/**
 * Re-apply the most recently undone number change.
 * @returns {boolean}
 */
export function redoLastField() {
  const entry = redoStack.pop();
  syncUndoButtons();
  if (!entry) return false;
  const el = resolveInput(entry);
  if (!el) {
    toast('Could not redo — that cell was refreshed', true);
    return false;
  }
  applyValue(el, entry.after);
  undoStack.push(entry);
  if (undoStack.length > MAX_STACK) undoStack.shift();
  syncUndoButtons();
  toast('Redone');
  return true;
}

/** Drop stacked undos (e.g. after Discard rebuilds a grid). */
export function clearFieldUndo() {
  undoStack = [];
  redoStack = [];
  syncUndoButtons();
}

/** Keep toolbar buttons in sync after route remounts inject new markup. */
export function refreshFieldUndoButtons() {
  syncUndoButtons();
}

/**
 * @param {ParentNode} [root]
 * @param {{ isTarget?: (el: Element | null | undefined) => boolean }} [opts]
 * @returns {() => void}
 */
export function initFieldUndo(root = document, opts = {}) {
  if (typeof opts.isTarget === 'function') isTarget = opts.isTarget;
  syncUndoButtons();

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
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && e.shiftKey) {
      if (!redoStack.length) return;
      if (isTarget(document.activeElement)) return;
      e.preventDefault();
      redoLastField();
      return;
    }
    if (key === 'y' && !e.shiftKey) {
      if (!redoStack.length) return;
      if (isTarget(document.activeElement)) return;
      e.preventDefault();
      redoLastField();
      return;
    }
    if (key !== 'z' || e.shiftKey) return;
    if (!undoStack.length) return;
    // While typing in a number cell, keep native character undo.
    if (isTarget(document.activeElement)) return;
    e.preventDefault();
    undoLastField();
  };

  const onClick = (e) => {
    const undoBtn = e.target.closest?.('.field-undo-btn');
    if (undoBtn && !undoBtn.disabled) {
      e.preventDefault();
      undoLastField();
      return;
    }
    const redoBtn = e.target.closest?.('.field-redo-btn');
    if (redoBtn && !redoBtn.disabled) {
      e.preventDefault();
      redoLastField();
    }
  };

  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('input', onInput);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('click', onClick);

  return () => {
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('input', onInput);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('click', onClick);
  };
}
