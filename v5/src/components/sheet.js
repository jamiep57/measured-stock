import { $ } from '../lib/util.js';

let closeHandler = null;
let closeTimer = null;
let lastFocus = null;
let onKeyDown = null;

function isAnimatedDrawer(sheet) {
  return sheet.classList.contains('sheet--admin-full');
}

function focusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function finishClose(sheet) {
  if (sheet.hidden) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
  sheet.hidden = true;
  sheet.className = 'sheet';
  sheet.removeAttribute('aria-modal');
  sheet.removeAttribute('role');
  document.body.style.overflow = '';
  document.body.classList.remove('admin-drawer-open');
  $('sheetBody').innerHTML = '';
  $('sheetFoot').innerHTML = '';
  if (closeHandler) {
    const fn = closeHandler;
    closeHandler = null;
    fn();
  }
  const restore = lastFocus;
  lastFocus = null;
  if (restore && typeof restore.focus === 'function') {
    try { restore.focus(); } catch { /* ignore */ }
  }
}

export function openSheet({ title, bodyHtml, footHtml, onClose, variant }) {
  const sheet = $('sheet');
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }

  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  sheet.className = 'sheet';
  if (variant) sheet.classList.add(`sheet--${variant}`);
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  $('sheetTitle').textContent = title || '';
  $('sheetBody').innerHTML = bodyHtml || '';
  $('sheetFoot').innerHTML = footHtml || '';
  closeHandler = onClose || null;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  if (variant === 'admin-full') {
    document.body.classList.add('admin-drawer-open');
  }

  onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = focusables(sheet);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  if (isAnimatedDrawer(sheet)) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => sheet.classList.add('sheet--visible'));
    });
  }

  requestAnimationFrame(() => {
    const nodes = focusables(sheet);
    const preferred = sheet.querySelector('input:not([type="hidden"]), textarea, select');
    (preferred || nodes[0] || $('sheetClose'))?.focus?.();
  });
}

export function closeSheet() {
  const sheet = $('sheet');
  if (isAnimatedDrawer(sheet) && sheet.classList.contains('sheet--visible')) {
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

export function initSheet() {
  $('sheetClose')?.addEventListener('click', closeSheet);
}
