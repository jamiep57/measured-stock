/**
 * Admin topbar toolbar — disconnected icon strips + filter/search on the right.
 */

import { $, toast } from '../lib/util.js';
import { icon, initIcons } from '../lib/icons.js';

export const ADMIN_TOOLBAR_ACTION = 'admin-toolbar-action';

/** @typedef {{ id: string, icon?: string, title: string, label?: string, primary?: boolean, disabled?: boolean }} ToolbarItem */
/** @typedef {{ id: string, label: string, items: ToolbarItem[] }} ToolbarStrip */

/** Per-panel strips (left of filter/search on distribution). */
export const PANEL_TOOLBAR = {
  distribution: [],
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
          title: 'Print paper count sheets — one per location',
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
          title: 'Print a blank closing stock count sheet for the whole event',
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
          icon: 'trash-2',
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
          icon: 'trash-2',
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
  const classes = ['topbar-tool'];
  if (item.label) classes.push('topbar-tool--label');
  if (item.primary) classes.push('topbar-tool--primary');
  const inner = item.label
    ? `${item.icon ? icon(item.icon, { size: 16, strokeWidth: 2.5 }) : ''}<span>${item.label}</span>`
    : icon(item.icon, { size: 16 });

  return `<button type="button" class="${classes.join(' ')}"
    data-toolbar-action="${item.id}"
    title="${item.title}"
    aria-label="${item.title}"
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

export function initTopbarToolbar() {
  const tools = $('topbarTools');
  const stripsEl = $('topbarToolbarStrips');
  const filterStrip = $('topbarFilterStrip');
  if (!tools || !stripsEl || !filterStrip) return { syncRoute: () => {} };

  stripsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toolbar-action]');
    if (!btn || btn.disabled) return;
    onToolbarAction(btn.dataset.toolbarAction);
  });

  return {
    syncRoute(route) {
      const globalStrips = PANEL_TOOLBAR[route.view];
      const eventStrips = route.view === 'event' ? PANEL_TOOLBAR[route.panel] : null;
      const configured = eventStrips !== undefined && eventStrips !== null
        ? eventStrips
        : (globalStrips !== undefined && globalStrips !== null ? globalStrips : null);
      const strips = Array.isArray(configured) ? configured : null;
      const showFilter = route.view === 'event' && route.panel === 'distribution';
      const showStrips = !!(strips && strips.length);
      const showToolbar = showStrips || showFilter || configured !== null;

      tools.hidden = !showToolbar;
      stripsEl.hidden = !showStrips;
      filterStrip.hidden = !showFilter;

      if (showStrips) {
        stripsEl.innerHTML = strips.map(renderStrip).join('');
        initIcons(stripsEl);
      } else {
        stripsEl.innerHTML = '';
      }
    },
  };
}
