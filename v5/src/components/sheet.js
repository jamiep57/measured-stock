import { $ } from '../lib/util.js';

let closeHandler = null;
let closeTimer = null;

function isAnimatedDrawer(sheet) {
  return sheet.classList.contains('sheet--admin-full');
}

function finishClose(sheet) {
  if (sheet.hidden) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  sheet.hidden = true;
  sheet.className = 'sheet';
  document.body.style.overflow = '';
  document.body.classList.remove('admin-drawer-open');
  $('sheetBody').innerHTML = '';
  $('sheetFoot').innerHTML = '';
  if (closeHandler) {
    const fn = closeHandler;
    closeHandler = null;
    fn();
  }
}

export function openSheet({ title, bodyHtml, footHtml, onClose, variant }) {
  const sheet = $('sheet');
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  sheet.className = 'sheet';
  if (variant) sheet.classList.add(`sheet--${variant}`);
  $('sheetTitle').textContent = title || '';
  $('sheetBody').innerHTML = bodyHtml || '';
  $('sheetFoot').innerHTML = footHtml || '';
  closeHandler = onClose || null;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  if (variant === 'admin-full') {
    document.body.classList.add('admin-drawer-open');
  }

  if (isAnimatedDrawer(sheet)) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => sheet.classList.add('sheet--visible'));
    });
  }
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
