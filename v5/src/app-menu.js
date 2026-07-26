/**
 * Mobile top-left menu — left drawer with Settings and Bug reports.
 */

import { $, toast } from './lib/util.js';
import { getDB } from './db.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { mountSearchSelect } from './components/search-select.js';

/** @type {null | (() => void)} */
let onChangeLocation = null;
/** @type {null | (() => void)} */
let onDrawerOpen = null;

let closeTimer = null;

function drawerEl() {
  return $('appDrawer');
}

function setMenuBtnExpanded(open) {
  const btn = $('appMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function finishClose(drawer) {
  if (!drawer || drawer.hidden) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  drawer.hidden = true;
  drawer.classList.remove('is-open');
  document.body.classList.remove('app-drawer-open');
  setMenuBtnExpanded(false);
}

export function isAppDrawerOpen() {
  const drawer = drawerEl();
  return !!(drawer && !drawer.hidden && drawer.classList.contains('is-open'));
}

export function openAppDrawer() {
  const drawer = drawerEl();
  if (!drawer) return;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  onDrawerOpen?.();
  drawer.hidden = false;
  document.body.classList.add('app-drawer-open');
  setMenuBtnExpanded(true);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => drawer.classList.add('is-open'));
  });
}

export function closeAppDrawer() {
  const drawer = drawerEl();
  if (!drawer || drawer.hidden) return;

  if (!drawer.classList.contains('is-open')) {
    finishClose(drawer);
    return;
  }

  drawer.classList.remove('is-open');
  const onEnd = (e) => {
    if (e.target !== drawer.querySelector('.app-drawer-panel') || e.propertyName !== 'transform') return;
    drawer.removeEventListener('transitionend', onEnd);
    finishClose(drawer);
  };
  drawer.addEventListener('transitionend', onEnd);
  closeTimer = window.setTimeout(() => finishClose(drawer), 320);
}

function openSettingsSheet() {
  closeAppDrawer();
  openSheet({
    title: 'Settings',
    bodyHtml: `
      <div class="app-settings">
        <p class="app-settings-lead muted">Manage this device and your current location.</p>
        <button type="button" class="app-settings-row" id="settingsChangeLocation">
          <span class="app-settings-row-icon" aria-hidden="true"><i class="ph ph-map-pin"></i></span>
          <span class="app-settings-row-text">
            <span class="app-settings-row-title">Change location</span>
            <span class="app-settings-row-desc">Switch event or warehouse</span>
          </span>
          <i class="ph ph-caret-right app-settings-row-chev" aria-hidden="true"></i>
        </button>
      </div>`,
    footHtml: '',
  });

  $('settingsChangeLocation')?.addEventListener('click', () => {
    closeSheet();
    onChangeLocation?.();
  });
}

function openBugReportSheet() {
  closeAppDrawer();
  openSheet({
    title: 'Bug report',
    bodyHtml: `
      <div class="err" id="bugErr" hidden></div>
      <div class="field">
        <label for="bugTypeInput">Type</label>
        <div id="bugTypeMount"></div>
      </div>
      <div class="field">
        <label for="bugTitle">Title</label>
        <input type="text" id="bugTitle" required placeholder="Short summary of the issue">
      </div>
      <div class="field">
        <label for="bugArea">Area / Page</label>
        <input type="text" id="bugArea" placeholder="e.g. Counts, Deliveries, Kit">
      </div>
      <div class="field">
        <label for="bugSeverityInput">Severity</label>
        <div id="bugSeverityMount"></div>
      </div>
      <div class="field">
        <label for="bugDesc">Details</label>
        <textarea id="bugDesc" rows="4" placeholder="Steps to reproduce, what happened vs what you expected…"></textarea>
      </div>`,
    footHtml: `
      <div class="sheet-foot-row">
        <button type="button" class="btn" id="bugCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="bugSave">Send report</button>
      </div>`,
  });

  mountSearchSelect($('bugTypeMount'), {
    options: [
      { value: 'bug', label: 'Bug — something’s broken' },
      { value: 'feature', label: 'Feature request — something new' },
    ],
    value: 'bug',
    placeholder: 'Search type…',
    allowEmpty: false,
    hiddenId: 'bugType',
    inputId: 'bugTypeInput',
    inputClass: 'search-select-input',
  });

  mountSearchSelect($('bugSeverityMount'), {
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    value: '',
    placeholder: 'Search severity…',
    emptyLabel: '— none —',
    allowEmpty: true,
    hiddenId: 'bugSeverity',
    inputId: 'bugSeverityInput',
    inputClass: 'search-select-input',
  });

  const errEl = $('bugErr');
  const showErr = (msg) => {
    if (!errEl) return;
    if (!msg) {
      errEl.hidden = true;
      errEl.textContent = '';
      return;
    }
    errEl.hidden = false;
    errEl.textContent = msg;
  };

  $('bugCancel')?.addEventListener('click', closeSheet);
  $('bugSave')?.addEventListener('click', async () => {
    const title = ($('bugTitle')?.value || '').trim();
    if (!title) {
      showErr('Title is required');
      $('bugTitle')?.focus();
      return;
    }
    showErr('');

    const payload = {
      status: 'open',
      type: ($('bugType')?.value || 'bug').trim() || 'bug',
      title,
      area: ($('bugArea')?.value || '').trim() || null,
      severity: ($('bugSeverity')?.value || '').trim() || null,
      description: ($('bugDesc')?.value || '').trim() || null,
    };

    const btn = $('bugSave');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }

    try {
      const DB = getDB();
      try {
        await DB.bugs.create(payload);
      } catch (err) {
        // Older schemas may lack type / screenshot_url columns.
        let body = { ...payload };
        let last = err;
        for (const col of ['type', 'screenshot_url']) {
          if (!last) break;
          const msg = String(last?.message || last || '');
          if (!msg.includes(col)) continue;
          delete body[col];
          try {
            await DB.bugs.create(body);
            last = null;
          } catch (e2) {
            last = e2;
          }
        }
        if (last) throw last;
      }
      closeSheet();
      toast('Report sent — thanks');
    } catch (err) {
      showErr(err.message || 'Could not send report');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send report';
      }
    }
  });

  $('bugTitle')?.focus();
}

/**
 * @param {{ onChangeLocation?: () => void, onOpen?: () => void }} [opts]
 */
export function initAppMenu(opts = {}) {
  onChangeLocation = opts.onChangeLocation || null;
  onDrawerOpen = opts.onOpen || null;

  $('appMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isAppDrawerOpen()) closeAppDrawer();
    else openAppDrawer();
  });
  $('appDrawerClose')?.addEventListener('click', closeAppDrawer);
  $('appDrawerBackdrop')?.addEventListener('click', closeAppDrawer);

  document.querySelectorAll('[data-app-menu]').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.getAttribute('data-app-menu');
      if (action === 'settings') openSettingsSheet();
      else if (action === 'bugs') openBugReportSheet();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isAppDrawerOpen()) closeAppDrawer();
  });
}
