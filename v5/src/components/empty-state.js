/**
 * Shared empty / error / not-found widgets for admin + mobile.
 */

import { escapeHtml } from '../lib/util.js';

/** Inline Lucide-style icons for admin (Phosphor isn’t loaded there). */
const ADMIN_WARN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;

const ADMIN_PIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;

/**
 * @param {object} opts
 * @param {string} [opts.icon] Phosphor class suffix, e.g. "package" → ph-package
 * @param {string} [opts.iconHtml] Raw icon HTML (admin lucide / custom)
 * @param {string} opts.title
 * @param {string} [opts.copy]
 * @param {string} [opts.ctaHtml] Optional action markup (button/link)
 * @param {string} [opts.variant] panel | card | inline | admin
 * @param {string} [opts.className]
 * @param {'status'|'alert'} [opts.role]
 */
export function emptyState(opts = {}) {
  const {
    icon,
    iconHtml,
    title = '',
    copy = '',
    ctaHtml = '',
    variant = 'panel',
    className = '',
    role = 'status',
  } = opts;

  const variantClass = variant === 'admin'
    ? 'empty empty--admin'
    : `empty empty--${variant}`;
  const extra = className ? ` ${className}` : '';

  let iconBlock = '';
  if (iconHtml) {
    iconBlock = `<span class="empty-icon" aria-hidden="true">${iconHtml}</span>`;
  } else if (icon) {
    iconBlock = `<span class="empty-icon" aria-hidden="true"><i class="ph ph-${escapeHtml(icon)}"></i></span>`;
  }

  const copyBlock = copy
    ? `<p class="empty-copy">${escapeHtml(copy)}</p>`
    : '';
  const ctaBlock = ctaHtml
    ? `<div class="empty-cta">${ctaHtml}</div>`
    : '';

  return `
    <div class="${variantClass}${extra}" role="${role}">
      ${iconBlock}
      <p class="empty-title">${escapeHtml(title)}</p>
      ${copyBlock}
      ${ctaBlock}
    </div>`;
}

/**
 * Failed load state with optional Retry control.
 * Use data-empty-retry on the button; caller binds click.
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.copy]
 * @param {string} [opts.retryLabel]
 * @param {boolean} [opts.showRetry]
 * @param {string} [opts.variant]
 * @param {string} [opts.className]
 * @param {string} [opts.iconHtml]
 */
export function errorState(opts = {}) {
  const {
    title = 'Couldn’t load',
    copy = 'Check your connection and try again.',
    retryLabel = 'Retry',
    showRetry = true,
    variant = 'panel',
    className = '',
    iconHtml = '',
  } = opts;

  const ctaHtml = showRetry
    ? `<button type="button" class="empty-retry-btn" data-empty-retry>${escapeHtml(retryLabel)}</button>`
    : '';

  const useAdminIcon = variant === 'admin';
  return emptyState({
    icon: useAdminIcon || iconHtml ? undefined : 'warning-circle',
    iconHtml: iconHtml || (useAdminIcon ? ADMIN_WARN_ICON : ''),
    title,
    copy,
    ctaHtml,
    variant,
    className: `empty--error${className ? ` ${className}` : ''}`,
    role: 'alert',
  });
}

/**
 * Branded not-found / unknown route page.
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.copy]
 * @param {string} [opts.homeHref]
 * @param {string} [opts.homeLabel]
 * @param {string} [opts.secondaryHref]
 * @param {string} [opts.secondaryLabel]
 * @param {'admin'|'mobile'} [opts.surface]
 */
export function notFoundState(opts = {}) {
  const {
    title = 'Page not found',
    copy = 'That URL doesn’t match a page in this app.',
    homeHref = '/',
    homeLabel = 'Back to events',
    secondaryHref = '',
    secondaryLabel = '',
    surface = 'admin',
  } = opts;

  const primaryClass = surface === 'admin'
    ? 'admin-drawer-btn admin-drawer-btn--primary'
    : 'btn btn-primary empty-retry-btn';
  const secondaryClass = surface === 'admin'
    ? 'admin-drawer-btn admin-drawer-btn--solid'
    : 'btn empty-retry-btn';

  const links = [
    `<a class="${primaryClass}" href="${escapeHtml(homeHref)}">${escapeHtml(homeLabel)}</a>`,
  ];
  if (secondaryHref && secondaryLabel) {
    links.push(
      `<a class="${secondaryClass}" href="${escapeHtml(secondaryHref)}">${escapeHtml(secondaryLabel)}</a>`,
    );
  }

  const isAdmin = surface === 'admin';
  const inner = emptyState({
    icon: isAdmin ? undefined : 'map-pin-simple',
    iconHtml: isAdmin ? ADMIN_PIN_ICON : '',
    title,
    copy,
    ctaHtml: `<div class="empty-cta-row">${links.join('')}</div>`,
    variant: isAdmin ? 'admin' : 'panel',
    className: 'empty--not-found',
  });

  if (isAdmin) {
    return `<div class="admin-page"><div class="admin-surface admin-not-found">${inner}</div></div>`;
  }
  return inner;
}

/**
 * Bind Retry on an errorState root. Returns cleanup.
 * @param {ParentNode} root
 * @param {() => void | Promise<void>} onRetry
 */
export function bindEmptyRetry(root, onRetry) {
  const btn = root?.querySelector?.('[data-empty-retry]');
  if (!btn || typeof onRetry !== 'function') return () => {};
  const handler = (e) => {
    e.preventDefault();
    onRetry();
  };
  btn.addEventListener('click', handler);
  return () => btn.removeEventListener('click', handler);
}
