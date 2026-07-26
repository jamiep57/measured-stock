export function $(id) {
  return document.getElementById(id);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function rid(prefix = 'x') {
  return prefix + Math.random().toString(36).slice(2, 8);
}

let toastTimer;
export function toast(msg, isErr = false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast' + (isErr ? ' err' : '');
  }, 2600);
}

export function nowLocalInput() {
  const now = new Date();
  return new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `£${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

export function isBoneYard(bar) {
  if (!bar?.name) return false;
  return bar.name.toLowerCase().replace(/[^a-z]/g, '') === 'boneyard';
}

export const V5_VERSION = '5.0.0';

function isStandalonePwa() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * iOS standalone reports a “lying” viewport shorter than the physical screen
 * (WebKit), and env(safe-area-inset-bottom) is often 0. Measure the dead zone
 * so the tab bar can extend into it.
 */
export function syncIosBottomGap() {
  let gap = 0;
  if (isStandalonePwa()) {
    gap = Math.max(0, Math.round(window.screen.height - window.innerHeight));
  }
  document.documentElement.style.setProperty('--ios-bottom-gap', `${gap}px`);
  return gap;
}

/**
 * Pin the tab bar flush with the physical bottom (including iOS dead zone).
 */
export function pinBottomNav() {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;

  const gap = syncIosBottomGap();

  nav.style.setProperty('position', 'fixed', 'important');
  nav.style.setProperty('left', '0px', 'important');
  nav.style.setProperty('right', '0px', 'important');
  nav.style.setProperty('bottom', `${-gap}px`, 'important');
  nav.style.setProperty('transform', 'none', 'important');
  nav.style.setProperty('width', '100%', 'important');
  nav.style.setProperty('margin', '0', 'important');
  nav.style.setProperty('border-radius', '0', 'important');
  nav.style.setProperty(
    'padding-bottom',
    `max(${gap}px, env(safe-area-inset-bottom, 0px))`,
    'important',
  );
}

export function syncChromeSizes() {
  pinBottomNav();
  const tb = document.querySelector('.topbar');
  const nav = document.querySelector('.bottomnav');
  const hideNav = document.documentElement.classList.contains('counting')
    || document.documentElement.classList.contains('kit-deep')
    || !document.documentElement.classList.contains('app-ready');
  if (tb && getComputedStyle(tb).display !== 'none' && getComputedStyle(tb).visibility !== 'hidden') {
    document.documentElement.style.setProperty('--header-h', tb.offsetHeight + 'px');
  } else if (document.documentElement.classList.contains('kit-deep')) {
    document.documentElement.style.setProperty('--header-h', '0px');
  }
  if (hideNav || !nav) {
    document.documentElement.style.setProperty('--nav-h', '0px');
  } else {
    // Height within the layout viewport (icons + pad that sits above the dead zone).
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ios-bottom-gap')) || 0;
    const full = Math.ceil(nav.getBoundingClientRect().height || nav.offsetHeight || 0);
    // FAB / main padding should clear the visible bar, not the part pulled below the lying viewport.
    const visible = Math.max(0, full - gap);
    document.documentElement.style.setProperty('--nav-h', `${visible || full}px`);
  }
}
