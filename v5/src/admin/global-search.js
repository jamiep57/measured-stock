/**
 * Topbar product search — shared across all admin pages.
 * Event pages search event_products; other pages search the library catalogue.
 */

import { $, isBoneYard, escapeHtml } from '../lib/util.js';
import {
  loadEventLite, loadLibraryProducts, loadKitLibraryProducts, loadEventKit,
} from '../db.js';
import { mountProductSearch } from '../components/product-search.js';
import { initTableFilterTopbar } from './table-filter.js';
import { initTopbarToolbar } from './topbar-toolbar.js';

export const ADMIN_PRODUCT_FILTER = 'admin-product-filter';

let lastFilter = { query: '', productId: null };

export function getLastProductFilter() {
  return { ...lastFilter };
}

export function emitProductFilter(detail) {
  lastFilter = {
    query: detail?.query || '',
    productId: detail?.productId || null,
  };
  document.dispatchEvent(new CustomEvent(ADMIN_PRODUCT_FILTER, { detail }));
}

function placeholderForRoute(route) {
  if (route.view === 'event' && route.panel === 'sales') return 'Search sales…';
  if (route.view === 'event' && route.panel === 'kit') return 'Filter kit / barcode…';
  if (route.view === 'event' && route.panel === 'deliveries') return 'Search supplier or product…';
  if (route.view === 'event' && (route.panel === 'closing' || route.panel === 'recon')) {
    return 'Search product or supplier…';
  }
  if (route.view === 'event') return 'Filter event products…';
  if (route.view === 'library') return 'Search library…';
  if (route.view === 'kit-library') return 'Search kit / barcode…';
  if (route.view === 'suppliers') return 'Search suppliers…';
  return 'Search products…';
}

function hideSearchForRoute(route) {
  return route.view === 'suppliers'
    || route.view === 'warehouses'
    || route.view === 'volume-pools'
    || route.view === 'settings'
    || route.view === 'dev'
    || route.view === 'bugs'
    || route.view === 'audit';
}

export function initGlobalSearch() {
  const container = $('topbarSearch');
  if (!container) return { syncRoute: async () => {} };

  const topbarControls = initTableFilterTopbar();
  const topbarToolbar = initTopbarToolbar();

  let query = '';
  /** Event/workspace scope — clearing the filter only when this changes. */
  let scopeKey = '';
  /** Drop stale async loads so Kit search/toolbar can’t stick on Closing. */
  let syncGeneration = 0;

  function setQuery(value) {
    query = value || '';
    const input = container.querySelector('.product-search-input');
    if (input && input.value !== query) input.value = query;
  }

  function mount(products, route) {
    mountProductSearch(container, {
      products,
      placeholder: placeholderForRoute(route),
      onFilter: (q) => {
        query = q;
        emitProductFilter({ query: q, productId: null, source: 'filter' });
      },
      onSelect: ({ productId, product }) => {
        query = product?.name || '';
        emitProductFilter({
          query: query,
          productId,
          source: 'select',
          scroll: true,
        });
      },
    });

    if (query) {
      setQuery(query);
      emitProductFilter({ query, productId: null, source: 'restore' });
    }
  }

  function scopeKeyForRoute(route) {
    if (route.view === 'event' && route.eventId) return `event:${route.eventId}`;
    return route.view || '';
  }

  async function loadPageContext(route) {
    if (route.view === 'kit-library') {
      return { products: await loadKitLibraryProducts(), bars: [] };
    }
    if (route.view === 'event' && route.panel === 'kit' && route.eventId) {
      const kit = await loadEventKit(route.eventId);
      return {
        products: (kit.items || [])
          .map((it) => it.product)
          .filter((p) => p?.name),
        bars: [],
      };
    }
    if (route.view === 'event' && route.eventId) {
      const event = await loadEventLite(route.eventId);
      return {
        products: (event?.event_products || []).filter((ep) => ep.product?.name),
        bars: (event?.bars || [])
          .filter((b) => !isBoneYard(b))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      };
    }
    return { products: await loadLibraryProducts(), bars: [] };
  }

  return {
    async syncRoute(route) {
      const gen = ++syncGeneration;
      const nextScope = scopeKeyForRoute(route);
      const scopeChanged = nextScope !== scopeKey;
      scopeKey = nextScope;

      if (scopeChanged) {
        query = '';
        emitProductFilter({ query: '', productId: null, source: 'route-change' });
      }

      container.hidden = hideSearchForRoute(route);
      // Always sync filter/toolbar — including pages that hide product search.
      try {
        let products = [];
        let bars = [];
        if (!container.hidden) {
          // loadEventLite / library reads hit shared TTL caches — cheap on panel switches.
          ({ products, bars } = await loadPageContext(route));
          if (gen !== syncGeneration) return;
        }
        if (gen !== syncGeneration) return;
        if (!container.hidden) mount(products, route);
        topbarControls.syncRoute(route, { products, bars });
        topbarToolbar.syncRoute(route);
      } catch (err) {
        if (gen !== syncGeneration) return;
        console.warn('global search load failed', err);
        if (!container.hidden) mount([], route);
        topbarControls.syncRoute(route, { products: [], bars: [] });
        topbarToolbar.syncRoute(route);
      }
    },

    clear() {
      query = '';
      setQuery('');
      emitProductFilter({ query: '', productId: null, source: 'clear' });
    },
  };
}

/** Generic DOM filter for panels that mark rows with [data-pid]. */
export function applyGenericProductFilter({ query, productId }) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('[data-pid]');
  if (!rows.length) return false;

  rows.forEach((row) => {
    const pid = row.dataset.pid;
    const nameEl = row.querySelector('.dist-prod-name, [data-product-name]');
    const name = (nameEl?.textContent || row.dataset.productName || '').toLowerCase();
    const supplier = (row.dataset.supplierName || '').toLowerCase();
    const match = productId
      ? pid === productId
      : (!q || name.includes(q) || supplier.includes(q) || pid === q);
    row.hidden = !match;
  });

  document.querySelectorAll('.dist-cat-row').forEach((catRow) => {
    let sibling = catRow.nextElementSibling;
    let anyVisible = false;
    while (sibling && !sibling.classList.contains('dist-cat-row')) {
      if (sibling.matches('[data-pid]') && !sibling.hidden) anyVisible = true;
      sibling = sibling.nextElementSibling;
    }
    catRow.hidden = !anyVisible;
  });

  if (productId) {
    const target = document.querySelector(`[data-pid="${productId}"]`);
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return true;
}
