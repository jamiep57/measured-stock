/**
 * Admin sidebar — workspace switcher and collapsible sections.
 */

import { escapeHtml, toast } from '../lib/util.js';
import { initIcons } from '../lib/icons.js';
import { navigate, hrefForRoute } from './router.js';
import { resolveActiveEventId } from './event-workspace.js';
import {
  listOrganisations,
  getActiveOrganisation,
  isOrgAdmin,
  canSwitchOrganisation,
  switchOrganisation,
  createOrganisation,
} from '../lib/organisations.js';
import { openModal, closeModal } from '../components/modal.js';
import { can, canOpenDev, canOpenSettings, firstSettingsSection, roleLabel } from '../lib/permissions.js';

const SECTION_STORAGE_KEY = 'v5-admin-sidebar-sections';
const DEFAULT_WORKSPACE_MARK = '/assets/img/logomark.png';

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

function workspaceItemMark(imageUrl) {
  const custom = Boolean(imageUrl);
  return `<span class="sidebar-workspace-item-mark${custom ? ' has-event-image' : ''}" aria-hidden="true">
      <img src="${escapeHtml(custom ? imageUrl : DEFAULT_WORKSPACE_MARK)}" alt="">
    </span>`;
}

function renderOrganisationItems() {
  const orgs = listOrganisations();
  const active = getActiveOrganisation();
  const admin = isOrgAdmin();
  if (orgs.length <= 1 && !admin) return [];
  return [
    '<div class="sidebar-workspace-divider" role="separator"></div>',
    '<div class="sidebar-workspace-heading">Organisations</div>',
    ...orgs.map((org) => `<button type="button" class="sidebar-workspace-item${org.id === active?.id ? ' is-active' : ''}" data-org-id="${escapeHtml(org.id)}">
        <span class="sidebar-workspace-item-mark sidebar-workspace-item-mark--org" aria-hidden="true"><i data-lucide="building-2"></i></span>
        <span class="sidebar-workspace-item-text">
          <span class="sidebar-workspace-item-name">${escapeHtml(org.name)}</span>
          <span class="sidebar-workspace-item-sub">${escapeHtml(roleLabel(org.role))}</span>
        </span>
      </button>`),
    admin
      ? `<button type="button" class="sidebar-workspace-item" data-org-create>
          <span class="sidebar-workspace-item-mark sidebar-workspace-item-mark--org" aria-hidden="true"><i data-lucide="plus"></i></span>
          <span class="sidebar-workspace-item-text"><span class="sidebar-workspace-item-name">New organisation</span></span>
        </button>`
      : '',
  ];
}

function openCreateOrganisationModal() {
  const el = openModal({
    title: 'New organisation',
    bodyHtml: `<label class="admin-field">
        <span class="admin-label">Name</span>
        <input type="text" class="admin-input" data-org-name maxlength="80" autocomplete="off" />
      </label>
      <p class="muted" style="font-size:12px;margin-top:8px">Organisations have separate products, events, suppliers and users. You will be its admin.</p>`,
    footHtml: `<div class="admin-modal-confirm-foot">
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-save>Create</button>
      </div>`,
  });
  const input = el?.querySelector('[data-org-name]');
  requestAnimationFrame(() => input?.focus());
  el?.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
  el?.querySelector('[data-save]')?.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
    const name = input?.value.trim();
    if (!name) {
      input?.focus();
      return;
    }
    btn.disabled = true;
    try {
      const org = await createOrganisation(name);
      const created = Array.isArray(org) ? org[0] : org;
      closeModal();
      if (created?.id) await switchOrganisation(created.id);
    } catch (err) {
      btn.disabled = false;
      toast(String(err?.message || err), true);
    }
  });
}

async function handleOrganisationSwitch(orgId) {
  if (orgId === getActiveOrganisation()?.id) return;
  if (!(await canSwitchOrganisation())) {
    toast('Sync pending changes before switching organisation', true);
    return;
  }
  try {
    await switchOrganisation(orgId);
  } catch (err) {
    toast(String(err?.message || err), true);
  }
}

function renderWorkspaceMenu(events, rememberedEventId) {
  const menu = document.getElementById('sidebarWorkspaceMenu');
  if (!menu) return;

  const orgName = getActiveOrganisation()?.name || 'Measured Stock Admin';
  const items = [
    `<button type="button" class="sidebar-workspace-item${!rememberedEventId ? ' is-active' : ''}" data-workspace="home">
      ${workspaceItemMark(null)}
      <span class="sidebar-workspace-item-text">
        <span class="sidebar-workspace-item-name">All events</span>
        <span class="sidebar-workspace-item-sub">${escapeHtml(orgName)}</span>
      </span>
    </button>`,
    ...events.map((event) => {
      const active = rememberedEventId === event.id;
      return `<button type="button" class="sidebar-workspace-item${active ? ' is-active' : ''}" data-workspace="event" data-event-id="${escapeHtml(event.id)}">
        ${workspaceItemMark(event.image_url || null)}
        <span class="sidebar-workspace-item-text">
          <span class="sidebar-workspace-item-name">${escapeHtml(event.name)}</span>
          <span class="sidebar-workspace-item-sub">${escapeHtml(event.status || 'Event')}</span>
        </span>
      </button>`;
    }),
    ...renderOrganisationItems(),
  ];

  menu.innerHTML = items.join('');
  initIcons(menu);
}

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
  subEl.textContent = getActiveOrganisation()?.name || 'Admin';
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
    const orgItem = e.target.closest('[data-org-id]');
    if (orgItem) {
      setWorkspaceMenuOpen(false);
      handleOrganisationSwitch(orgItem.dataset.orgId);
      return;
    }
    if (e.target.closest('[data-org-create]')) {
      setWorkspaceMenuOpen(false);
      openCreateOrganisationModal();
      return;
    }
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
  lastEventVisible = showEvent;
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

  applyNavPermissions();
  initIcons(document.getElementById('adminSidebar'));
}

let lastEventVisible = false;

/** Hide nav links the signed-in role cannot open. */
export function applyNavPermissions() {
  document.querySelectorAll('[data-feature]').forEach((el) => {
    const allowed = can(el.dataset.feature);
    if (!allowed) {
      el.hidden = true;
      return;
    }
    if (el.hasAttribute('data-event')) {
      el.hidden = !lastEventVisible;
      return;
    }
    el.hidden = false;
  });

  document.querySelectorAll('.nav-link-row').forEach((row) => {
    const bits = [...row.querySelectorAll('[data-feature]')];
    if (!bits.length) return;
    row.hidden = bits.every((el) => el.hidden);
  });

  document.querySelectorAll('.sidebar-section').forEach((section) => {
    const links = [...section.querySelectorAll('[data-feature]')];
    if (!links.length) return;
    const anyVisible = links.some((el) => !el.hidden);
    if (section.dataset.section?.startsWith('event-')) {
      if (lastEventVisible) section.hidden = !anyVisible;
    } else {
      section.hidden = !anyVisible;
    }
  });

  const settings = document.querySelector('[data-profile-action="settings"]');
  if (settings) {
    const section = firstSettingsSection();
    settings.hidden = !canOpenSettings();
    if (section) settings.setAttribute('href', hrefForRoute({ view: 'settings', section }));
  }
  const dev = document.querySelector('[data-dev-tools]');
  if (dev) dev.hidden = !canOpenDev();
}
