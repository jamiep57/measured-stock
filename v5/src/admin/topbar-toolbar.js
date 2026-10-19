/**
 * Admin topbar toolbar — disconnected icon strips + filter/search on the right.
 */

import { $, escapeHtml, toast } from '../lib/util.js';
import { icon, initIcons } from '../lib/icons.js';
import { hasTableFilter } from './table-filter.js';
import { refreshFieldUndoButtons } from '../lib/field-undo.js';

export const ADMIN_TOOLBAR_ACTION = 'admin-toolbar-action';

/** @typedef {{ id: string, icon?: string, title?: string, label?: string, primary?: boolean, disabled?: boolean, kind?: 'button' | 'text' | 'menu' | 'divider', items?: ToolbarItem[] }} ToolbarItem */
/** @typedef {{ id: string, label: string, items: ToolbarItem[] }} ToolbarStrip */

/** @type {{ syncRoute: (route: object) => void, setStrips: (strips: ToolbarStrip[] | null) => void, paint: () => void }} */
let toolbarController = {
  syncRoute() {},
  setStrips() {},
  paint() {},
};

/** Hide the plan-vs-ordered filter while another workspace on the same route is open. */
let filterSuppressed = false;

/**
 * @param {boolean} suppressed
 * @param {{ paint?: boolean }} [opts]
 */
export function setTopbarFilterSuppressed(suppressed, { paint = true } = {}) {
  filterSuppressed = Boolean(suppressed);
  if (filterSuppressed) {
    const dropdown = $('topbarTableFilterPanel');
    if (dropdown) dropdown.hidden = true;
    $('topbarTableFilterBtn')?.setAttribute('aria-expanded', 'false');
  }
  if (paint) toolbarController.paint();
}

/**
 * Temporarily replace the current panel’s topbar strips (e.g. library merge mode).
 * Pass null to restore the route’s default strips.
 * @param {ToolbarStrip[] | null} strips
 */
export function setTopbarToolbarStrips(strips) {
  toolbarController.setStrips(strips);
}

/** Per-panel strips (left of filter/search on distribution). */
export const PANEL_TOOLBAR = {
  distribution: [
    {
      id: 'actions',
      label: 'Distribution',
      items: [
        {
          id: 'square-menu-sync',
          icon: 'square',
          label: 'Sync to Square',
          title: 'Preview and push this menu to Square, with each bar’s till showing what is distributed to it',
        },
      ],
    },
  ],
  planning: [
    {
      id: 'actions',
      label: 'Menu',
      items: [
        {
          id: 'plan-save-menu',
          icon: 'save',
          title: 'Save menu',
          primary: true,
        },
        {
          id: 'plan-apply-menu',
          icon: 'folder',
          title: 'Load a saved menu onto this event',
        },
        {
          id: 'plan-add',
          kind: 'menu',
          icon: 'plus',
          label: 'Add',
          title: 'Add a product, a recipe, or a pricing scenario',
          items: [
            {
              id: 'plan-add-product',
              icon: 'plus',
              label: 'Add product',
              title: 'Search the library or create a product and add it to this menu',
            },
            {
              id: 'plan-recipe-builder',
              icon: 'martini',
              label: 'Recipe builder',
              title: 'Build a cocktail or a spirit and mixer, sold as one drink and costed from its stock products',
            },
            {
              id: 'plan-add-scenario',
              icon: 'target',
              label: 'Scenario',
              title: 'Add a pricing scenario column',
            },
          ],
        },
        {
          id: 'plan-export',
          icon: 'download',
          label: 'Export',
          title: 'Designer menu, client pack or schedule of rates',
        },
        {
          id: 'square-menu-sync',
          icon: 'square',
          label: 'Sync to Square',
          title: 'Preview and push this menu and its prices to Square',
        },
        { id: 'plan-after-sync', kind: 'divider' },
        {
          id: 'plan-settings',
          icon: 'settings',
          title: 'Menu settings',
        },
      ],
    },
  ],
  orders: [
    {
      id: 'actions',
      label: 'Orders',
      items: [
        {
          id: 'orders-generate',
          icon: 'sparkles',
          label: 'Generate orders',
          title: 'Draft one purchase order per supplier for the cases still needed',
          primary: true,
        },
        {
          id: 'orders-new',
          icon: 'plus',
          label: 'New order',
          title: 'Create a purchase order',
        },
      ],
    },
  ],
  deliveries: [
    {
      id: 'actions',
      label: 'Deliveries',
      items: [
        {
          id: 'log-delivery',
          icon: 'plus',
          label: 'Log delivery',
          title: 'Log delivery',
          primary: true,
        },
      ],
    },
  ],
  wastage: [
    {
      id: 'actions',
      label: 'Wastage',
      items: [
        {
          id: 'log-wastage',
          icon: 'plus',
          label: 'Log wastage',
          title: 'Log wastage',
          primary: true,
        },
      ],
    },
  ],
  transfers: [
    {
      id: 'actions',
      label: 'Transfers',
      items: [
        {
          id: 'log-transfer',
          icon: 'plus',
          label: 'Log transfer',
          title: 'Log transfer',
          primary: true,
        },
      ],
    },
  ],
  counts: [
    {
      id: 'actions',
      label: 'Counts',
      items: [
        {
          id: 'new-count',
          icon: 'plus',
          label: 'New count session',
          title: 'New count session',
          primary: true,
        },
      ],
    },
    {
      id: 'print',
      label: 'Print',
      items: [
        {
          id: 'print-count-sheets',
          icon: 'printer',
          label: 'Print count sheets',
          title: 'Print paper count sheets — all locations, whole event, or one bar',
        },
      ],
    },
  ],
  closing: [
    {
      id: 'print',
      label: 'Print',
      items: [
        {
          id: 'print-closing-count-sheet',
          icon: 'printer',
          label: 'Print closing sheet',
          title: 'Print blank closing stock count sheets — all locations, whole event, or one bar',
        },
      ],
    },
  ],
  recon: [
    {
      id: 'actions',
      label: 'Recon',
      items: [
        {
          id: 'mark-reconciled',
          icon: 'lock',
          label: 'Mark reconciled',
          title: 'Set event status to Reconciled',
          primary: true,
        },
      ],
    },
    {
      id: 'data',
      label: 'Export',
      items: [
        {
          id: 'export-recon',
          icon: 'download',
          label: 'Export CSV',
          title: 'Download recon as CSV',
        },
      ],
    },
  ],
  audit: [
    {
      id: 'actions',
      label: 'Audit',
      items: [
        {
          id: 'audit-run',
          icon: 'refresh-cw',
          label: 'Run audit',
          title: 'Re-run software integrity checks',
          primary: true,
        },
      ],
    },
    {
      id: 'data',
      label: 'Export',
      items: [
        {
          id: 'audit-export',
          icon: 'download',
          label: 'Export JSON',
          title: 'Download audit findings as JSON',
        },
      ],
    },
  ],
  reports: [
    {
      id: 'data',
      label: 'Export',
      items: [
        {
          id: 'export-reports',
          icon: 'download',
          label: 'Export CSV',
          title: 'Download report as CSV',
        },
        {
          id: 'export-invoice',
          icon: 'file-text',
          label: 'Export invoice',
          title: 'Download client transfer invoice PDF',
        },
        {
          id: 'export-report-pdf',
          icon: 'file-text',
          label: 'Export PDF',
          title: 'Event headlines or loose stock statement as a PDF',
        },
        {
          id: 'export-volume',
          icon: 'download',
          label: 'Export volume Excel',
          title: 'Download a formatted Excel workbook grouped by product category',
        },
      ],
    },
  ],
  summary: [
    {
      id: 'data',
      label: 'Export',
      items: [
        {
          id: 'export-reports',
          icon: 'download',
          label: 'Export CSV',
          title: 'Download report as CSV',
        },
        {
          id: 'export-invoice',
          icon: 'file-text',
          label: 'Export invoice',
          title: 'Download client transfer invoice PDF',
        },
      ],
    },
  ],
  sales: [
    {
      id: 'item-sales',
      label: 'Item sales',
      items: [
        {
          id: 'import-till-sales',
          icon: 'upload',
          label: 'Import item sales',
          title: 'Import Square Item Sales',
          primary: true,
        },
        {
          id: 'clear-till-sales',
          icon: 'trash',
          title: 'Clear item sales',
        },
      ],
    },
    {
      id: 'modifiers',
      label: 'Modifiers',
      items: [
        {
          id: 'import-modifiers',
          icon: 'upload',
          label: 'Import modifiers',
          title: 'Import Square Modifier Sales',
          primary: true,
        },
        {
          id: 'clear-modifiers',
          icon: 'trash',
          title: 'Clear modifiers',
        },
      ],
    },
  ],
  suppliers: [
    {
      id: 'actions',
      label: 'Suppliers',
      items: [
        {
          id: 'new-supplier',
          icon: 'plus',
          label: 'New supplier',
          title: 'New supplier',
          primary: true,
        },
      ],
    },
  ],
  warehouses: [
    {
      id: 'actions',
      label: 'Warehouses',
      items: [
        {
          id: 'new-warehouse',
          icon: 'plus',
          label: 'New warehouse',
          title: 'New warehouse',
          primary: true,
        },
      ],
    },
  ],
  library: [
    {
      id: 'actions',
      label: 'Library',
      items: [
        {
          id: 'new-product',
          icon: 'plus',
          label: 'New product',
          title: 'New product',
          primary: true,
        },
        {
          id: 'merge-products',
          icon: 'merge',
          label: 'Merge duplicates',
          title: 'Merge duplicate products into one SKU',
        },
      ],
    },
  ],
  'kit-library': [
    {
      id: 'actions',
      label: 'Kit library',
      items: [
        {
          id: 'new-kit-item',
          icon: 'plus',
          label: 'New kit item',
          title: 'New kit item',
          primary: true,
        },
        {
          id: 'kit-mobile-count',
          icon: 'container',
          label: 'Mobile count',
          title: 'Open mobile container counting on this device or phone',
        },
        {
          id: 'kit-label-queue',
          icon: 'printer',
          label: 'Print queue',
          title: 'Print kit labels queued from mobile',
        },
        {
          id: 'manage-kit-categories',
          icon: 'layers',
          label: 'Categories',
          title: 'Manage kit categories',
        },
        {
          id: 'auto-kit-photos',
          icon: 'wand-sparkles',
          label: 'Auto photos',
          title: 'Find and set photos for kit items missing an image',
        },
      ],
    },
  ],
  kit: [
    {
      id: 'actions',
      label: 'Kit',
      items: [
        {
          id: 'kit-scan',
          icon: 'scan-barcode',
          label: 'Scan',
          title: 'Pair phone camera as barcode scanner',
          primary: true,
        },
        {
          id: 'kit-warehouse-in',
          icon: 'warehouse',
          label: 'Send own',
          title: 'Send own kit from warehouse onto this event',
        },
        {
          id: 'kit-hire-in',
          icon: 'truck',
          label: 'Hire in',
          title: 'Hire kit onto this event',
        },
        {
          id: 'kit-warehouse-out',
          icon: 'undo-2',
          label: 'Check in',
          title: 'Return kit to warehouse',
        },
        {
          id: 'kit-hire-return',
          icon: 'corner-up-left',
          label: 'Return hire',
          title: 'Return hired kit',
        },
        {
          id: 'kit-write-off',
          icon: 'trash',
          label: 'Write-off',
          title: 'Write off kit',
        },
      ],
    },
  ],
  'volume-pools': [
    {
      id: 'actions',
      label: 'Volume pools',
      items: [
        {
          id: 'new-volume-pool',
          icon: 'plus',
          label: 'New pool',
          title: 'New volume pool',
          primary: true,
        },
      ],
    },
  ],
  bugs: [
    {
      id: 'actions',
      label: 'Bug reports',
      items: [
        {
          id: 'new-bug-report',
          icon: 'plus',
          label: 'New report',
          title: 'New report',
          primary: true,
        },
      ],
    },
  ],
};

const TOOLBAR_ICON = { size: 16, strokeWidth: 2 };

function renderMenuChild(child) {
  const title = child.title || child.label || child.id;
  return `<button type="button" class="topbar-menu-item topbar-menu-item--row" role="menuitem"
    data-toolbar-action="${escapeHtml(child.id)}"
    title="${escapeHtml(title)}">
    ${child.icon ? icon(child.icon, TOOLBAR_ICON) : ''}<span>${escapeHtml(child.label || child.id)}</span>
  </button>`;
}

function renderToolbarItem(item) {
  if (item.kind === 'divider') {
    return '<span class="topbar-divider" aria-hidden="true"></span>';
  }
  if (item.kind === 'text') {
    return `<span class="topbar-tool-meta muted" data-toolbar-meta="${item.id}">${item.label || ''}</span>`;
  }
  const iconOpts = TOOLBAR_ICON;
  const title = item.title || item.label || item.id;
  if (item.kind === 'menu') {
    const menuId = `toolbar-menu-${item.id}`;
    return `<div class="topbar-tool-wrap" data-toolbar-menu-wrap="${escapeHtml(item.id)}">
      <button type="button" class="topbar-tool topbar-tool--label"
        data-toolbar-menu="${escapeHtml(item.id)}"
        aria-haspopup="menu" aria-expanded="false" aria-controls="${escapeHtml(menuId)}"
        title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
        ${item.icon ? icon(item.icon, iconOpts) : ''}<span>${escapeHtml(item.label || 'Menu')}</span>${icon('chevron-down', { size: 14, strokeWidth: 2, class: 'topbar-tool-chevron' })}
      </button>
      <div class="topbar-menu topbar-menu--start" id="${escapeHtml(menuId)}" role="menu" hidden>
        ${(item.items || []).map(renderMenuChild).join('')}
      </div>
    </div>`;
  }
  const classes = ['topbar-tool'];
  if (item.label) classes.push('topbar-tool--label');
  if (item.primary) classes.push('topbar-tool--primary');
  const inner = item.label
    ? `${item.icon ? icon(item.icon, iconOpts) : ''}<span>${item.label}</span>`
    : icon(item.icon, iconOpts);

  return `<button type="button" class="${classes.join(' ')}"
    data-toolbar-action="${item.id}"
    title="${title}"
    aria-label="${title}"
    ${item.disabled ? 'disabled' : ''}>
    ${inner}
  </button>`;
}

function renderStrip(strip) {
  return `<div class="topbar-toolbar" role="group" aria-label="${strip.label}" data-toolbar-strip="${strip.id}">
    ${strip.items.map(renderToolbarItem).join('')}
  </div>`;
}

function onToolbarAction(actionId) {
  const detail = { action: actionId, handled: false };
  document.dispatchEvent(new CustomEvent(ADMIN_TOOLBAR_ACTION, { detail }));
  if (!detail.handled) {
    toast(`“${actionId.replace(/-/g, ' ')}” — coming soon`);
  }
}

function stripsForRoute(route) {
  if (!route) return null;
  const globalStrips = PANEL_TOOLBAR[route.view];
  const eventStrips = route.view === 'event' ? PANEL_TOOLBAR[route.panel] : null;
  const configured = eventStrips !== undefined && eventStrips !== null
    ? eventStrips
    : (globalStrips !== undefined && globalStrips !== null ? globalStrips : null);
  const strips = Array.isArray(configured)
    ? configured.filter((strip) => strip.items.length)
    : null;
  return {
    configured,
    strips,
  };
}

export function initTopbarToolbar() {
  const tools = $('topbarTools');
  const stripsEl = $('topbarToolbarStrips');
  const filterStrip = $('topbarFilterStrip');
  if (!tools || !stripsEl || !filterStrip) {
    toolbarController = { syncRoute() {}, setStrips() {}, paint() {} };
    return { syncRoute: () => {} };
  }

  /** @type {object | null} */
  let lastRoute = null;
  /** @type {ToolbarStrip[] | null} */
  let stripOverride = null;

  function closeToolbarMenus() {
    stripsEl.querySelectorAll('[data-toolbar-menu]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
      const menu = document.getElementById(btn.getAttribute('aria-controls') || '');
      if (menu) menu.hidden = true;
    });
  }

  stripsEl.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-toolbar-menu]');
    if (menuBtn && stripsEl.contains(menuBtn)) {
      e.stopPropagation();
      const menu = document.getElementById(menuBtn.getAttribute('aria-controls') || '');
      const willOpen = !!menu?.hidden;
      closeToolbarMenus();
      if (willOpen && menu) {
        menu.hidden = false;
        menuBtn.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    const btn = e.target.closest('[data-toolbar-action]');
    if (!btn || btn.disabled || !stripsEl.contains(btn)) return;
    closeToolbarMenus();
    onToolbarAction(btn.dataset.toolbarAction);
  });

  document.addEventListener('click', (e) => {
    if (e.target instanceof Node && stripsEl.contains(e.target)) return;
    closeToolbarMenus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeToolbarMenus();
  });

  function paint(route = lastRoute) {
    const { configured, strips: defaultStrips } = stripsForRoute(route) || { configured: null, strips: null };
    const strips = stripOverride || defaultStrips;
    const showFilter = route ? hasTableFilter(route) && !filterSuppressed : false;
    const showStrips = !!(strips && strips.length);
    const showToolbar = showStrips || showFilter || configured !== null || !!stripOverride;

    tools.hidden = !showToolbar;
    stripsEl.hidden = !showStrips;
    filterStrip.hidden = !showFilter;

    if (showStrips) {
      stripsEl.innerHTML = strips.map(renderStrip).join('');
      initIcons(stripsEl);
    } else {
      stripsEl.innerHTML = '';
    }
    initIcons($('topbarEditStrip'));
    refreshFieldUndoButtons();
  }

  function syncRoute(route) {
    lastRoute = route;
    stripOverride = null;
    paint(route);
  }

  function setStrips(strips) {
    stripOverride = Array.isArray(strips) ? strips : null;
    paint(lastRoute);
  }

  toolbarController = { syncRoute, setStrips, paint };

  return { syncRoute };
}
