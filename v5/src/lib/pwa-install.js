/**
 * Lightweight install prompt for Kit Count PWA.
 * Chromium: uses beforeinstallprompt. iOS: one-time Add to Home Screen tip.
 */

const DISMISS_KEY = 'kit-count-pwa-banner-dismissed';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ensureStyles() {
  if (document.getElementById('kc-pwa-styles')) return;
  const style = document.createElement('style');
  style.id = 'kc-pwa-styles';
  style.textContent = `
    .kc-pwa-banner {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      z-index: 80;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 14px;
      background: #1a1d24;
      border: 1px solid #2a2f3a;
      box-shadow: 0 12px 40px rgba(0,0,0,.45);
      color: #f4f4f5;
      font: 500 13px/1.35 Outfit, system-ui, sans-serif;
    }
    .kc-pwa-banner p { margin: 0; flex: 1; }
    .kc-pwa-banner button {
      flex-shrink: 0;
      height: 36px;
      padding: 0 12px;
      border-radius: 10px;
      border: 0;
      font: 600 13px Outfit, system-ui, sans-serif;
      cursor: pointer;
    }
    .kc-pwa-install { background: #e8c47c; color: #1a1208; }
    .kc-pwa-dismiss { background: transparent; color: #a1a1aa; padding: 0 8px; }
  `;
  document.head.appendChild(style);
}

function mountBanner({ text, primaryLabel, onPrimary }) {
  ensureStyles();
  document.getElementById('kcPwaBanner')?.remove();
  const el = document.createElement('div');
  el.id = 'kcPwaBanner';
  el.className = 'kc-pwa-banner';
  el.innerHTML = `
    <p>${text}</p>
    ${primaryLabel ? `<button type="button" class="kc-pwa-install" id="kcPwaInstall">${primaryLabel}</button>` : ''}
    <button type="button" class="kc-pwa-dismiss" id="kcPwaDismiss" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(el);
  el.querySelector('#kcPwaDismiss').onclick = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    el.remove();
  };
  const installBtn = el.querySelector('#kcPwaInstall');
  if (installBtn && onPrimary) {
    installBtn.onclick = () => onPrimary(el);
  }
}

/**
 * Call once on the kit-count / scan page.
 */
export function setupKitCountPwaInstall() {
  if (isStandalone()) return;
  if (localStorage.getItem(DISMISS_KEY) === '1') return;

  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    mountBanner({
      text: 'Install Kit Count on your home screen for quick access.',
      primaryLabel: 'Install',
      onPrimary: async (el) => {
        if (!deferred) return;
        deferred.prompt();
        try {
          await deferred.userChoice;
        } catch { /* ignore */ }
        deferred = null;
        localStorage.setItem(DISMISS_KEY, '1');
        el.remove();
      },
    });
  });

  if (isIos()) {
    window.setTimeout(() => {
      if (document.getElementById('kcPwaBanner')) return;
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
      mountBanner({
        text: 'Add to Home Screen: tap Share, then “Add to Home Screen”.',
        primaryLabel: null,
        onPrimary: null,
      });
    }, 1400);
  }
}
