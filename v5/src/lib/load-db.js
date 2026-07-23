/**
 * Load assets/js/db.js before any DB access (dev + prod safe paths).
 */
export function loadDbScript() {
  if (typeof window.DB !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/assets/js/db.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load /assets/js/db.js'));
    document.head.appendChild(s);
  });
}
