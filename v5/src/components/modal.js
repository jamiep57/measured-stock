import { escapeHtml } from '../lib/util.js';

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
 * Centered modal above sheets and dropdowns.
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
        <span aria-hidden="true" style="font-size:22px;line-height:1">×</span>
      </button>
    </div>
    <div class="admin-modal-body">${bodyHtml || ''}</div>
    ${footHtml ? `<div class="admin-modal-foot">${footHtml}</div>` : ''}`;

  document.body.appendChild(backdropEl);
  document.body.appendChild(modalEl);

  function placeInViewport() {
    if (!modalEl) return;
    const vv = window.visualViewport;
    if (!vv) return;
    // Keep the dialog in the visible area above the iOS keyboard.
    const centerY = vv.offsetTop + Math.min(vv.height * 0.42, Math.max(180, vv.height * 0.5));
    modalEl.style.top = `${Math.round(centerY)}px`;
    modalEl.style.maxHeight = `${Math.round(Math.min(vv.height - 24, 640))}px`;
  }

  placeInViewport();
  const onVv = () => placeInViewport();
  window.visualViewport?.addEventListener('resize', onVv);
  window.visualViewport?.addEventListener('scroll', onVv);

  const prevClose = closeHandler;
  closeHandler = () => {
    window.visualViewport?.removeEventListener('resize', onVv);
    window.visualViewport?.removeEventListener('scroll', onVv);
    prevClose?.();
  };

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
      placeInViewport();
    });
  });

  return modalEl;
}

/**
 * Promise-based confirm dialog (replaces window.confirm).
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel]
 * @param {string} [opts.cancelLabel]
 * @param {boolean} [opts.danger]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
  const {
    title = 'Confirm',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = true,
  } = opts;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    const confirmClass = danger
      ? 'admin-drawer-btn admin-drawer-btn--danger'
      : 'admin-drawer-btn admin-drawer-btn--primary';

    const el = openModal({
      title,
      bodyHtml: `<p class="admin-modal-confirm-msg">${escapeHtml(message)}</p>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-confirm-cancel>
            ${escapeHtml(cancelLabel)}
          </button>
          <button type="button" class="${confirmClass}" data-confirm-ok>
            ${escapeHtml(confirmLabel)}
          </button>
        </div>`,
      onClose: () => settle(false),
    });

    el?.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => settle(false));
    el?.querySelector('[data-confirm-ok]')?.addEventListener('click', () => settle(true));

    requestAnimationFrame(() => {
      el?.querySelector('[data-confirm-ok]')?.focus();
    });
  });
}
