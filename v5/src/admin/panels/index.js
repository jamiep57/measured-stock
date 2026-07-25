import { escapeHtml } from '../../lib/util.js';
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
  renderSalesShell,
  mountSalesPanel,
} from './sales.js';
import {
  renderCountsShell,
  mountCountsPanel,
} from './counts.js';
import {
  renderReconShell,
  mountReconPanel,
} from './recon.js';
import {
  renderDashboardShell,
  mountDashboardPanel,
} from './dashboard.js';
import {
  renderBugsShell,
  mountBugsPanel,
} from './bugs.js';
import {
  renderReportsShell,
  mountReportsPanel,
} from './reports.js';
import {
  renderClosingShell,
  mountClosingPanel,
} from './closing.js';
import {
  renderSettingsShell,
  mountSettingsPanel,
} from './settings.js';
import {
  renderWarehousesShell,
  mountWarehousesPanel,
} from './warehouses.js';
import {
  renderKitLibraryShell,
  mountKitLibraryPanel,
} from './kit-library.js';
import {
  renderKitShell,
  mountKitPanel,
} from './kit.js';

export const PANEL_TITLES = {
  home: 'Events',
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

export async function renderPanel(route, state) {
  if (route.view === 'not-found') {
    return `<div class="admin-page">${placeholder('Page not found', ['Check the URL or pick an event from the sidebar.'])}</div>`;
  }

  if (route.view === 'home') {
    if (!state.events.length) {
      return `
        <div class="admin-page">
          <div class="admin-empty">No events yet. Create one in v2 admin until Setup is ported.</div>
        </div>`;
    }
    return `
      <div class="admin-page">
        <div class="event-grid">
          ${state.events.map((e) => `
            <a class="event-card" href="/v5/admin/events/${e.id}/dashboard">
              <div class="event-card-name">${escapeHtml(e.name)}</div>
              <div class="event-card-meta">Open dashboard →</div>
            </a>`).join('')}
        </div>
      </div>`;
  }

  if (route.view === 'library') {
    return renderLibraryShell();
  }

  if (route.view === 'kit-library') {
    return renderKitLibraryShell();
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

  if (route.view === 'settings') {
    return renderSettingsShell();
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
      return renderSalesShell();
    }

    if (panel === 'counts') {
      return renderCountsShell();
    }

    if (panel === 'kit') {
      return renderKitShell();
    }

    if (panel === 'recon') {
      return renderReconShell();
    }

    if (panel === 'closing') {
      return renderClosingShell();
    }

    if (panel === 'reports' || panel === 'summary') {
      return renderReportsShell();
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
export function mountPanel(route, state) {
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
    return mountSalesPanel(route);
  }
  if (route.view === 'event' && route.panel === 'counts') {
    return mountCountsPanel(route);
  }
  if (route.view === 'event' && route.panel === 'kit') {
    return mountKitPanel(route);
  }
  if (route.view === 'event' && route.panel === 'recon') {
    return mountReconPanel(route);
  }
  if (route.view === 'event' && route.panel === 'closing') {
    return mountClosingPanel(route);
  }
  if (route.view === 'event' && (route.panel === 'reports' || route.panel === 'summary')) {
    return mountReportsPanel(route);
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
    return mountKitLibraryPanel();
  }
  if (route.view === 'bugs') {
    return mountBugsPanel();
  }
  if (route.view === 'settings') {
    return mountSettingsPanel();
  }
  if (route.view === 'warehouses') {
    return mountWarehousesPanel();
  }
  return null;
}
