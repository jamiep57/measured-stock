/**
 * Topbar product search — shared across all admin pages.
 * Event pages search event_products; other pages search the library catalogue.
 */

import { $, isBoneYard, escapeHtml } from '../lib/util.js';
import {
  loadEventFull, loadLibraryProducts, loadKitLibraryProducts, loadEventKit,
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
    || route.view === 'settings';
}

export function initGlobalSearch() {
  const container = $('topbarSearch');
  if (!container) return { syncRoute: async () => {} };

  const topbarControls = initTableFilterTopbar();
  const topbarToolbar = initTopbarToolbar();

  let query = '';
  let routeKey = '';

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
      const event = await loadEventFull(route.eventId);
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
      const nextKey = route.view === 'event'
        ? `event:${route.eventId}:${route.panel || 'dashboard'}`
        : route.view;
      const eventChanged = nextKey !== routeKey;
      routeKey = nextKey;

      if (eventChanged) {
        query = '';
        emitProductFilter({ query: '', productId: null, source: 'route-change' });
      }

      container.hidden = hideSearchForRoute(route);
      if (container.hidden) {
        topbarControls.syncRoute(route, { products: [], bars: [] });
        topbarToolbar.syncRoute(route);
        return;
      }
      try {
        const { products, bars } = await loadPageContext(route);
        mount(products, route);
        topbarControls.syncRoute(route, { products, bars });
        topbarToolbar.syncRoute(route);
      } catch (err) {
        console.warn('global search load failed', err);
        mount([], route);
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
    const match = productId
      ? pid === productId
      : (!q || name.includes(q) || pid === q);
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
