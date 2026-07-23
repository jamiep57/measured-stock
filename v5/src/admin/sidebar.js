/**
 * Admin sidebar — workspace switcher and collapsible sections.
 */

import { escapeHtml } from '../lib/util.js';
import { initIcons } from '../lib/icons.js';
import { navigate, hrefForRoute } from './router.js';

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

function renderWorkspaceMenu(events, route) {
  const menu = document.getElementById('sidebarWorkspaceMenu');
  if (!menu) return;

  const items = [
    `<button type="button" class="sidebar-workspace-item${route.view === 'home' ? ' is-active' : ''}" data-workspace="home">
      <span class="sidebar-workspace-item-name">All events</span>
      <span class="sidebar-workspace-item-sub">Measured Stock Admin</span>
    </button>`,
    ...events.map((event) => {
      const active = route.view === 'event' && route.eventId === event.id;
      return `<button type="button" class="sidebar-workspace-item${active ? ' is-active' : ''}" data-workspace="event" data-event-id="${escapeHtml(event.id)}">
        <span class="sidebar-workspace-item-name">${escapeHtml(event.name)}</span>
        <span class="sidebar-workspace-item-sub">${escapeHtml(event.status || 'Event')}</span>
      </button>`;
    }),
  ];

  menu.innerHTML = items.join('');
}

function updateWorkspaceHeader(route, state) {
  const nameEl = document.getElementById('sidebarWorkspaceName');
  const subEl = document.getElementById('sidebarWorkspaceSub');
  if (!nameEl || !subEl) return;

  if (route.view === 'event' && route.eventId) {
    const event = state.events.find((e) => e.id === route.eventId);
    nameEl.textContent = event?.name || 'Event';
    subEl.textContent = 'Event workspace';
    return;
  }

  nameEl.textContent = 'Measured Stock';
  subEl.textContent = 'Admin';
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

function wireSections() {
  document.querySelectorAll('.sidebar-section-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const section = toggle.closest('.sidebar-section');
      const open = section?.classList.contains('is-collapsed');
      setSectionOpen(section, open);
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
      onNavigate();
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

export function initSidebar(onNavigate) {
  initSections();
  wireSections();
  wireWorkspace(onNavigate);
}

export function syncSidebar(route, state) {
  updateWorkspaceHeader(route, state);
  renderWorkspaceMenu(state.events, route);

  const eventSections = document.querySelectorAll('.sidebar-section[data-section^="event-"]');
  const showEvent = route.view === 'event' && route.eventId;
  eventSections.forEach((section) => {
    section.hidden = !showEvent;
  });

  document.querySelectorAll('.nav-link[data-event], .nav-link-cog[data-event]').forEach((el) => {
    if (showEvent && route.eventId) {
      el.href = hrefForRoute({ view: 'event', eventId: route.eventId, panel: el.dataset.route });
    }
  });

  initIcons(document.getElementById('adminSidebar'));
}
