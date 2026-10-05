/**
 * Dev tools home — Audit + Bugs, off the main admin nav.
 */

import { escapeHtml } from '../../lib/util.js';
import { hrefForRoute } from '../router.js';
import { resolveActiveEventId } from '../event-workspace.js';
import { can } from '../../lib/permissions.js';

export function renderDevShell(state = {}) {
  const eventId = resolveActiveEventId({ view: 'dev' }, state);
  const event = eventId
    ? (state.events || []).find((e) => e.id === eventId)
    : null;

  const auditHref = eventId
    ? hrefForRoute({ view: 'audit', eventId })
    : hrefForRoute({ view: 'home' });
  const auditMeta = event
    ? `Run against ${event.name}`
    : 'Pick an event workspace first';

  const cards = [
    can('dev.bugs') ? `<a class="event-card" href="${escapeHtml(hrefForRoute({ view: 'bugs' }))}">
          <div class="event-card-name">Bug &amp; feature reports</div>
          <div class="event-card-meta">Open the shared report inbox →</div>
        </a>` : '',
    can('dev.audit') ? `<a class="event-card${eventId ? '' : ' event-card--muted'}" href="${escapeHtml(auditHref)}">
          <div class="event-card-name">Forensic audit</div>
          <div class="event-card-meta">${escapeHtml(auditMeta)} — dual-writes, formula drift, sync →</div>
        </a>` : '',
    can('dev.backup') ? `<a class="event-card" href="${escapeHtml(hrefForRoute({ view: 'backup' }))}">
          <div class="event-card-name">Backup</div>
          <div class="event-card-meta">Database backups for this organisation →</div>
        </a>` : '',
  ].filter(Boolean);

  return `
    <div class="admin-page home-page dev-page">
      <div class="home-toolbar">
        <p class="home-lead muted">Developer tools — software integrity, bug reports and backups, kept off the main nav.</p>
      </div>
      <div class="event-grid">
        ${cards.join('') || '<p class="muted">No developer tools are enabled for your role.</p>'}
      </div>
    </div>`;
}

export function renderBackupShell() {
  return `
    <div class="admin-page">
      <div class="admin-surface access-backup">
        <h2>Backup</h2>
        <p class="muted">Database backups are kept with Supabase point-in-time recovery. Restores are run from the Supabase project by a sysadmin, not from inside the app.</p>
      </div>
    </div>`;
}

export function mountDevPanel() {
  return () => {};
}
