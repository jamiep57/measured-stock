/**
 * Admin sidebar — workspace switcher and collapsible sections.
 */

import { escapeHtml } from '../lib/util.js';
import { initIcons } from '../lib/icons.js';
import { navigate, hrefForRoute } from './router.js';
import { resolveActiveEventId } from './event-workspace.js';

const SECTION_STORAGE_KEY = 'v5-admin-sidebar-sections';

function readSectionState() {
  try {
    return JSON.parse(localStorage.getItem(SECTION_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeSectionState(state) {
  try {
    localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function renderWorkspaceMenu(events, rememberedEventId) {
  const menu = document.getElementById('sidebarWorkspaceMenu');
  if (!menu) return;

  const items = [
    `<button type="button" class="sidebar-workspace-item${!rememberedEventId ? ' is-active' : ''}" data-workspace="home">
      <span class="sidebar-workspace-item-name">All events</span>
      <span class="sidebar-workspace-item-sub">Measured Stock Admin</span>
    </button>`,
    ...events.map((event) => {
      const active = rememberedEventId === event.id;
      return `<button type="button" class="sidebar-workspace-item${active ? ' is-active' : ''}" data-workspace="event" data-event-id="${escapeHtml(event.id)}">
        <span class="sidebar-workspace-item-name">${escapeHtml(event.name)}</span>
        <span class="sidebar-workspace-item-sub">${escapeHtml(event.status || 'Event')}</span>
      </button>`;
    }),
  ];

  menu.innerHTML = items.join('');
}

const DEFAULT_WORKSPACE_MARK = '/assets/img/logomark.png';

function setWorkspaceMark(imageUrl) {
  const mark = document.getElementById('sidebarWorkspaceMark');
  const img = document.getElementById('sidebarWorkspaceMarkImg');
  if (!mark || !img) return;

  const custom = Boolean(imageUrl);
  mark.classList.toggle('has-event-image', custom);
  img.src = custom ? imageUrl : DEFAULT_WORKSPACE_MARK;
}

function updateWorkspaceHeader(route, state) {
  const nameEl = document.getElementById('sidebarWorkspaceName');
  const subEl = document.getElementById('sidebarWorkspaceSub');
  if (!nameEl || !subEl) return;

  const eventId = resolveActiveEventId(route, state);
  if (eventId) {
    const event = state.events.find((e) => e.id === eventId);
    nameEl.textContent = event?.name || 'Event';
    subEl.textContent = 'Event workspace';
    setWorkspaceMark(event?.image_url || null);
    return;
  }

  nameEl.textContent = 'Measured Stock';
  subEl.textContent = 'Admin';
  setWorkspaceMark(null);
}

function setWorkspaceMenuOpen(open) {
  const btn = document.getElementById('sidebarWorkspace');
  const menu = document.getElementById('sidebarWorkspaceMenu');
  if (!btn || !menu) return;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  menu.hidden = !open;
}

function setSectionOpen(sectionEl, open, { persist = true } = {}) {
  if (!sectionEl) return;
  const key = sectionEl.dataset.section;
  const toggle = sectionEl.querySelector('.sidebar-section-toggle');
  const body = sectionEl.querySelector('.sidebar-section-body');
  sectionEl.classList.toggle('is-collapsed', !open);
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (body) body.hidden = !open;

  if (persist && key) {
    const saved = readSectionState();
    saved[key] = open;
    writeSectionState(saved);
  }
}

function initSections() {
  const saved = readSectionState();
  document.querySelectorAll('.sidebar-section[data-section]').forEach((section) => {
    const key = section.dataset.section;
    const defaultOpen = key !== 'sales';
    const open = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : defaultOpen;
    setSectionOpen(section, open, { persist: false });
  });
}

function wireSections(onNavigate) {
  document.querySelectorAll('.sidebar-section-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const section = toggle.closest('.sidebar-section');
      const open = section?.classList.contains('is-collapsed');
      setSectionOpen(section, open);

      // Section headers with data-nav-panel open that panel (Reports header ≠ expand-only).
      const panel = toggle.dataset.navPanel;
      if (panel && typeof onNavigate === 'function') {
        onNavigate({ panel });
      }
    });
  });
}

function wireWorkspace(onNavigate) {
  const btn = document.getElementById('sidebarWorkspace');
  const menu = document.getElementById('sidebarWorkspaceMenu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setWorkspaceMenuOpen(menu.hidden);
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-workspace]');
    if (!item) return;
    setWorkspaceMenuOpen(false);

    if (item.dataset.workspace === 'home') {
      navigate({ view: 'home' });
      onNavigate({ clearEvent: true });
      return;
    }

    const eventId = item.dataset.eventId;
    if (eventId) {
      navigate({ view: 'event', eventId, panel: 'dashboard' });
      onNavigate();
    }
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#sidebarWorkspace, #sidebarWorkspaceMenu')) {
      setWorkspaceMenuOpen(false);
    }
  });
}

/** Ensure Reports exists even if a cached admin.html predates the nav link. */
function ensureReportsNavLink() {
  const reportsSection = document.querySelector('.sidebar-section[data-section="event-reports"]');
  const reportsToggle = reportsSection?.querySelector('.sidebar-section-toggle');
  if (reportsToggle && !reportsToggle.dataset.navPanel) {
    reportsToggle.dataset.navPanel = 'reports';
  }

  const nav = document.getElementById('sidebarEventReports')
    || document.getElementById('sidebarEventSales');
  if (!nav) return;
  if (nav.querySelector('[data-route="reports"]')) return;

  const summary = nav.querySelector('[data-route="summary"]');
  if (summary) {
    summary.dataset.route = 'reports';
    summary.innerHTML = '<i data-lucide="pie-chart"></i> Reports';
    return;
  }

  const link = document.createElement('a');
  link.className = 'nav-link';
  link.dataset.route = 'reports';
  link.dataset.event = '';
  link.innerHTML = '<i data-lucide="pie-chart"></i> Reports';
  nav.insertBefore(link, nav.firstChild);
}

export function initSidebar(onNavigate) {
  ensureReportsNavLink();
  initSections();
  wireSections(onNavigate);
  wireWorkspace(onNavigate);
}

export function syncSidebar(route, state) {
  ensureReportsNavLink();

  const eventId = resolveActiveEventId(route, state);
  updateWorkspaceHeader(route, state);
  renderWorkspaceMenu(state.events, eventId);

  const eventSections = document.querySelectorAll('.sidebar-section[data-section^="event-"]');
  const showEvent = Boolean(eventId);
  eventSections.forEach((section) => {
    section.hidden = !showEvent;
  });

  const catalogDashboard = document.getElementById('sidebarCatalogDashboard');
  if (catalogDashboard) catalogDashboard.hidden = !showEvent;

  const eventKitLink = document.getElementById('sidebarEventKitLink');
  if (eventKitLink) eventKitLink.hidden = !showEvent;

  document.querySelectorAll('.nav-link[data-event], .nav-link-cog[data-event]').forEach((el) => {
    if (showEvent && eventId) {
      el.href = hrefForRoute({ view: 'event', eventId, panel: el.dataset.route });
    }
  });

  initIcons(document.getElementById('adminSidebar'));
}
