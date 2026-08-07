/**
 * Admin warehouses panel — stock on hand + transfer log per warehouse.
 */

import { $, escapeHtml, toast, fmtDateTime } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { getDB, loadCaseSizes, loadEventsList, loadKitLibraryProducts } from '../../db.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { storedToForm, parseQty } from '../../stock-entry.js';
import { productStockPack } from '../../pack-metrics.js';
import { round1 } from '../../lib/opening-stock.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { mountProductSearch } from '../../components/product-search.js';
import { confirmDialog } from '../../components/modal.js';

const WH_STORAGE_KEY = 'v5_warehouse';

function addressPreview(address) {
  const line = String(address || '').split('\n').map((s) => s.trim()).find(Boolean);
  return line || '';
}

function colourKey(cat) {
  const key = cat?.colour_key || String(cat?.name || '').toLowerCase();
  if (key.includes('beer')) return 'beer';
  if (key.includes('cider')) return 'cider';
  if (key.includes('wine')) return 'wine';
  if (key.includes('spirit')) return 'spirits';
  if (key.includes('soft') || key.includes('seltzer') || key.includes('water')) return 'softs';
  if (['beer', 'cider', 'wine', 'rtd', 'softs', 'spirits'].includes(key)) return key;
  return 'rtd';
}

function categoryBadge(cat) {
  if (!cat?.name) return '<span class="muted">—</span>';
  const key = colourKey(cat);
  return `<span class="cat-badge cat-badge--${escapeHtml(key)}">${escapeHtml(cat.name)}</span>`;
}

function lineQtyLabel(line, caseSizes) {
  const p = line?.product || {};
  const form = storedToForm(line);
  const pack = productStockPack(p, caseSizes);
  const unit = pack?.stockUnit === 'bottle' ? 'bottle'
    : pack?.stockUnit === 'keg' ? 'keg'
      : 'case';
  const parts = [];
  if (form.cases) {
    const n = Number(form.cases) || 0;
    parts.push(`${form.cases} ${n === 1 ? unit : `${unit}s`}`);
  }
  if (form.singles) {
    const n = Number(form.singles) || 0;
    parts.push(`${form.singles} ${n === 1 ? 'single' : 'singles'}`);
  }
  return parts.join(' · ') || '—';
}

function eventNameById(events, id) {
  if (!id) return 'event';
  const ev = (events || []).find((e) => e.id === id);
  return ev?.name || 'event';
}

function warehouseNameById(warehouses, id) {
  const w = (warehouses || []).find((x) => x.id === id);
  return w?.name || 'Warehouse';
}

function transferOtherLabel(t, warehouseId, warehouses, events) {
  const inbound = t.to_warehouse_id === warehouseId;
  if (inbound) {
    if (t.from_warehouse_id) return `from ${warehouseNameById(warehouses, t.from_warehouse_id)}`;
    if (t.from_event_id) return `from ${eventNameById(events, t.from_event_id)}`;
    return 'in';
  }
  if (t.to_warehouse_id && t.to_warehouse_id !== warehouseId) {
    return `to ${warehouseNameById(warehouses, t.to_warehouse_id)}`;
  }
  if (t.recipients?.name) return `to ${t.recipients.name}`;
  if (t.recipient_id) return 'to recipient';
  if (t.to_event_id) return `to ${eventNameById(events, t.to_event_id)}`;
  return 'out';
}

function renderShell() {
  return `
    <div class="admin-page wh-panel">
      <div class="catalog-layout">
        <aside class="catalog-list-card admin-surface">
          <div class="catalog-list-head">
            <input type="search" class="admin-input" id="whSearch"
              placeholder="Search warehouses…" autocomplete="off" aria-label="Search warehouses">
          </div>
          <div class="catalog-list" id="whList">
            <div class="catalog-list-empty muted">Loading warehouses…</div>
          </div>
        </aside>
        <section class="catalog-detail admin-surface" id="whDetail">
          <div class="catalog-detail-empty" id="whDetailEmpty">
            ${icon('warehouse', { size: 32, strokeWidth: 1.5 })}
            <p>Select a warehouse to view stock, or add one from the toolbar.</p>
          </div>
          <div id="whDetailBody" hidden></div>
        </section>
      </div>
    </div>`;
}

function renderListItems(warehouses, selectedId, query) {
  const q = (query || '').trim().toLowerCase();
  const list = (warehouses || [])
    .filter((w) => {
      if (!q) return true;
      return [w.name, w.address].join(' ').toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (!list.length) {
    return `<div class="catalog-list-empty">${warehouses?.length
      ? 'No warehouses match your search.'
      : 'No warehouses yet. Add your first one.'}</div>`;
  }

  return list.map((w) => {
    const active = w.id === selectedId ? ' catalog-list-item--active' : '';
    const addr = addressPreview(w.address);
    return `
      <button type="button" class="catalog-list-item${active}" data-wh-id="${escapeHtml(w.id)}">
        <span class="catalog-list-name">${escapeHtml(w.name || 'Warehouse')}</span>
        <span class="catalog-list-meta">${addr ? escapeHtml(addr) : 'No address'}</span>
      </button>`;
  }).join('');
}

function renderStockTable(stockRows, caseSizes, kind) {
  const isKit = kind === 'kit';
  const stock = (stockRows || [])
    .filter((s) => {
      if ((Number(s.qty_on_hand) || 0) <= 0) return false;
      const pk = s.product?.product_kind || 'stock';
      return isKit ? pk === 'kit' : pk !== 'kit';
    })
    .slice()
    .sort((a, b) => {
      const an = a.product?.name || '';
      const bn = b.product?.name || '';
      return an.localeCompare(bn);
    });

  if (!stock.length) {
    return `
      <div class="catalog-list-empty">
        ${isKit
          ? 'No kit in this warehouse yet. Count kit back from an event, or count out later once stock is held here.'
          : 'No stock in this warehouse yet. Transfer stock in from an event or another warehouse.'}
      </div>`;
  }

  return `
    <div class="catalog-table-wrap">
      <table class="catalog-table wh-stock-table">
        <thead>
          <tr>
            <th>${isKit ? 'Item' : 'Product'}</th>
            ${isKit ? '' : '<th>Pack size</th>'}
            <th>Category</th>
            <th class="num">Qty on hand</th>
            <th>Last updated</th>
          </tr>
        </thead>
        <tbody>
          ${stock.map((s) => {
            const p = s.product || {};
            const pack = productStockPack(p, caseSizes);
            const packLabel = pack?.label || p.case_size || '—';
            const updated = s.last_updated
              ? fmtDateTime(s.last_updated)
              : '—';
            return `<tr>
              <td><span class="catalog-table-primary">${escapeHtml(p.name || (isKit ? 'Item' : 'Product'))}</span></td>
              ${isKit ? '' : `<td>${escapeHtml(packLabel)}</td>`}
              <td>${categoryBadge(p.category)}</td>
              <td class="num">${escapeHtml(String(round1(s.qty_on_hand)))}</td>
              <td class="muted">${escapeHtml(updated)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderTransferLog(transfers, warehouseId, warehouses, events, caseSizes) {
  const xfers = transfers || [];
  if (!xfers.length) {
    return '<div class="catalog-list-empty">No warehouse transfers yet.</div>';
  }

  return `
    <div class="wh-xfer-log">
      ${xfers.map((t) => {
        const inbound = t.to_warehouse_id === warehouseId;
        const dir = inbound ? 'IN' : 'OUT';
        const dirCls = inbound ? 'wh-xfer-dir--in' : 'wh-xfer-dir--out';
        const other = transferOtherLabel(t, warehouseId, warehouses, events);
        const lines = t.lines || [];
        const lineRows = lines.length
          ? lines.map((l) => {
            const name = l.product?.name || 'Product';
            const qty = lineQtyLabel(l, caseSizes);
            return `
              <div class="wh-xfer-line">
                <span class="wh-xfer-line-name">${escapeHtml(name)}</span>
                <span class="wh-xfer-line-qty">${escapeHtml(qty)}</span>
              </div>`;
          }).join('')
          : '<div class="muted" style="font-size:12px">No items</div>';

        return `
          <article class="wh-xfer-item">
            <div class="wh-xfer-head">
              <div class="wh-xfer-title">
                <span class="wh-xfer-dir ${dirCls}">${dir}</span>
                <span>${escapeHtml(other)}</span>
              </div>
              <span class="wh-xfer-time muted">${escapeHtml(fmtDateTime(t.transferred_at))}</span>
            </div>
            <div class="wh-xfer-lines">${lineRows}</div>
          </article>`;
      }).join('')}
    </div>`;
}

function renderDetail(w, stockRows, transfers, warehouses, events, caseSizes, kind = 'stock') {
  if (!w) return '';

  const isKit = kind === 'kit';
  const stock = (stockRows || []).filter((s) => {
    if ((Number(s.qty_on_hand) || 0) <= 0) return false;
    const pk = s.product?.product_kind || 'stock';
    return isKit ? pk === 'kit' : pk !== 'kit';
  });
  const totalQty = round1(stock.reduce((n, s) => n + (Number(s.qty_on_hand) || 0), 0));
  const addr = (w.address || '').trim();
  const xferCount = (transfers || []).length;

  return `
    <div class="catalog-detail-head">
      <div class="catalog-detail-head-main">
        <h2 class="del-card-pill-title"><span class="del-card-pill-name">${escapeHtml(w.name || 'Warehouse')}</span></h2>
        <p class="catalog-detail-meta">
          ${addr ? escapeHtml(addressPreview(addr)) : 'No address set'}
        </p>
      </div>
      <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="whEditBtn"
        title="Edit warehouse" aria-label="Edit warehouse">
        ${icon('pencil', { size: 16, strokeWidth: 2.5 })}<span>Edit</span>
      </button>
    </div>

    <div class="wh-kind-tabs" role="tablist" aria-label="Stock or kit">
      <button type="button" class="wh-kind-tab${kind === 'stock' ? ' wh-kind-tab--active' : ''}"
        data-wh-kind="stock" role="tab" aria-selected="${kind === 'stock'}">Stock</button>
      <button type="button" class="wh-kind-tab${kind === 'kit' ? ' wh-kind-tab--active' : ''}"
        data-wh-kind="kit" role="tab" aria-selected="${kind === 'kit'}">Kit</button>
    </div>

    ${isKit ? `
    <div class="wh-kit-actions">
      <button type="button" class="topbar-tool topbar-tool--label topbar-tool--primary" id="whReceiveKitBtn"
        title="Receive kit into warehouse">
        ${icon('plus', { size: 16, strokeWidth: 2.5 })}<span>Receive kit</span>
      </button>
    </div>` : ''}

    <div class="wh-stats">
      <div class="wh-stat">
        <div class="wh-stat-label">${isKit ? 'Kit SKUs' : 'SKUs in stock'}</div>
        <div class="wh-stat-value">${stock.length}</div>
        <div class="wh-stat-sub muted">${isKit ? 'Items with qty &gt; 0' : 'Products with qty &gt; 0'}</div>
      </div>
      <div class="wh-stat">
        <div class="wh-stat-label">${isKit ? 'Total units on hand' : 'Total cases on hand'}</div>
        <div class="wh-stat-value">${escapeHtml(String(totalQty))}</div>
        <div class="wh-stat-sub muted">Across all SKUs</div>
      </div>
    </div>

    <div class="catalog-detail-section">
      <h3 class="catalog-section-title">${isKit ? 'Kit on hand' : 'Stock on hand'}</h3>
      ${renderStockTable(stockRows, caseSizes, kind)}
    </div>

    ${isKit ? '' : `
    <div class="catalog-detail-section">
      <div class="wh-section-head">
        <h3 class="catalog-section-title">Transfer log</h3>
        <span class="muted" style="font-size:12px">${xferCount
          ? `${xferCount} transfer${xferCount === 1 ? '' : 's'}`
          : ''}</span>
      </div>
      ${renderTransferLog(transfers, w.id, warehouses, events, caseSizes)}
    </div>`}
    ${isKit ? `
    <div class="catalog-detail-section">
      <p class="wst-form-hint muted">Kit moves in and out via the event <strong>Kit</strong> tab (count in / return to warehouse).</p>
    </div>` : ''}`;
}

export function renderWarehousesShell() {
  return renderShell();
}

export function mountWarehousesPanel() {
  const listEl = $('whList');
  const detailEmpty = $('whDetailEmpty');
  const detailBody = $('whDetailBody');
  const searchEl = $('whSearch');
  if (!listEl || !detailEmpty || !detailBody) return () => {};

  let warehouses = [];
  let events = [];
  let caseSizes = [];
  let selectedId = null;
  let searchQuery = '';
  let stockRows = [];
  let transfers = [];
  let detailLoading = false;
  let stockKind = 'stock';

  function rememberId(id) {
    try {
      if (id) localStorage.setItem(WH_STORAGE_KEY, id);
      else localStorage.removeItem(WH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function rememberedId() {
    try {
      return localStorage.getItem(WH_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function paintList() {
    listEl.innerHTML = renderListItems(warehouses, selectedId, searchQuery);
    listEl.querySelectorAll('[data-wh-id]').forEach((btn) => {
      btn.onclick = () => selectWarehouse(btn.dataset.whId);
    });
  }

  function paintDetail() {
    const w = warehouses.find((x) => x.id === selectedId) || null;
    if (!w) {
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      detailBody.innerHTML = '';
      return;
    }

    detailEmpty.hidden = true;
    detailBody.hidden = false;

    if (detailLoading) {
      detailBody.innerHTML = '<div class="catalog-list-empty muted">Loading stock…</div>';
      return;
    }

    detailBody.innerHTML = renderDetail(
      w, stockRows, transfers, warehouses, events, caseSizes, stockKind,
    );
    $('whEditBtn')?.addEventListener('click', () => openWarehouseForm(w.id));
    detailBody.querySelectorAll('[data-wh-kind]').forEach((btn) => {
      btn.onclick = () => {
        stockKind = btn.dataset.whKind === 'kit' ? 'kit' : 'stock';
        paintDetail();
      };
    });
    $('whReceiveKitBtn')?.addEventListener('click', () => openReceiveKit(w.id));
  }

  async function openReceiveKit(warehouseId) {
    let kitProducts = [];
    try {
      kitProducts = await loadKitLibraryProducts();
    } catch {
      kitProducts = [];
    }
    if (!kitProducts.length) {
      toast('Add kit items in Kit library first.', true);
      return;
    }

    let selectedId = kitProducts[0]?.id || '';
    openSheet({
      title: 'Receive kit into warehouse',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="whKitErr"></div>
          <div class="admin-field">
            <label class="admin-label">Kit item</label>
            <div id="whKitSearch"></div>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="whKitQty">Quantity to add</label>
            <input class="admin-input num-math" type="text" inputmode="decimal" id="whKitQty" value="1" placeholder="1">
          </div>
          <p class="wst-form-hint muted">Increases warehouse on-hand. Use the event Kit tab to count kit out to a show.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          <span></span>
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="whKitCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="whKitSave">Receive</button>
          </div>
        </div>`,
    });

    mountProductSearch($('whKitSearch'), {
      products: kitProducts,
      value: selectedId,
      placeholder: 'Search kit library…',
      onSelect: ({ productId }) => { selectedId = productId; },
    });

    $('whKitCancel').onclick = closeSheet;
    $('whKitSave').onclick = async () => {
      if (!selectedId) {
        $('whKitErr').textContent = 'Pick a kit item.';
        return;
      }
      const qty = parseQty($('whKitQty')?.value || '');
      if (!Number.isFinite(qty) || qty <= 0) {
        $('whKitErr').textContent = 'Enter a quantity greater than zero.';
        return;
      }
      const DB = getDB();
      const btn = $('whKitSave');
      btn.disabled = true;
      try {
        const rows = await DB.select(
          'warehouse_stock',
          '?warehouse_id=eq.' + DB._.enc(warehouseId) +
          '&product_id=eq.' + DB._.enc(selectedId) +
          '&select=qty_on_hand',
        );
        const current = rows?.[0] ? Number(rows[0].qty_on_hand) || 0 : 0;
        await DB.warehouseStock.setQty(warehouseId, selectedId, round1(current + qty));
        closeSheet();
        await loadDetail(warehouseId);
        toast('Kit received into warehouse');
      } catch (err) {
        $('whKitErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };
  }

  async function loadDetail(warehouseId) {
    if (!warehouseId) {
      stockRows = [];
      transfers = [];
      paintDetail();
      return;
    }

    detailLoading = true;
    paintDetail();

    const DB = getDB();
    const enc = DB._.enc;
    try {
      const [stock, xfers] = await Promise.all([
        DB.select(
          'warehouse_stock',
          '?warehouse_id=eq.' + enc(warehouseId) +
          '&select=*,product:products(id,name,case_size,case_size_id,stock_case_size_id,units_per_case,stock_unit,product_kind,category:categories(id,name,colour_key))',
        ),
        DB.select(
          'transfers',
          '?or=(from_warehouse_id.eq.' + enc(warehouseId) + ',to_warehouse_id.eq.' + enc(warehouseId) + ')' +
          '&select=*,recipients(id,name),lines:transfer_lines(*,product:products(id,name,case_size,case_size_id,stock_case_size_id,units_per_case,stock_unit))' +
          '&order=transferred_at.desc',
        ),
      ]);
      if (selectedId !== warehouseId) return;
      stockRows = stock || [];
      transfers = xfers || [];
    } catch (err) {
      if (selectedId !== warehouseId) return;
      stockRows = [];
      transfers = [];
      detailLoading = false;
      detailEmpty.hidden = true;
      detailBody.hidden = false;
      detailBody.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
      return;
    }

    detailLoading = false;
    paintDetail();
  }

  async function selectWarehouse(id) {
    selectedId = id || null;
    rememberId(selectedId);
    paintList();
    await loadDetail(selectedId);
  }

  async function refreshList({ preferId } = {}) {
    const [wh, ev, cs] = await Promise.all([
      getDB().warehouses.list(),
      loadEventsList(),
      loadCaseSizes(),
    ]);
    warehouses = wh || [];
    events = ev || [];
    caseSizes = cs || [];

    const want = preferId || selectedId || rememberedId();
    if (want && warehouses.some((w) => w.id === want)) {
      selectedId = want;
    } else {
      selectedId = warehouses[0]?.id || null;
    }
    rememberId(selectedId);
    paintList();
    await loadDetail(selectedId);
  }

  function openWarehouseForm(editId) {
    const w = editId ? warehouses.find((x) => x.id === editId) : null;

    openSheet({
      title: w ? 'Edit warehouse' : 'New warehouse',
      variant: 'admin-full',
      bodyHtml: `
        <div class="admin-drawer-form">
          <div class="del-form-err" id="whFormErr"></div>
          <div class="admin-field">
            <label class="admin-label" for="whFormName">Name</label>
            <input class="admin-input" type="text" id="whFormName" required placeholder="e.g. Main Depot">
          </div>
          <div class="admin-field">
            <label class="admin-label" for="whFormAddress">Address</label>
            <textarea class="admin-textarea" id="whFormAddress" rows="3" placeholder="Street, City, Postcode"></textarea>
          </div>
          <p class="wst-form-hint muted">Stock moves in and out of warehouses via Transfers on an event.</p>
        </div>`,
      footHtml: `
        <div class="admin-drawer-foot admin-drawer-foot--split">
          ${w ? '<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="whFormDelete">Delete</button>' : '<span></span>'}
          <div class="admin-drawer-foot-actions">
            <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="whFormCancel">Cancel</button>
            <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="whFormSave">${w ? 'Update warehouse' : 'Save warehouse'}</button>
          </div>
        </div>`,
    });

    if (w) {
      $('whFormName').value = w.name || '';
      $('whFormAddress').value = w.address || '';
    }

    $('whFormCancel').onclick = closeSheet;
    $('whFormSave').onclick = async () => {
      const name = ($('whFormName')?.value || '').trim();
      if (!name) {
        $('whFormErr').textContent = 'Name is required.';
        return;
      }
      const dupe = warehouses.find((x) =>
        (x.name || '').toLowerCase() === name.toLowerCase() && (!w || x.id !== w.id));
      if (dupe) {
        $('whFormErr').textContent = 'A warehouse with that name already exists.';
        return;
      }
      const patch = {
        name,
        address: ($('whFormAddress')?.value || '').trim() || null,
      };
      const btn = $('whFormSave');
      btn.disabled = true;
      try {
        const DB = getDB();
        let createdId = w?.id || null;
        if (w) await DB.warehouses.update(w.id, patch);
        else {
          const created = await DB.warehouses.create(patch);
          createdId = created?.id || null;
        }
        closeSheet();
        await refreshList({ preferId: createdId });
        toast(w ? 'Warehouse updated' : 'Warehouse created');
      } catch (err) {
        $('whFormErr').textContent = err.message || 'Save failed';
      } finally {
        btn.disabled = false;
      }
    };

    if (w) {
      $('whFormDelete').onclick = async () => {
        const DB = getDB();
        const enc = DB._.enc;
        try {
          const hasStock = (stockRows || []).some((s) =>
            s.warehouse_id === w.id && (Number(s.qty_on_hand) || 0) > 0);
          if (hasStock && !await confirmDialog({ title: 'Confirm', message: 'This warehouse still holds stock. Delete anyway?', confirmLabel: 'Delete', danger: true })) return;

          const xferRows = await DB.select(
            'transfers',
            '?or=(from_warehouse_id.eq.' + enc(w.id) + ',to_warehouse_id.eq.' + enc(w.id) + ')&select=id',
          );
          const xferCount = (xferRows || []).length;
          if (xferCount && !await confirmDialog({ title: 'Confirm', message: `This warehouse is referenced by ${xferCount} transfer${xferCount === 1 ? '' : 's'}. ` +
            'Delete anyway? Transfer records will be kept but no longer linked to this warehouse.', confirmLabel: 'Delete', danger: true })) return;

          if (!hasStock && !xferCount && !await confirmDialog({ title: 'Confirm', message: `Delete “${w.name}”? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return;

          await DB.warehouses.remove(w.id);
          closeSheet();
          if (selectedId === w.id) {
            selectedId = null;
            rememberId(null);
          }
          await refreshList();
          toast('Warehouse deleted');
        } catch (err) {
          const msg = String(err?.message || err);
          if (/23503/.test(msg) && /warehouse/i.test(msg)) {
            toast('Can’t delete — transfers still reference this warehouse.', true);
          } else {
            toast(err.message || 'Delete failed', true);
          }
        }
      };
    }
  }

  function onToolbarAction(e) {
    if (e.detail?.action !== 'new-warehouse') return;
    e.detail.handled = true;
    openWarehouseForm(null);
  }

  searchEl?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    paintList();
  });

  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);

  refreshList().catch((err) => {
    listEl.innerHTML = `<div class="catalog-list-empty del-empty--err">${escapeHtml(err.message || 'Failed to load')}</div>`;
  });

  return () => {
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  };
}
