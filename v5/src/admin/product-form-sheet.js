/**
 * Shared product catalogue edit/create drawer (Library + event Products).
 */

import { $, escapeHtml, rid, toast } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { getDB } from '../db.js';
import { openSheet, closeSheet } from '../components/sheet.js';

function displayOfferPrice(row) {
  if (row?.case_price != null) return row.case_price;
  if (row?.unit_price != null) return row.unit_price;
  return '';
}

function splitOfferPrice(price, unitsPerCase) {
  if (price == null || price === '' || !Number.isFinite(Number(price))) {
    return { case_price: null, unit_price: null };
  }
  const n = Number(price);
  const upc = Number(unitsPerCase) > 0 ? Number(unitsPerCase) : 1;
  return { case_price: n, unit_price: n / upc };
}

function caseSizeSummary(cs) {
  if (!cs) return '';
  const parts = [];
  if (cs.units_per_case) parts.push(`${cs.units_per_case} per case`);
  if (cs.stock_unit) parts.push(cs.stock_unit);
  if (cs.servings_per_unit != null) parts.push(`${cs.servings_per_unit} servings`);
  return parts.join(' · ') || cs.label || '';
}

/**
 * @param {object} opts
 * @param {object|null} [opts.product]
 * @param {object[]} opts.categories
 * @param {object[]} opts.suppliers
 * @param {object[]} opts.caseSizes
 * @param {boolean} [opts.allowDelete]
 * @param {(result: { productId: string, created: boolean, product: object }) => void|Promise<void>} [opts.onSaved]
 * @param {(productId: string) => void|Promise<void>} [opts.onDeleted]
 * @param {object|null} [opts.eventContext] — when set, also edits event cases ordered
 * @param {number|string|null} [opts.eventContext.qtyOrdered]
 * @param {string} [opts.eventContext.countedIn]
 * @param {string} [opts.eventContext.variance]
 * @param {string} [opts.eventContext.opening]
 * @param {() => void|Promise<void>} [opts.eventContext.onRemoveFromEvent]
 */
export function openProductFormSheet(opts) {
  const {
    product: p = null,
    categories = [],
    suppliers = [],
    caseSizes = [],
    allowDelete = false,
    onSaved,
    onDeleted,
    eventContext = null,
  } = opts || {};

  const offerPrefName = `libPref_${rid('p')}`;
  const offerLines = p ? (p.product_suppliers || []).map((r) => ({ ...r })) : [];

  const catOpts = [
    '<option value="">— none —</option>',
    ...categories.map((c) =>
      `<option value="${escapeHtml(c.id)}"${c.id === p?.category_id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`),
  ].join('');

  const csOpts = [
    '<option value="">— custom / manual —</option>',
    ...caseSizes.slice().sort((a, b) =>
      (a.sort_order - b.sort_order) || (a.label || '').localeCompare(b.label || ''))
      .map((cs) =>
        `<option value="${escapeHtml(cs.id)}"${cs.id === (p?.case_size_id || p?.stock_case_size_id) ? ' selected' : ''}>${escapeHtml(cs.label)} — ${escapeHtml(caseSizeSummary(cs))}</option>`),
  ].join('');

  const eventBlock = eventContext
    ? `
      <div class="admin-field">
        <label class="admin-label" for="epEditOrdered">Cases ordered</label>
        <input class="admin-input" type="text" inputmode="decimal" id="epEditOrdered"
          value="${eventContext.qtyOrdered != null && eventContext.qtyOrdered !== '' ? escapeHtml(String(eventContext.qtyOrdered)) : ''}"
          placeholder="0">
      </div>
      <div class="admin-field-grid">
        <div class="admin-field">
          <span class="admin-label">Counted in</span>
          <div class="ep-edit-stat">${escapeHtml(eventContext.countedIn ?? '—')}</div>
        </div>
        <div class="admin-field">
          <span class="admin-label">Variance</span>
          <div class="ep-edit-stat">${escapeHtml(eventContext.variance ?? '—')}</div>
        </div>
        <div class="admin-field">
          <span class="admin-label">Opening</span>
          <div class="ep-edit-stat">${escapeHtml(eventContext.opening ?? '—')}</div>
        </div>
      </div>
      <p class="wst-form-hint muted">Counted in and opening come from deliveries.</p>`
    : '';

  const dangerLabel = eventContext
    ? 'Remove from event'
    : (allowDelete && p ? 'Delete' : null);

  openSheet({
    title: p ? 'Edit product' : 'New product',
    variant: 'admin-full',
    bodyHtml: `
      <div class="admin-drawer-form">
        <div class="del-form-err" id="libErr"></div>
        <div class="admin-field">
          <label class="admin-label" for="libName">Name</label>
          <input class="admin-input" type="text" id="libName" required placeholder="Product name">
        </div>
        <div class="admin-field-grid">
          <div class="admin-field">
            <label class="admin-label" for="libCategoryId">Category</label>
            <select class="admin-select" id="libCategoryId">${catOpts}</select>
          </div>
          <div class="admin-field">
            <label class="admin-label" for="libSku">SKU</label>
            <input class="admin-input" type="text" id="libSku" placeholder="Optional">
          </div>
        </div>
        <div class="admin-field">
          <label class="admin-label" for="libCaseSizeId">Standard case size</label>
          <select class="admin-select" id="libCaseSizeId">${csOpts}</select>
          <p class="wst-form-hint muted">Stock pack, units per case, count-as, and servings per unit come from the catalogue.</p>
        </div>
        <div class="admin-field">
          <label class="admin-label" for="libAbv">ABV (%)</label>
          <input class="admin-input" type="number" min="0" step="any" id="libAbv" placeholder="Optional">
        </div>
        <div class="admin-field">
          <label class="admin-label" for="libPoolName">Volume pool</label>
          <input class="admin-input" type="text" id="libPoolName" placeholder="e.g. House Vodka">
          <p class="wst-form-hint muted">Optional group for shared bottle stock across products.</p>
        </div>
        <div class="admin-field">
          <span class="admin-label">Suppliers &amp; prices</span>
          <p class="wst-form-hint muted">One row per supplier. Price is per case (or per bottle/keg for singles).</p>
          <div id="libOffers" class="lib-offers"></div>
          <button type="button" class="admin-drawer-btn" id="libAddOffer">+ Add supplier</button>
        </div>
        ${eventBlock}
      </div>`,
    footHtml: `
      <div class="admin-drawer-foot admin-drawer-foot--split">
        ${dangerLabel
          ? `<button class="admin-drawer-btn admin-drawer-btn--danger" type="button" id="libDanger">${escapeHtml(dangerLabel)}</button>`
          : '<span></span>'}
        <div class="admin-drawer-foot-actions">
          <button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="libCancel">Cancel</button>
          <button class="admin-drawer-btn admin-drawer-btn--primary" type="button" id="libSave">${p ? 'Update product' : 'Save product'}</button>
        </div>
      </div>`,
  });

  if (p) {
    $('libName').value = p.name || '';
    $('libSku').value = p.sku || '';
    $('libAbv').value = p.abv != null ? String(p.abv) : '';
    $('libPoolName').value = p.pool_name || '';
  }

  function offerRowHtml(row = {}) {
    const supOpts = suppliers.map((s) =>
      `<option value="${escapeHtml(s.id)}"${s.id === row.supplier_id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    const priceVal = displayOfferPrice(row);
    return `
      <div class="lib-offer-row" data-offer-id="${rid('o')}">
        <select class="admin-select lib-offer-sup">
          <option value="">— supplier —</option>
          ${supOpts}
        </select>
        <input type="number" step="any" min="0" class="admin-input lib-offer-price" placeholder="Price £"
          value="${priceVal !== '' ? escapeHtml(String(priceVal)) : ''}">
        <label class="lib-offer-pref" title="Preferred purchase option">
          <input type="radio" name="${escapeHtml(offerPrefName)}"${row.is_preferred ? ' checked' : ''}>
          <span>Pref</span>
        </label>
        <button type="button" class="topbar-tool lib-offer-remove" aria-label="Remove offer">
          ${icon('x', { size: 14 })}
        </button>
      </div>`;
  }

  function wireOfferRows() {
    const wrap = $('libOffers');
    if (!wrap) return;
    wrap.querySelectorAll('.lib-offer-remove').forEach((btn) => {
      btn.onclick = () => {
        const row = btn.closest('.lib-offer-row');
        const wasPref = row?.querySelector('.lib-offer-pref input')?.checked;
        row?.remove();
        if (wasPref) {
          const first = wrap.querySelector('.lib-offer-pref input');
          if (first) first.checked = true;
        }
        if (!wrap.querySelector('.lib-offer-row')) addOfferRow({ is_preferred: true });
      };
    });
  }

  function addOfferRow(row = {}) {
    const wrap = $('libOffers');
    if (!wrap) return;
    wrap.insertAdjacentHTML('beforeend', offerRowHtml(row));
    wireOfferRows();
  }

  function collectOffers() {
    const wrap = $('libOffers');
    const out = [];
    wrap?.querySelectorAll('.lib-offer-row').forEach((row) => {
      const supplier_id = row.querySelector('.lib-offer-sup')?.value || '';
      const priceV = (row.querySelector('.lib-offer-price')?.value || '').trim();
      const is_preferred = row.querySelector('.lib-offer-pref input')?.checked;
      if (!supplier_id && !priceV) return;
      out.push({
        supplier_id,
        price: priceV === '' ? null : Number(priceV),
        is_preferred: !!is_preferred,
      });
    });
    if (out.length && !out.some((r) => r.is_preferred)) out[0].is_preferred = true;
    return out;
  }

  function validateOffers(rows) {
    if (!rows?.length) return null;
    const seen = new Set();
    for (const r of rows) {
      if (!r.supplier_id) return 'Choose a supplier for each price row (or remove empty rows).';
      const key = r.supplier_id;
      if (seen.has(key)) return 'Duplicate supplier — keep one row per supplier.';
      seen.add(key);
    }
    return null;
  }

  const offersWrap = $('libOffers');
  if (offerLines.length) {
    offerLines.slice()
      .sort((a, b) => (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0))
      .forEach((row) => addOfferRow(row));
  } else {
    addOfferRow({ is_preferred: true });
  }

  $('libAddOffer').onclick = () => {
    const first = !offersWrap.querySelector('.lib-offer-row');
    addOfferRow({ is_preferred: first });
  };
  $('libCancel').onclick = closeSheet;

  $('libSave').onclick = async () => {
    const name = ($('libName')?.value || '').trim();
    if (!name) {
      $('libErr').textContent = 'Name is required.';
      return;
    }
    const offers = collectOffers();
    const offerErr = validateOffers(offers);
    if (offerErr) {
      $('libErr').textContent = offerErr;
      return;
    }

    let qtyOrdered = null;
    if (eventContext) {
      const raw = ($('epEditOrdered')?.value || '').trim();
      qtyOrdered = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(qtyOrdered) || qtyOrdered < 0) {
        $('libErr').textContent = 'Enter a valid ordered quantity.';
        return;
      }
    }

    const caseSizeId = $('libCaseSizeId')?.value || null;
    const cs = caseSizeId ? caseSizes.find((c) => c.id === caseSizeId) : null;
    const poolName = ($('libPoolName')?.value || '').trim() || null;

    const patch = {
      name,
      category_id: $('libCategoryId')?.value || null,
      case_size_id: caseSizeId,
      case_size: cs?.label ?? p?.case_size ?? null,
      units_per_case: cs?.units_per_case != null
        ? Number(cs.units_per_case) || 1
        : (p?.units_per_case ?? 1),
      stock_unit: cs?.stock_unit ?? p?.stock_unit ?? null,
      sku: ($('libSku')?.value || '').trim() || null,
      abv: $('libAbv')?.value !== '' ? Number($('libAbv').value) : null,
      pool_name: poolName,
      pool_servings_per_unit: cs?.servings_per_unit != null
        ? Number(cs.servings_per_unit)
        : (p?.pool_servings_per_unit ?? null),
    };

    const btn = $('libSave');
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = 'Saving…';

    try {
      const DB = getDB();
      let productId = p?.id || null;
      const created = !productId;
      if (productId) {
        await DB.products.update(productId, patch);
      } else {
        const createdRow = await DB.products.create(patch);
        productId = createdRow.id;
      }
      await DB.productSuppliers.replaceForProduct(productId, offers.map((r) => {
        const prices = splitOfferPrice(r.price, patch.units_per_case);
        return {
          supplier_id: r.supplier_id,
          pack_size: (patch.case_size || '').trim(),
          units_per_case: patch.units_per_case,
          case_price: prices.case_price,
          unit_price: prices.unit_price,
          sku: null,
          is_preferred: r.is_preferred,
        };
      }));

      if (eventContext && typeof eventContext.onSaveOrdered === 'function') {
        await eventContext.onSaveOrdered(qtyOrdered);
      }

      const savedProduct = {
        ...(p || {}),
        ...patch,
        id: productId,
        category: categories.find((c) => c.id === patch.category_id) || p?.category || null,
        product_suppliers: offers.map((r) => ({
          ...r,
          supplier: suppliers.find((s) => s.id === r.supplier_id) || null,
        })),
      };

      closeSheet();
      if (onSaved) await onSaved({ productId, created, product: savedProduct, qtyOrdered });
      toast(created ? 'Product created' : 'Product updated');
    } catch (err) {
      $('libErr').textContent = err.message || 'Save failed';
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  };

  const dangerBtn = $('libDanger');
  if (dangerBtn && eventContext?.onRemoveFromEvent) {
    dangerBtn.onclick = async () => {
      if (!confirm(`Remove “${p?.name || 'this product'}” from this event?`)) return;
      try {
        await eventContext.onRemoveFromEvent();
        closeSheet();
        toast('Product removed from event');
      } catch (err) {
        $('libErr').textContent = err.message || 'Remove failed';
      }
    };
  } else if (dangerBtn && allowDelete && p && onDeleted) {
    dangerBtn.onclick = async () => {
      if (!confirm(`Delete “${p.name || 'this product'}” from your product library? This removes it from every event and cannot be undone.`)) {
        return;
      }
      try {
        await onDeleted(p.id);
        closeSheet();
        toast('Product deleted');
      } catch (err) {
        $('libErr').textContent = err.message || 'Delete failed';
      }
    };
  }

  if (eventContext) {
    $('epEditOrdered')?.focus();
    $('epEditOrdered')?.select();
  } else {
    $('libName')?.focus();
  }
}
