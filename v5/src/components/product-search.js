/**
 * Global searchable product picker — use everywhere instead of raw <select>.
 *
 *   mountProductSearch(container, {
 *     products,           // product[] or event_product[] with nested product
 *     pools,              // optional volume pools [{ name, key, meta }]
 *     caseSizes,
 *     value: productId,
 *     poolValue: poolName,
 *     allowCreate: false,
 *     categories: [],    // for create modal
 *     onCreateProduct,  // async ({ name, category_id, case_size_id }) => { productId, product }
 *     onSelect({ productId, poolName, product }),
 *   })
 */

import { escapeHtml } from '../lib/util.js';
import { productStockPack } from '../pack-metrics.js';
import { openModal, closeModal } from './modal.js';

function normaliseProducts(list) {
  return (list || []).map((item) => {
    if (item.product) {
      return { ...item.product, _eventProductId: item.id, _productId: item.product_id || item.product.id };
    }
    return { ...item, _productId: item.id };
  }).filter((p) => p.name);
}

function normalisePools(list) {
  return (list || [])
    .map((pool) => ({
      name: String(pool?.name || '').trim(),
      key: pool?.key || String(pool?.name || '').trim().toLowerCase(),
      meta: pool?.meta || 'Volume pool',
      searchText: pool?.searchText || '',
    }))
    .filter((p) => p.name);
}

function offerSummary(product) {
  const offers = product.product_suppliers || [];
  if (!offers.length) return '';
  const pref = offers.find((o) => o.is_preferred) || offers[0];
  const name = pref.supplier?.name || 'Supplier';
  const extra = offers.length > 1 ? ` (+${offers.length - 1})` : '';
  const price = pref.unit_price != null ? ` · £${pref.unit_price}` : pref.case_price != null ? ` · £${pref.case_price}/case` : '';
  return name + extra + price;
}

function categoryOptionsHtml(categories) {
  return (categories || [])
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
    .join('');
}

function caseSizeOptionsHtml(caseSizes) {
  return (caseSizes || [])
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || c.name || '')}</option>`)
    .join('');
}

/**
 * @returns {HTMLElement} root element
 */
export function mountProductSearch(container, options = {}) {
  const {
    products = [],
    pools = [],
    caseSizes = [],
    categories = [],
    value = '',
    poolValue = '',
    placeholder = 'Search products…',
    allowCreate = false,
    dropdownFixed = false,
    onCreateProduct,
    onSelect,
    onFilter,
  } = options;

  let items = normaliseProducts(products);
  let poolItems = normalisePools(pools);
  let selectedId = value || '';
  let selectedPool = poolValue || '';

  const root = document.createElement('div');
  root.className = 'product-search';
  root.innerHTML = `
    <input type="search" class="product-search-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
    <span class="product-search-pack" hidden></span>
    <div class="product-search-list" hidden></div>
  `;

  const input = root.querySelector('.product-search-input');
  const list = root.querySelector('.product-search-list');
  const packEl = root.querySelector('.product-search-pack');

  function packLabelFor(product) {
    if (!product) return '';
    const pack = productStockPack(product, caseSizes);
    return (pack.label || product.case_size || '').trim();
  }

  function selectedPoolItem() {
    if (!selectedPool) return null;
    const key = selectedPool.trim().toLowerCase();
    return poolItems.find((p) => p.name.toLowerCase() === key || p.key === key) || null;
  }

  function syncPackDisplay({ editing = false } = {}) {
    const pool = selectedPoolItem();
    if (pool && !editing && input.value.trim() === pool.name) {
      packEl.textContent = pool.meta || 'Volume pool';
      packEl.hidden = false;
      root.classList.add('has-pack');
      root.title = `${pool.name} · ${pool.meta || 'Volume pool'}`;
      return;
    }

    const selected = selectedId ? items.find((p) => p._productId === selectedId) : null;
    const pack = packLabelFor(selected);
    const show = !editing && !!selected && !!pack && input.value.trim() === (selected.name || '').trim();
    if (show) {
      packEl.textContent = pack;
      packEl.hidden = false;
      root.classList.add('has-pack');
      root.title = `${selected.name} · ${pack}`;
    } else {
      packEl.textContent = '';
      packEl.hidden = true;
      root.classList.remove('has-pack');
      root.title = selected?.name || pool?.name || '';
    }
  }

  function syncListPosition() {
    if (!dropdownFixed || list.hidden) return;
    const rect = input.getBoundingClientRect();
    // Portal to body: sheets/drawers with overflow or transform clip absolute lists.
    if (list.parentElement !== document.body) {
      document.body.appendChild(list);
    }
    list.style.position = 'fixed';
    list.style.left = `${rect.left}px`;
    list.style.width = `${Math.max(rect.width, 240)}px`;
    list.style.top = `${rect.bottom + 4}px`;
    list.style.right = 'auto';
    list.style.zIndex = '300';
  }

  function resetListPosition() {
    list.style.position = '';
    list.style.left = '';
    list.style.width = '';
    list.style.top = '';
    list.style.right = '';
    list.style.zIndex = '';
    if (list.parentElement !== root) {
      root.appendChild(list);
    }
  }

  const scrollParents = dropdownFixed
    ? [container.closest('.dist-grid-wrap'), container.closest('.sheet-body')].filter(Boolean)
    : [];
  scrollParents.forEach((el) => {
    el.addEventListener('scroll', () => {
      if (!list.hidden) syncListPosition();
    }, { passive: true });
  });
  if (dropdownFixed) {
    window.addEventListener('resize', syncListPosition, { passive: true });
  }

  function selectProduct(id, product) {
    selectedId = id || '';
    selectedPool = '';
    input.value = product?.name || '';
    list.hidden = true;
    resetListPosition();
    syncPackDisplay();
    onFilter?.(input.value);
    onSelect?.({ productId: id, poolName: null, product });
  }

  function selectPool(pool) {
    selectedId = '';
    selectedPool = pool?.name || '';
    input.value = pool?.name || '';
    list.hidden = true;
    resetListPosition();
    syncPackDisplay();
    onFilter?.(input.value);
    onSelect?.({ productId: null, poolName: pool?.name || null, product: null });
  }

  function openCreateModal(initialName) {
    const name = initialName.trim();
    list.hidden = true;

    const modal = openModal({
      title: 'New product',
      bodyHtml: `
        <div class="admin-drawer-form product-create-form">
          <div class="admin-field">
            <label class="admin-label" for="psCreateName">Name</label>
            <input type="text" class="admin-input" id="psCreateName" value="${escapeHtml(name)}" required>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="psCreateCategory">Category</label>
            <select class="admin-select" id="psCreateCategory">
              <option value="">— Optional —</option>
              ${categoryOptionsHtml(categories)}
            </select>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="psCreateCase">Case size</label>
            <select class="admin-select" id="psCreateCase">
              <option value="">— Optional —</option>
              ${caseSizeOptionsHtml(caseSizes)}
            </select>
          </div>
          <div class="del-form-err" id="psCreateErr"></div>
        </div>`,
      footHtml: `
        <div class="admin-modal-actions">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" id="psCreateCancel">Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" id="psCreateSubmit">Create &amp; add</button>
        </div>`,
    });

    const nameEl = modal.querySelector('#psCreateName');
    const errEl = modal.querySelector('#psCreateErr');
    const submitBtn = modal.querySelector('#psCreateSubmit');

    modal.querySelector('#psCreateCancel')?.addEventListener('click', closeModal);

    submitBtn?.addEventListener('click', async () => {
      const nameVal = nameEl?.value.trim();
      if (!nameVal) {
        if (errEl) errEl.textContent = 'Product name is required.';
        nameEl?.focus();
        return;
      }
      if (!onCreateProduct) return;

      if (errEl) errEl.textContent = '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating…';
      }

      try {
        const categoryId = modal.querySelector('#psCreateCategory')?.value || null;
        const caseSizeId = modal.querySelector('#psCreateCase')?.value || null;
        const result = await onCreateProduct({
          name: nameVal,
          category_id: categoryId,
          case_size_id: caseSizeId,
        });
        if (result?.product) {
          items = items.some((p) => p._productId === result.productId)
            ? items
            : [...items, { ...result.product, _productId: result.productId }];
        }
        closeModal();
        selectProduct(result.productId, result.product);
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'Could not create product.';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create & add';
        }
      }
    });

    nameEl?.focus();
    nameEl?.select();
  }

  function renderList(q = '') {
    const query = q.trim().toLowerCase();
    const filteredPools = poolItems.filter((p) => {
      if (!query) return true;
      return `${p.name} ${p.meta} ${p.searchText} volume pool`.toLowerCase().includes(query);
    });
    const filteredProducts = items.filter((p) => {
      if (!query) return true;
      const hay = [p.name, p.sku, p.barcode, p.case_size, productStockPack(p, caseSizes).label, p.category?.name, offerSummary(p)].join(' ').toLowerCase();
      return hay.includes(query);
    }).slice(0, 40);

    if (!filteredPools.length && !filteredProducts.length) {
      if (allowCreate && q.trim()) {
        list.innerHTML = `
          <div class="product-search-empty">No products match “${escapeHtml(q.trim())}”</div>
          <button type="button" class="product-search-item product-search-create-trigger">
            <span class="product-search-name">+ Create “${escapeHtml(q.trim())}”</span>
            <span class="product-search-meta">Add to library and this delivery</span>
          </button>`;
      } else {
        list.innerHTML = '<div class="product-search-empty">No matches</div>';
      }
    } else {
      const poolHtml = filteredPools.map((p) => {
        const selected = selectedPool && (p.name === selectedPool || p.key === selectedPool.toLowerCase())
          ? ' selected'
          : '';
        return `<button type="button" class="product-search-item product-search-item--pool${selected}" data-pool="${escapeHtml(p.name)}">
          <span class="product-search-name">${escapeHtml(p.name)}</span>
          <span class="product-search-meta">${escapeHtml(p.meta || 'Volume pool')}</span>
        </button>`;
      }).join('');

      const productHtml = filteredProducts.map((p) => {
        const pack = productStockPack(p, caseSizes);
        const selected = p._productId === selectedId ? ' selected' : '';
        const barcodeMeta = p.barcode ? ` · ${p.barcode}` : '';
        const packLabel = pack.label || p.case_size || '';
        const meta = `${packLabel}${barcodeMeta}${offerSummary(p) ? ' · ' + offerSummary(p) : ''}`.replace(/^ · /, '');
        return `<button type="button" class="product-search-item${selected}" data-id="${escapeHtml(p._productId)}">
          <span class="product-search-name">${escapeHtml(p.name)}</span>
          <span class="product-search-meta">${escapeHtml(meta)}</span>
        </button>`;
      }).join('');

      list.innerHTML = poolHtml + productHtml;
    }
    list.hidden = false;
    syncListPosition();
  }

  input.addEventListener('focus', () => {
    syncPackDisplay({ editing: true });
    renderList(input.value);
  });
  input.addEventListener('input', () => {
    if (!input.value.trim()) {
      selectedId = '';
      selectedPool = '';
    }
    syncPackDisplay({ editing: true });
    renderList(input.value);
    onFilter?.(input.value);
  });
  input.addEventListener('blur', () => {
    window.setTimeout(() => syncPackDisplay(), 0);
  });

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  list.addEventListener('click', (e) => {
    if (e.target.closest('.product-search-create-trigger')) {
      e.stopPropagation();
      openCreateModal(input.value);
      return;
    }
    const poolBtn = e.target.closest('[data-pool]');
    if (poolBtn) {
      const pool = poolItems.find((p) => p.name === poolBtn.dataset.pool);
      if (pool) selectPool(pool);
      return;
    }
    const btn = e.target.closest('.product-search-item');
    if (!btn) return;
    const id = btn.dataset.id;
    const product = items.find((p) => p._productId === id);
    selectProduct(id, product);
  });

  document.addEventListener('click', (e) => {
    if (root.contains(e.target) || list.contains(e.target)) return;
    list.hidden = true;
    resetListPosition();
    syncPackDisplay();
  });

  if (selectedPool) {
    const pool = selectedPoolItem();
    if (pool) input.value = pool.name;
  } else if (value) {
    const sel = items.find((p) => p._productId === value);
    if (sel) input.value = sel.name;
  }
  syncPackDisplay();

  container.innerHTML = '';
  container.appendChild(root);
  return root;
}
