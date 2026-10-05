/**
 * Left-side bug report drawer — independent of the right admin sheet
 * so both can stay open during a workflow.
 */

import { $ } from '../lib/util.js';

let closeHandler = null;
let closeTimer = null;

function sheetEl() {
  return $('bugSheet');
}

function finishClose(sheet) {
  if (!sheet || sheet.hidden) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  sheet.hidden = true;
  sheet.classList.remove('sheet--visible');
  document.body.classList.remove('bug-drawer-open');
  $('bugSheetBody').innerHTML = '';
  $('bugSheetFoot').innerHTML = '';
  if (closeHandler) {
    const fn = closeHandler;
    closeHandler = null;
    fn();
  }
  document.dispatchEvent(new CustomEvent('bug-sheet-toggle', { detail: { open: false } }));
}

export function isBugSheetOpen() {
  const sheet = sheetEl();
  return !!(sheet && !sheet.hidden);
}

export function openBugSheet({ title, bodyHtml, footHtml, onClose } = {}) {
  const sheet = sheetEl();
  if (!sheet) return;

  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  $('bugSheetTitle').textContent = title || '';
  $('bugSheetBody').innerHTML = bodyHtml || '';
  $('bugSheetFoot').innerHTML = footHtml || '';
  closeHandler = onClose || null;

  sheet.hidden = false;
  document.body.classList.add('bug-drawer-open');
  document.dispatchEvent(new CustomEvent('bug-sheet-toggle', { detail: { open: true } }));

  requestAnimationFrame(() => {
    requestAnimationFrame(() => sheet.classList.add('sheet--visible'));
  });
}

export function closeBugSheet() {
  const sheet = sheetEl();
  if (!sheet || sheet.hidden) return;

  if (sheet.classList.contains('sheet--visible')) {
    sheet.classList.remove('sheet--visible');
    const onEnd = (e) => {
      if (e.target !== sheet || e.propertyName !== 'transform') return;
      sheet.removeEventListener('transitionend', onEnd);
      finishClose(sheet);
    };
    sheet.addEventListener('transitionend', onEnd);
    closeTimer = setTimeout(() => finishClose(sheet), 320);
    return;
  }
  finishClose(sheet);
}

export function initBugSheet() {
  $('bugSheetClose')?.addEventListener('click', closeBugSheet);
}
