import { escapeHtml } from '../lib/util.js';
import { icon } from '../lib/icons.js';

let backdropEl = null;
let modalEl = null;
let closeHandler = null;
let onKeyDown = null;

function finishClose() {
  if (onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
  backdropEl?.remove();
  modalEl?.remove();
  backdropEl = null;
  modalEl = null;
  if (closeHandler) {
    const fn = closeHandler;
    closeHandler = null;
    fn();
  }
}

export function closeModal() {
  if (!modalEl) return;
  backdropEl?.classList.remove('admin-modal-backdrop--visible');
  modalEl.classList.remove('admin-modal--visible');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    finishClose();
    return;
  }
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    modalEl?.removeEventListener('transitionend', end);
    finishClose();
  };
  modalEl.addEventListener('transitionend', end);
  setTimeout(end, 220);
}

/**
 * Centered modal above drawers and dropdowns.
 */
export function openModal({ title, bodyHtml, footHtml, onClose }) {
  closeModal();

  closeHandler = onClose || null;
  backdropEl = document.createElement('div');
  backdropEl.className = 'admin-modal-backdrop';
  modalEl = document.createElement('div');
  modalEl.className = 'admin-modal';
  modalEl.setAttribute('role', 'dialog');
  modalEl.setAttribute('aria-modal', 'true');
  modalEl.innerHTML = `
    <div class="admin-modal-head">
      <div class="admin-modal-title">${escapeHtml(title || '')}</div>
      <button type="button" class="icon-btn admin-modal-close" aria-label="Close">
        ${icon('x', { size: 16 })}
      </button>
    </div>
    <div class="admin-modal-body">${bodyHtml || ''}</div>
    ${footHtml ? `<div class="admin-modal-foot">${footHtml}</div>` : ''}`;

  document.body.appendChild(backdropEl);
  document.body.appendChild(modalEl);

  backdropEl.addEventListener('click', closeModal);
  modalEl.querySelector('.admin-modal-close')?.addEventListener('click', closeModal);

  onKeyDown = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onKeyDown);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      backdropEl?.classList.add('admin-modal-backdrop--visible');
      modalEl?.classList.add('admin-modal--visible');
    });
  });

  return modalEl;
}
