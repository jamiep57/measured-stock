/**
 * Dev tools home — Audit + Bugs, off the main admin nav.
 */

import { escapeHtml } from '../../lib/util.js';
import { hrefForRoute } from '../router.js';
import { resolveActiveEventId } from '../event-workspace.js';

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

  return `
    <div class="admin-page home-page dev-page">
      <div class="home-toolbar">
        <p class="home-lead muted">Developer tools — forensic audit and bug reports, kept off the main nav.</p>
      </div>
      <div class="event-grid">
        <a class="event-card" href="${escapeHtml(hrefForRoute({ view: 'bugs' }))}">
          <div class="event-card-name">Bug &amp; feature reports</div>
          <div class="event-card-meta">Open the shared report inbox →</div>
        </a>
        <a class="event-card${eventId ? '' : ' event-card--muted'}" href="${escapeHtml(auditHref)}">
          <div class="event-card-name">Forensic audit</div>
          <div class="event-card-meta">${escapeHtml(auditMeta)} →</div>
        </a>
      </div>
    </div>`;
}

export function mountDevPanel() {
  return () => {};
}
