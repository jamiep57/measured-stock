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

export function syncChromeSizes() {
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
    // Tab row only (safe-area strip is a sibling).
    const row = nav.querySelector('.bottomnav-inner') || nav;
    const h = Math.ceil(row.getBoundingClientRect().height || row.offsetHeight || 0);
    document.documentElement.style.setProperty('--nav-h', `${h}px`);
  }
}
