/**
 * Shared empty / error / not-found widgets for admin + mobile.
 */

import { escapeHtml } from '../lib/util.js';

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
 */
export function errorState(opts = {}) {
  const {
    title = 'Couldn’t load',
    copy = 'Check your connection and try again.',
    retryLabel = 'Retry',
    showRetry = true,
    variant = 'panel',
    className = '',
  } = opts;

  const ctaHtml = showRetry
    ? `<button type="button" class="empty-retry-btn" data-empty-retry>${escapeHtml(retryLabel)}</button>`
    : '';

  return emptyState({
    icon: 'warning-circle',
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

  const inner = emptyState({
    icon: 'map-pin-simple',
    title,
    copy,
    ctaHtml: `<div class="empty-cta-row">${links.join('')}</div>`,
    variant: surface === 'admin' ? 'admin' : 'panel',
    className: 'empty--not-found',
  });

  if (surface === 'admin') {
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
