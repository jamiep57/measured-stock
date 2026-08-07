/**
 * Admin panel registry — shells + mounts.
 * Heavy panels (sales, recon, reports, closing, audit, kit) load on demand.
 */

import { escapeHtml } from '../../lib/util.js';
import { notFoundState } from '../../components/empty-state.js';
import { resolveActiveEventId } from '../event-workspace.js';

import {
  renderDistributionShell,
  mountDistributionPanel,
} from './distribution.js';
import {
  renderDeliveriesShell,
  mountDeliveriesPanel,
} from './deliveries.js';
import {
  renderWastageShell,
  mountWastagePanel,
} from './wastage.js';
import {
  renderProductsShell,
  mountProductsPanel,
} from './products.js';
import {
  renderSetupShell,
  mountSetupPanel,
} from './setup.js';
import {
  renderTransfersShell,
  mountTransfersPanel,
} from './transfers.js';
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
  renderCountsShell,
  mountCountsPanel,
} from './counts.js';
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

/** Lazy-loaded heavy panels */
const lazy = {
  sales: () => import('./sales.js'),
  recon: () => import('./recon.js'),
  reports: () => import('./reports.js'),
  closing: () => import('./closing.js'),
  audit: () => import('./audit.js'),
  kit: () => import('./kit.js'),
  'kit-library': () => import('./kit-library.js'),
};

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
    homeHref: '/v5/admin',
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
      return renderDistributionShell();
    }

    if (panel === 'deliveries') {
      return renderDeliveriesShell();
    }

    if (panel === 'wastage') {
      return renderWastageShell();
    }

    if (panel === 'transfers') {
      return renderTransfersShell();
    }

    if (panel === 'setup') {
      return renderSetupShell();
    }

    if (panel === 'products') {
      return renderProductsShell();
    }

    if (panel === 'sales') {
      const m = await lazy.sales();
      return m.renderSalesShell();
    }

    if (panel === 'counts') {
      return renderCountsShell();
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
    return mountDistributionPanel(route, state);
  }
  if (route.view === 'event' && route.panel === 'deliveries') {
    return mountDeliveriesPanel(route);
  }
  if (route.view === 'event' && route.panel === 'wastage') {
    return mountWastagePanel(route);
  }
  if (route.view === 'event' && route.panel === 'transfers') {
    return mountTransfersPanel(route);
  }
  if (route.view === 'event' && route.panel === 'setup') {
    return mountSetupPanel(route, state);
  }
  if (route.view === 'event' && route.panel === 'products') {
    return mountProductsPanel(route);
  }
  if (route.view === 'event' && route.panel === 'dashboard') {
    return mountDashboardPanel(route);
  }
  if (route.view === 'event' && route.panel === 'sales') {
    const m = await lazy.sales();
    return m.mountSalesPanel(route);
  }
  if (route.view === 'event' && route.panel === 'counts') {
    return mountCountsPanel(route);
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
