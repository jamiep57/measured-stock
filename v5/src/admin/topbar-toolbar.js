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
  distribution: [
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'undo', icon: 'undo-2', title: 'Undo', disabled: true },
        { id: 'redo', icon: 'redo-2', title: 'Redo', disabled: true },
      ],
    },
    {
      id: 'data',
      label: 'Import & export',
      items: [
        { id: 'upload', icon: 'upload', title: 'Upload' },
        { id: 'download', icon: 'download', title: 'Download' },
        { id: 'print', icon: 'printer', title: 'Print' },
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
    {
      id: 'data',
      label: 'Import & export',
      items: [
        { id: 'upload', icon: 'upload', title: 'Upload' },
        { id: 'download', icon: 'download', title: 'Download' },
        { id: 'print', icon: 'printer', title: 'Print' },
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
    {
      id: 'data',
      label: 'Import & export',
      items: [
        { id: 'upload', icon: 'upload', title: 'Upload' },
        { id: 'download', icon: 'download', title: 'Download' },
        { id: 'print', icon: 'printer', title: 'Print' },
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
    {
      id: 'data',
      label: 'Import & export',
      items: [
        { id: 'upload', icon: 'upload', title: 'Upload' },
        { id: 'download', icon: 'download', title: 'Download' },
        { id: 'print', icon: 'printer', title: 'Print' },
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
          title: 'Download supplier delivery cost as CSV',
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
          title: 'Download supplier delivery cost as CSV',
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
          icon: 'git-merge',
          label: 'Merge duplicates',
          title: 'Merge duplicates',
        },
      ],
    },
  ],
  'case-sizes': [
    {
      id: 'actions',
      label: 'Case sizes',
      items: [
        {
          id: 'new-case-size',
          icon: 'plus',
          label: 'New case size',
          title: 'New case size',
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
      const globalStrips = PANEL_TOOLBAR[route.view] || null;
      const eventStrips = route.view === 'event' ? (PANEL_TOOLBAR[route.panel] || null) : null;
      const strips = eventStrips || globalStrips;
      const showToolbar = !!(eventStrips || globalStrips);
      const showFilter = route.view === 'event' && route.panel === 'distribution';

      tools.hidden = !showToolbar;
      stripsEl.hidden = !strips;
      filterStrip.hidden = !showFilter;

      if (strips) {
        stripsEl.innerHTML = strips.map(renderStrip).join('');
        initIcons(stripsEl);
      } else {
        stripsEl.innerHTML = '';
      }
    },
  };
}
