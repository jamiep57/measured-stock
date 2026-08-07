/**
 * Admin panel registry — shells + mounts.
 * Heavy panels load on demand to keep the admin boot graph small.
 */

import { escapeHtml } from '../../lib/util.js';
import { notFoundState } from '../../components/empty-state.js';
import { resolveActiveEventId } from '../event-workspace.js';

import {
  renderSuppliersShell,
  mountSuppliersPanel,
} from './suppliers.js';
import {
  renderVolumePoolsShell,
  mountVolumePoolsPanel,
} from './volume-pools.js';
import {
  renderLibraryShell,
  mountLibraryPanel,
} from './library.js';
import {
  renderDashboardShell,
  mountDashboardPanel,
} from './dashboard.js';
import {
  renderBugsShell,
  mountBugsPanel,
} from './bugs.js';
import {
  renderSettingsShell,
  mountSettingsPanel,
} from './settings.js';
import {
  renderWarehousesShell,
  mountWarehousesPanel,
} from './warehouses.js';
import {
  renderHomeShell,
  mountHomePanel,
} from './home.js';
import {
  renderDevShell,
  mountDevPanel,
} from './dev.js';
import {
  renderSetupShell,
  mountSetupPanel,
} from './setup.js';

/** Lazy-loaded heavy panels */
const lazy = {
  sales: () => import('./sales.js'),
  recon: () => import('./recon.js'),
  reports: () => import('./reports.js'),
  closing: () => import('./closing.js'),
  audit: () => import('./audit.js'),
  kit: () => import('./kit.js'),
  'kit-library': () => import('./kit-library.js'),
  distribution: () => import('./distribution.js'),
  products: () => import('./products.js'),
  deliveries: () => import('./deliveries.js'),
  transfers: () => import('./transfers.js'),
  wastage: () => import('./wastage.js'),
  counts: () => import('./counts.js'),
};

/** Warm event-workspace chunks so sidebar clicks feel instant. */
export function prefetchEventPanels() {
  void lazy.reports();
  void lazy.recon();
  void lazy.sales();
  void lazy.closing();
  void lazy.kit();
  void lazy.distribution();
  void lazy.products();
  void lazy.deliveries();
  void lazy.transfers();
  void lazy.wastage();
  void lazy.counts();
}

export const PANEL_TITLES = {
  home: 'Events',
  dev: 'Dev tools',
  library: 'Product library',
  'kit-library': 'Kit library',
  suppliers: 'Suppliers',
  warehouses: 'Warehouses',
  'volume-pools': 'Volume pools',
  bugs: 'Bug & Feature Reports',
  settings: 'Workspace settings',
  dashboard: 'Event dashboard',
  setup: 'Event setup',
  products: 'Products',
  distribution: 'Distribution',
  deliveries: 'Deliveries',
  counts: 'Stock counts',
  kit: 'Kit',
  'stock-levels': 'Stock levels',
  transfers: 'Transfers',
  wastage: 'Wastage',
  closing: 'Closing stock',
  sales: 'Square & modifiers',
  recon: 'Financial recon',
  audit: 'Forensic audit',
  reports: 'Reports',
  summary: 'Reports',
  'not-found': 'Not found',
};

function placeholder(title, bullets) {
  return `
    <div class="admin-surface panel-placeholder">
      <p class="admin-eyebrow">Coming soon</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="muted">Panel scaffold — implementation in progress. See <code>v5/README.md</code>.</p>
      <ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
    </div>`;
}

function notFoundPage() {
  return notFoundState({
    title: 'Page not found',
    copy: 'That URL doesn’t match a V5 admin page. Check the link or pick an event from the sidebar.',
    homeHref: '/',
    homeLabel: 'Back to events',
    surface: 'admin',
  });
}

export async function renderPanel(route, state) {
  if (route.view === 'not-found') {
    return notFoundPage();
  }

  if (route.view === 'home') {
    return renderHomeShell(state.events);
  }

  if (route.view === 'dev') {
    return renderDevShell(state);
  }

  if (route.view === 'library') {
    return renderLibraryShell();
  }

  if (route.view === 'kit-library') {
    const m = await lazy['kit-library']();
    return m.renderKitLibraryShell();
  }

  if (route.view === 'suppliers') {
    return renderSuppliersShell();
  }

  if (route.view === 'volume-pools') {
    return renderVolumePoolsShell();
  }

  if (route.view === 'bugs') {
    return renderBugsShell();
  }

  if (route.view === 'audit') {
    const m = await lazy.audit();
    return m.renderAuditShell();
  }

  if (route.view === 'settings') {
    return renderSettingsShell(route.section || 'users');
  }

  if (route.view === 'warehouses') {
    return renderWarehousesShell();
  }

  if (route.view === 'event') {
    const event = state.events.find((e) => e.id === route.eventId);
    const name = event?.name || route.eventId;
    const panel = route.panel || 'dashboard';

    const specs = {
      dashboard: [
        'Low-stock / running-out table (from Square consumption).',
        'Mapping progress: Square items + modifiers.',
        'Quick stats: products, bars, unmapped till lines.',
      ],
      setup: ['Bars, dates, suppliers, recipients.'],
      products: ['Event catalogue plus ordered, counted-in, and opening stock.'],
      distribution: ['Bar-first product menus + allocation qty.'],
      deliveries: ['Admin view; supplier offer per line.'],
      counts: ['Count sessions with bar-scoped product entry.'],
      kit: [
        'Current RMS–style pack list by category.',
        'REQD / AVAIL / PACKED columns.',
        'Book out, check in, and sub-rent hire.',
      ],
      'stock-levels': ['Live stock by bar.'],
      transfers: ['Bar-to-bar moves.'],
      wastage: ['Wastage batches.'],
      closing: [
        'Physical closing count (cases + singles).',
        'SOR % and max returnable from supplier.',
        'Return amount and carried-over stock.',
      ],
      sales: [
        'Single page: Square item sales + modifier sales.',
        'Recipe mapping; fractions stay as fractions.',
        'Stock warnings inline.',
      ],
      recon: [
        'Supplier + offer visible on every product row.',
        'Price from selected product_suppliers offer.',
        'Clear when multiple suppliers exist.',
      ],
      reports: [
        'Transfers by client with cost summary.',
        'Supplier delivery cost totals.',
        'Filter by client/supplier and date.',
      ],
      summary: [
        'Transfers by client with cost summary.',
        'Supplier delivery cost totals.',
        'Filter by client/supplier and date.',
      ],
    };

    if (panel === 'dashboard') {
      return renderDashboardShell();
    }

    if (panel === 'distribution') {
      const m = await lazy.distribution();
      return m.renderDistributionShell();
    }

    if (panel === 'deliveries') {
      const m = await lazy.deliveries();
      return m.renderDeliveriesShell();
    }

    if (panel === 'wastage') {
      const m = await lazy.wastage();
      return m.renderWastageShell();
    }

    if (panel === 'transfers') {
      const m = await lazy.transfers();
      return m.renderTransfersShell();
    }

    if (panel === 'setup') {
      return renderSetupShell();
    }

    if (panel === 'products') {
      const m = await lazy.products();
      return m.renderProductsShell();
    }

    if (panel === 'sales') {
      const m = await lazy.sales();
      return m.renderSalesShell();
    }

    if (panel === 'counts') {
      const m = await lazy.counts();
      return m.renderCountsShell();
    }

    if (panel === 'kit') {
      const m = await lazy.kit();
      return m.renderKitShell();
    }

    if (panel === 'recon') {
      const m = await lazy.recon();
      return m.renderReconShell();
    }

    if (panel === 'closing') {
      const m = await lazy.closing();
      return m.renderClosingShell();
    }

    if (panel === 'reports' || panel === 'summary') {
      const m = await lazy.reports();
      return m.renderReportsShell();
    }

    return `
      <div class="admin-page">
        <p class="event-breadcrumb">${escapeHtml(name)}</p>
        ${placeholder(PANEL_TITLES[panel] || panel, specs[panel] || ['Coming soon.'])}
      </div>`;
  }

  return `<div class="admin-page">${placeholder('Admin', ['Select a section from the sidebar.'])}</div>`;
}

/** Wire interactive panels after HTML is inserted. Returns cleanup fn. */
export async function mountPanel(route, state) {
  if (route.view === 'home') {
    return mountHomePanel();
  }
  if (route.view === 'dev') {
    return mountDevPanel();
  }
  if (route.view === 'event' && route.panel === 'distribution') {
    const m = await lazy.distribution();
    return m.mountDistributionPanel(route, state);
  }
  if (route.view === 'event' && route.panel === 'deliveries') {
    const m = await lazy.deliveries();
    return m.mountDeliveriesPanel(route);
  }
  if (route.view === 'event' && route.panel === 'wastage') {
    const m = await lazy.wastage();
    return m.mountWastagePanel(route);
  }
  if (route.view === 'event' && route.panel === 'transfers') {
    const m = await lazy.transfers();
    return m.mountTransfersPanel(route);
  }
  if (route.view === 'event' && route.panel === 'setup') {
    return mountSetupPanel(route, state);
  }
  if (route.view === 'event' && route.panel === 'products') {
    const m = await lazy.products();
    return m.mountProductsPanel(route);
  }
  if (route.view === 'event' && route.panel === 'dashboard') {
    return mountDashboardPanel(route);
  }
  if (route.view === 'event' && route.panel === 'sales') {
    const m = await lazy.sales();
    return m.mountSalesPanel(route);
  }
  if (route.view === 'event' && route.panel === 'counts') {
    const m = await lazy.counts();
    return m.mountCountsPanel(route);
  }
  if (route.view === 'event' && route.panel === 'kit') {
    const m = await lazy.kit();
    return m.mountKitPanel(route);
  }
  if (route.view === 'event' && route.panel === 'recon') {
    const m = await lazy.recon();
    return m.mountReconPanel(route);
  }
  if (route.view === 'event' && route.panel === 'closing') {
    const m = await lazy.closing();
    return m.mountClosingPanel(route);
  }
  if (route.view === 'event' && (route.panel === 'reports' || route.panel === 'summary')) {
    const m = await lazy.reports();
    return m.mountReportsPanel(route);
  }
  if (route.view === 'suppliers') {
    return mountSuppliersPanel();
  }
  if (route.view === 'volume-pools') {
    return mountVolumePoolsPanel();
  }
  if (route.view === 'library') {
    return mountLibraryPanel();
  }
  if (route.view === 'kit-library') {
    const m = await lazy['kit-library']();
    return m.mountKitLibraryPanel();
  }
  if (route.view === 'bugs') {
    return mountBugsPanel();
  }
  if (route.view === 'audit') {
    const m = await lazy.audit();
    const eventId = resolveActiveEventId(route, state);
    return m.mountAuditPanel({ ...route, eventId });
  }
  if (route.view === 'settings') {
    return mountSettingsPanel(route.section || 'users');
  }
  if (route.view === 'warehouses') {
    return mountWarehousesPanel();
  }
  return null;
}
