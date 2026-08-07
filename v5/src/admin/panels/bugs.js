/**
 * Admin bug & feature reports — global list (bug_reports via DB.bugs).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { getDB } from '../../db.js';
import { openBugSheet, closeBugSheet, isBugSheetOpen } from '../../components/bug-sheet.js';
import { icon } from '../../lib/icons.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import {
  ADMIN_TABLE_FILTER,
  getTableFilterValues,
} from '../table-filter.js';
import { confirmDialog } from '../../components/modal.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';

export const BUG_REPORT_SAVED = 'bug-report-saved';

const SCREENSHOT_BUCKET = 'bug-screenshots';

function bugIsResolved(b) {
  return b.status === 'resolved' || b.status === 'wontfix';
}

function isMissingColErr(err, col) {
  const m = (err && err.message) || '';
  return m.includes('PGRST204') && m.includes(`'${col}'`);
}

function formatBugDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

function updateBugOpenDot(bugs) {
  const dot = $('bugOpenDot');
  if (!dot) return;
  const open = (bugs || []).filter((b) => !bugIsResolved(b)).length;
  dot.hidden = open === 0;
  dot.title = `${open} open report${open === 1 ? '' : 's'}`;
}

function guessAreaFromPage() {
  const title = ($('pageTitle')?.textContent || '').trim();
  if (!title || /^bug/i.test(title)) return '';
  return title.replace(/\s*·\s*.+$/, '').trim();
}

function renderScreenshotPreview(url) {
  const box = $('bugShotPreview');
  const img = $('bugShotImg');
  if (!box || !img) return;
  if (url) {
    img.src = url;
    box.hidden = false;
  } else {
    img.removeAttribute('src');
    box.hidden = true;
  }
}

async function captureAdminScreenshot() {
  const hide = [
    $('bugSheet'),
    $('bugReportFab'),
    $('toast'),
  ].filter(Boolean);

  const prev = hide.map((el) => el.style.visibility);
  hide.forEach((el) => { el.style.visibility = 'hidden'; });

  // Let the browser paint without the report UI.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const { toBlob } = await import('html-to-image');
    const blob = await toBlob(document.body, {
      cacheBust: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        const id = node.id || '';
        if (id === 'bugSheet' || id === 'bugReportFab' || id === 'toast') return false;
        return true;
      },
    });
    if (!blob) throw new Error('Screenshot failed');
    return blob;
  } finally {
    hide.forEach((el, i) => { el.style.visibility = prev[i] || ''; });
  }
}

async function uploadScreenshotBlob(blob) {
  const path = `bugs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const file = new File([blob], path.split('/').pop(), { type: 'image/png' });
  return getDB().uploadImage(SCREENSHOT_BUCKET, path, file);
}

/**
 * Open the new/edit report drawer from anywhere in admin (left side).
 * @param {{ bug?: object|null, area?: string, onSaved?: () => void|Promise<void> }} [opts]
 */
export function openBugReportForm(opts = {}) {
  const b = opts.bug || null;
  const type = b?.type === 'feature' ? 'feature' : 'bug';
  const sev = b?.severity || '';
  const areaPrefill = b ? (b.area || '') : (opts.area ?? guessAreaFromPage());

  /** @type {{ blob: Blob|null, url: string|null, revoke: string|null, removed: boolean }} */
  const shot = {
    blob: null,
    url: b?.screenshot_url || null,
    revoke: null,
    removed: false,
  };

  openBugSheet({
    title: b ? 'Edit report' : 'New report',
    bodyHtml: `
      <div class="admin-drawer-form">
        <div class="del-form-err" id="bugErr"></div>
        <div class="admin-field">
          <label class="admin-label" for="bugType">Type</label>
          <select class="admin-select" id="bugType">
            <option value="bug"${type === 'bug' ? ' selected' : ''}>Bug — something’s broken</option>
            <option value="feature"${type === 'feature' ? ' selected' : ''}>Feature request — something new</option>
          </select>
        </div>
        <div class="admin-field">
          <label class="admin-label" for="bugTitle">Title</label>
          <input class="admin-input" type="text" id="bugTitle" required
            placeholder="e.g. Closing stock total wrong when SOR % is blank">
        </div>
        <div class="admin-field-grid">
          <div class="admin-field">
            <label class="admin-label" for="bugArea">Area / Page</label>
            <input class="admin-input" type="text" id="bugArea" placeholder="e.g. Stock Counts">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="bugSeverity">Severity</label>
            <select class="admin-select" id="bugSeverity">
              <option value="">— none —</option>
              <option value="low"${sev === 'low' ? ' selected' : ''}>Low</option>
              <option value="medium"${sev === 'medium' ? ' selected' : ''}>Medium</option>
              <option value="high"${sev === 'high' ? ' selected' : ''}>High</option>
            </select>
          </div>
        </div>
        <div class="admin-field">
          <label class="admin-label" for="bugDesc">Details</label>
          <textarea class="admin-textarea" id="bugDesc" rows="4"
            placeholder="Steps to reproduce, what happened vs what you expected…"></textarea>
        </div>
        <div class="admin-field bug-shot">
          <span class="admin-label">Screenshot</span>
          <div class="bug-shot-actions">
            <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="bugShotCapture">
              ${icon('camera', { size: 16 })} Capture screen
            </button>
          </div>
          <div class="bug-shot-preview" id="bugShotPreview" hidden>
            <img id="bugShotImg" alt="Report screenshot">
            <button type="button" class="admin-drawer-btn admin-drawer-btn--solid btn-sm bug-shot-clear" id="bugShotClear">Remove</button>
          </div>
        </div>
      </div>`,
    footHtml: `
      <div class="admin-drawer-foot admin-drawer-foot--split">
        ${b ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="bugDelete">Delete</button>' : '<span></span>'}
        <div class="admin-drawer-foot-actions">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="bugCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="bugSave">${b ? 'Update report' : 'Add report'}</button>
        </div>
      </div>`,
    onClose: () => {
      if (shot.revoke) URL.revokeObjectURL(shot.revoke);
    },
  });

  if (b) {
    $('bugTitle').value = b.title || '';
    $('bugArea').value = b.area || '';
    $('bugDesc').value = b.description || '';
  } else if (areaPrefill) {
    $('bugArea').value = areaPrefill;
  }
  if (shot.url) renderScreenshotPreview(shot.url);

  async function captureShot() {
    const btn = $('bugShotCapture');
    const err = $('bugErr');
    if (err) err.textContent = '';
    btn.disabled = true;
    const prevLabel = btn.innerHTML;
    btn.textContent = 'Capturing…';
    try {
      const blob = await captureAdminScreenshot();
      if (shot.revoke) URL.revokeObjectURL(shot.revoke);
      const localUrl = URL.createObjectURL(blob);
      shot.blob = blob;
      shot.revoke = localUrl;
      shot.url = localUrl;
      shot.removed = false;
      renderScreenshotPreview(localUrl);
      toast('Screenshot attached');
    } catch (e) {
      if (err) err.textContent = e.message || 'Could not capture screenshot';
      toast(e.message || 'Screenshot failed', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = prevLabel;
    }
  }

  function clearShot() {
    if (shot.revoke) URL.revokeObjectURL(shot.revoke);
    shot.blob = null;
    shot.revoke = null;
    shot.url = null;
    shot.removed = true;
    renderScreenshotPreview(null);
  }

  async function deleteBug() {
    if (!b?.id) return;
    if (!(await confirmDialog({ title: 'Confirm', message: 'Delete this report? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await getDB().bugs.remove(b.id);
      closeBugSheet();
      document.dispatchEvent(new CustomEvent(BUG_REPORT_SAVED, { detail: { id: b.id, deleted: true } }));
      await opts.onSaved?.();
      toast('Report deleted');
      syncBugOpenDot();
    } catch (err) {
      toast(err.message || 'Delete failed', true);
    }
  }

  async function saveBug() {
    const title = ($('bugTitle')?.value || '').trim();
    if (!title) {
      $('bugErr').textContent = 'Please enter a title.';
      $('bugTitle')?.focus();
      return;
    }

    const patch = {
      type: $('bugType')?.value || 'bug',
      title,
      area: ($('bugArea')?.value || '').trim() || null,
      severity: ($('bugSeverity')?.value || '').trim() || null,
      description: ($('bugDesc')?.value || '').trim() || null,
    };

    const btn = $('bugSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      if (shot.blob) {
        btn.textContent = 'Uploading…';
        patch.screenshot_url = await uploadScreenshotBlob(shot.blob);
      } else if (shot.removed) {
        patch.screenshot_url = null;
      }

      const body = b?.id ? patch : { status: 'open', ...patch };
      const DB = getDB();
      const run = async (payload) => (
        b?.id ? DB.bugs.update(b.id, payload) : DB.bugs.create(payload)
      );

      try {
        await run(body);
      } catch (err) {
        // Drop unknown columns one at a time for older schemas.
        let payload = { ...body };
        let last = err;
        for (let i = 0; i < 3 && last; i++) {
          const col = ['screenshot_url', 'type'].find((c) => isMissingColErr(last, c));
          if (!col) break;
          delete payload[col];
          try {
            await run(payload);
            last = null;
          } catch (e2) {
            last = e2;
          }
        }
        if (last) throw last;
      }

      closeBugSheet();
      document.dispatchEvent(new CustomEvent(BUG_REPORT_SAVED, {
        detail: { id: b?.id || null, created: !b?.id },
      }));
      await opts.onSaved?.();
      toast(b?.id ? 'Report updated' : 'Report added');
      syncBugOpenDot();
    } catch (err) {
      $('bugErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = b?.id ? 'Update report' : 'Add report';
    }
  }

  $('bugCancel').onclick = closeBugSheet;
  $('bugSave').onclick = () => saveBug();
  $('bugShotCapture').onclick = () => captureShot();
  $('bugShotClear').onclick = () => clearShot();
  if (b) $('bugDelete').onclick = () => deleteBug();
  $('bugTitle')?.focus();
}

export function syncBugFabVisibility() {
  const wrap = $('bugReportFab');
  if (!wrap) return;
  wrap.hidden = !!$('bugsPanel') || isBugSheetOpen();
}

/**
 * Wire the sidebar bug report button (markup lives in admin.html).
 * Available on every admin page except Bugs / while the bug drawer is open.
 */
export function mountBugReportFab() {
  let wrap = $('bugReportFab');
  if (!wrap) {
    const footerRow = document.querySelector('.sidebar-footer-row');
    const footer = document.querySelector('.sidebar-footer');
    const sidebar = $('adminSidebar') || document.querySelector('.admin-sidebar');
    wrap = document.createElement('div');
    wrap.className = 'bug-fab';
    wrap.id = 'bugReportFab';
    wrap.innerHTML = `
      <button type="button" class="bug-fab-btn" id="bugReportFabBtn"
        title="Report a bug or idea" aria-label="Report a bug or idea">
        ${icon('bug', { size: 20, strokeWidth: 2 })}
      </button>`;
    if (footerRow) footerRow.prepend(wrap);
    else if (footer) footer.prepend(wrap);
    else (sidebar || document.body).appendChild(wrap);
  }

  const btn = $('bugReportFabBtn');
  if (!btn || btn.dataset.bugFabWired === '1') {
    syncBugFabVisibility();
    return () => {};
  }
  btn.dataset.bugFabWired = '1';

  const onClick = () => openBugReportForm();
  const onMut = () => requestAnimationFrame(syncBugFabVisibility);
  const onSheetToggle = () => syncBugFabVisibility();

  btn.addEventListener('click', onClick);
  document.addEventListener('bug-sheet-toggle', onSheetToggle);

  const content = $('adminContent');
  let mo = null;
  if (content) {
    mo = new MutationObserver(onMut);
    mo.observe(content, { childList: true });
  }

  syncBugFabVisibility();

  return () => {
    btn.removeEventListener('click', onClick);
    document.removeEventListener('bug-sheet-toggle', onSheetToggle);
    mo?.disconnect();
    delete btn.dataset.bugFabWired;
  };
}

export function renderBugsShell() {
  return `
    <div class="admin-page bugs-panel" id="bugsPanel">
      <p class="bugs-intro muted">Log anything broken or any idea for something new. Reports save to the cloud and are shared across every device.</p>
      <div class="dash-stats bugs-stats">
        <div class="dash-stat">
          <div class="dash-stat-label">Open</div>
          <div class="dash-stat-value" id="bugStatOpen">0</div>
          <div class="dash-stat-sub muted">Awaiting action</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-label">Resolved</div>
          <div class="dash-stat-value" id="bugStatResolved">0</div>
          <div class="dash-stat-sub muted">Done &amp; dusted</div>
        </div>
        <div class="dash-stat">
          <div class="dash-stat-label">Total</div>
          <div class="dash-stat-value" id="bugStatTotal">0</div>
          <div class="dash-stat-sub muted">All reports</div>
        </div>
      </div>
      <div class="admin-surface bugs-card">
        <div id="bugList"><div class="bug-list-empty">${loadingWidget('Loading reports…')}</div></div>
      </div>
    </div>`;
}

export function mountBugsPanel() {
  const panel = $('bugsPanel');
  if (!panel) return () => {};

  let bugs = [];
  let statusFilter = 'open';
  let typeFilter = 'all';
  let sortKey = 'date-desc';

  const seeded = getTableFilterValues('bugs');
  if (seeded) {
    statusFilter = seeded.status || 'open';
    typeFilter = seeded.type || 'all';
    sortKey = seeded.sort || 'date-desc';
  }

  function renderList() {
    const box = $('bugList');
    if (!box) return;

    const all = bugs.slice();
    const open = all.filter((b) => !bugIsResolved(b)).length;
    if ($('bugStatOpen')) $('bugStatOpen').textContent = String(open);
    if ($('bugStatResolved')) $('bugStatResolved').textContent = String(all.length - open);
    if ($('bugStatTotal')) $('bugStatTotal').textContent = String(all.length);
    updateBugOpenDot(all);

    let rows = all.filter((b) => {
      if (statusFilter === 'open') return !bugIsResolved(b);
      if (statusFilter === 'resolved') return bugIsResolved(b);
      return true;
    });
    if (typeFilter !== 'all') {
      rows = rows.filter((b) => (b.type || 'bug') === typeFilter);
    }

    const dir = sortKey === 'date-asc' ? 1 : -1;
    rows.sort((a, b) => {
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      return ta.localeCompare(tb) * dir;
    });

    if (!rows.length) {
      let msg = 'No reports yet — log the first one with “New report”.';
      if (statusFilter === 'open') msg = 'Nothing open right now. Nice work!';
      else if (statusFilter === 'resolved') msg = 'No resolved reports yet.';
      box.innerHTML = `<div class="bug-list-empty">${msg}</div>`;
      return;
    }

    box.innerHTML = rows.map((b) => {
      const resolved = bugIsResolved(b);
      const type = b.type === 'feature' ? 'feature' : 'bug';
      const typePill = `<span class="bug-pill type-${type}">${type === 'feature' ? 'Feature' : 'Bug'}</span>`;
      const sevPill = b.severity
        ? `<span class="bug-pill sev">${escapeHtml(b.severity)}</span>`
        : '';
      const areaPill = b.area
        ? `<span class="bug-pill">${escapeHtml(b.area)}</span>`
        : '';
      const created = formatBugDate(b.created_at);
      const meta = [
        typePill,
        sevPill,
        areaPill,
        created ? `<span>Logged ${escapeHtml(created)}</span>` : '',
      ].filter(Boolean).join('');
      const desc = b.description
        ? `<div class="bug-desc">${escapeHtml(b.description)}</div>`
        : '';
      const shot = b.screenshot_url
        ? `<a class="bug-row-shot" href="${escapeHtml(b.screenshot_url)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(b.screenshot_url)}" alt="Screenshot">
          </a>`
        : '';
      const toggleLabel = resolved ? 'Reopen' : 'Resolve';
      const toggleCls = resolved
        ? 'admin-drawer-btn admin-drawer-btn--solid'
        : 'admin-drawer-btn admin-drawer-btn--primary';
      return `
        <div class="bug-row${resolved ? ' resolved' : ''}" data-bug-id="${escapeHtml(b.id)}">
          <div class="bug-status-dot ${resolved ? 'resolved' : 'open'}" title="${resolved ? 'Resolved' : 'Open'}"></div>
          <div>
            <div class="bug-title">${escapeHtml(b.title)}</div>
            <div class="bug-meta">${meta}</div>
            ${desc}
            ${shot}
          </div>
          <div class="bug-actions">
            <button type="button" class="${toggleCls} btn-sm" data-bug-toggle>${toggleLabel}</button>
            <button type="button" class="admin-drawer-btn admin-drawer-btn--solid btn-sm" data-bug-edit>Edit</button>
          </div>
        </div>`;
    }).join('');
  }

  async function refresh() {
    bugs = (await getDB().bugs.list()) || [];
    renderList();
  }

  async function toggleStatus(id) {
    const b = bugs.find((x) => x.id === id);
    if (!b) return;
    try {
      const patch = bugIsResolved(b)
        ? { status: 'open', resolved_at: null }
        : { status: 'resolved', resolved_at: new Date().toISOString() };
      await getDB().bugs.update(id, patch);
      await refresh();
      toast(bugIsResolved(b) ? 'Report reopened' : 'Marked resolved');
    } catch (err) {
      toast(err.message || 'Could not update report', true);
    }
  }

  function openBugForm(editId) {
    const bug = editId ? bugs.find((x) => x.id === editId) : null;
    openBugReportForm({
      bug: bug || null,
      onSaved: refresh,
    });
  }

  function onPanelClick(e) {
    if (e.target.closest('.bug-row-shot')) return;
    const row = e.target.closest('[data-bug-id]');
    if (!row) return;
    const id = row.dataset.bugId;
    if (e.target.closest('[data-bug-toggle]')) {
      toggleStatus(id);
      return;
    }
    if (e.target.closest('[data-bug-edit]')) {
      openBugForm(id);
    }
  }

  const onToolbarAction = (e) => {
    if (e.detail?.action === 'new-bug-report') {
      e.detail.handled = true;
      openBugForm();
    }
  };

  const onSavedElsewhere = () => {
    refresh().catch(() => {});
  };

  const onTableFilter = (e) => {
    if (e.detail?.panel !== 'bugs') return;
    const values = e.detail?.values;
    if (!values) return;
    statusFilter = values.status || 'open';
    typeFilter = values.type || 'all';
    sortKey = values.sort || 'date-desc';
    renderList();
  };

  panel.addEventListener('click', onPanelClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(BUG_REPORT_SAVED, onSavedElsewhere);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);

  refresh().catch((err) => {
    const box = $('bugList');
    if (box) {
      reportError(err, { source: 'admin.bugs.load', silent: true });
      box.innerHTML = errorState({
        title: 'Couldn’t load reports',
        copy: err.message || 'Failed to load',
        variant: 'admin',
      });
      bindEmptyRetry(box, () => refresh());
    }
  });

  return () => {
    panel.removeEventListener('click', onPanelClick);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(BUG_REPORT_SAVED, onSavedElsewhere);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  };
}

/** Prefetch open-count badge for the sidebar (safe to call anytime). */
export async function syncBugOpenDot() {
  try {
    const rows = (await getDB().bugs.list()) || [];
    updateBugOpenDot(rows);
  } catch {
    /* ignore — badge is optional */
  }
}
