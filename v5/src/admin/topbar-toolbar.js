/**
 * Admin topbar toolbar — disconnected icon strips + filter/search on the right.
 */

import { $, toast } from '../lib/util.js';
import { can } from '../lib/permissions.js';
import { icon, initIcons } from '../lib/icons.js';
import { hasTableFilter } from './table-filter.js';
import { refreshFieldUndoButtons } from '../lib/field-undo.js';

export const ADMIN_TOOLBAR_ACTION = 'admin-toolbar-action';

/** @typedef {{ id: string, icon?: string, title?: string, label?: string, primary?: boolean, disabled?: boolean, kind?: 'button' | 'text' }} ToolbarItem */
/** @typedef {{ id: string, label: string, items: ToolbarItem[] }} ToolbarStrip */

/** @type {{ syncRoute: (route: object) => void, setStrips: (strips: ToolbarStrip[] | null) => void }} */
let toolbarController = {
  syncRoute() {},
  setStrips() {},
};

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
          icon: 'refresh-cw',
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
          icon: 'copy',
          label: 'Save menu',
          title: 'Save this event’s menu so it can be applied to any event',
          primary: true,
        },
        {
          id: 'plan-apply-menu',
          icon: 'library',
          label: 'Apply menu',
          title: 'Copy a saved menu onto this event',
        },
        {
          id: 'plan-add-product',
          icon: 'plus',
          label: 'Add product',
          title: 'Add a library product to this event menu',
        },
        {
          id: 'plan-add-cocktail',
          icon: 'martini',
          label: 'Cocktail',
          title: 'Create a cocktail sold as one drink, costed from its stock products',
        },
        {
          id: 'plan-add-spirit-mixer',
          icon: 'glass-water',
          label: 'Spirit & mixer',
          title: 'Spirit plus mixer, sold as one drink and costed from its stock products. Sits under Spirit & mixers.',
        },
        {
          id: 'plan-add-scenario',
          icon: 'target',
          label: 'Scenario',
          title: 'Add a pricing scenario column',
        },
        {
          id: 'plan-costs',
          icon: 'lock',
          label: 'Costs',
          title: 'Lock or unlock menu costs',
        },
        {
          id: 'plan-export',
          icon: 'download',
          label: 'Export',
          title: 'Designer menu, client pack or schedule of rates',
        },
        {
          id: 'square-menu-sync',
          icon: 'refresh-cw',
          label: 'Sync to Square',
          title: 'Preview and push this menu and its prices to Square',
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
  products: [
    {
      id: 'actions',
      label: 'Products',
      items: [
        {
          id: 'add-event-product',
          icon: 'plus',
          label: 'Add product',
          title: 'Add product to event',
          primary: true,
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

function renderToolbarItem(item) {
  if (item.kind === 'text') {
    return `<span class="topbar-tool-meta muted" data-toolbar-meta="${item.id}">${item.label || ''}</span>`;
  }
  const classes = ['topbar-tool'];
  if (item.label) classes.push('topbar-tool--label');
  if (item.primary) classes.push('topbar-tool--primary');
  const iconOpts = { size: 16, strokeWidth: 2 };
  const title = item.title || item.label || item.id;
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
    ? configured.map((strip) => ({
      ...strip,
      items: strip.items.filter((item) => item.id !== 'add-event-product' || can('stock.products_edit')),
    })).filter((strip) => strip.items.length)
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
    toolbarController = { syncRoute() {}, setStrips() {} };
    return { syncRoute: () => {} };
  }

  /** @type {object | null} */
  let lastRoute = null;
  /** @type {ToolbarStrip[] | null} */
  let stripOverride = null;

  stripsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toolbar-action]');
    if (!btn || btn.disabled) return;
    onToolbarAction(btn.dataset.toolbarAction);
  });

  function paint(route = lastRoute) {
    const { configured, strips: defaultStrips } = stripsForRoute(route) || { configured: null, strips: null };
    const strips = stripOverride || defaultStrips;
    const showFilter = route ? hasTableFilter(route) : false;
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

  toolbarController = { syncRoute, setStrips };

  return { syncRoute };
}
