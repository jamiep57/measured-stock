/**
 * Price years — house menu prices per pricing season.
 *
 * Each year holds its own prices; rolling forward copies into a new year
 * and never edits the source. Locked years are read-only (DB-enforced).
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { loadCaseSizes, loadLibraryProducts } from '../../db.js';
import { openModal, closeModal, confirmDialog } from '../../components/modal.js';
import { productSupplierSearchText } from '../../components/product-search.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION, setTopbarToolbarStrips } from '../topbar-toolbar.js';
import { ADMIN_TABLE_FILTER, getTableFilterValues, setTableFilterContext } from '../table-filter.js';
import { formatGpPct } from '../../lib/gp.js';
import { parsePlanningNumber, resolveMenuLine } from '../../lib/planning-menu.js';
import {
  createPriceYear,
  deletePriceYear,
  isPlanningSchemaMissing,
  listHousePrices,
  listPriceYears,
  removeHousePrice,
  rollPriceYear,
  updatePriceYear,
  upsertHousePrice,
} from '../../lib/planning-data.js';

const YEAR_KEY = 'v5-admin-price-year';
const SAVE_DEBOUNCE_MS = 450;
const FIELDS = {
  serves_per_unit: { positive: true },
  menu_price: {},
  suggested_price: {},
  target_gp_pct: { max: 100 },
};

function money(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return `£${v.toFixed(2)}`;
}

function statusClass(status) {
  if (status === 'green') return 'lta-ok';
  if (status === 'amber') return 'plan-gp--amber';
  if (status === 'red') return 'lta-over';
  return 'lta-neutral';
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function yearStrips(year) {
  const items = [
    { id: 'price-year-new', icon: 'plus', label: 'New year', title: 'Create a price year', primary: true },
  ];
  if (year) {
    items.push(
      { id: 'price-year-roll', icon: 'copy', label: 'Roll forward', title: 'Copy this year into a new year with an optional uplift' },
      { id: 'price-year-edit', icon: 'pencil', label: 'Edit year', title: 'Edit dates, VAT and default target' },
      year.status === 'locked'
        ? { id: 'price-year-lock', icon: 'lock-open', label: 'Unlock', title: 'Unlock this year for editing' }
        : { id: 'price-year-lock', icon: 'lock', label: 'Lock', title: 'Lock this year’s house prices' },
    );
  }
  return [{ id: 'actions', label: 'Price years', items }];
}

export function renderPriceYearsShell() {
  return `<div class="dist-panel plan-panel" id="pyPanel">${loadingWidget('Loading price years…')}</div>`;
}

export function mountPriceYearsPanel() {
  const panel = $('pyPanel');
  if (!panel) return null;

  const ctx = {
    years: [],
    year: null,
    house: new Map(),
    products: [],
    caseSizes: [],
    filter: getTableFilterValues('price-years') || {},
    query: getLastProductFilter().query || '',
    saveTimers: {},
    abort: false,
  };

  const locked = () => ctx.year?.status === 'locked';

  function lineFor(product) {
    const house = ctx.house.get(product.id);
    return resolveMenuLine(house || { product_id: product.id }, { product, year: ctx.year, caseSizes: ctx.caseSizes });
  }

  function visibleProducts() {
    const priced = ctx.filter.priced || 'priced';
    const cat = ctx.filter.category || '';
    const q = ctx.query.trim().toLowerCase();
    const rows = ctx.products.filter((p) => {
      if (priced === 'priced' && !ctx.house.has(p.id)) return false;
      if (priced === 'unpriced' && ctx.house.has(p.id)) return false;
      if (cat && (p.category?.name || 'Uncategorised') !== cat) return false;
      if (q) {
        const hay = [p.name, p.menu_name, p.sku, p.category?.name, productSupplierSearchText(p)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => (a.category?.name || 'Uncategorised').localeCompare(b.category?.name || 'Uncategorised')
      || (a.name || '').localeCompare(b.name || ''));
    return rows;
  }

  function input(field, value, placeholder, label) {
    return `<input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input"
      data-field="${field}" value="${value == null ? '' : escapeHtml(String(value))}"
      placeholder="${escapeHtml(placeholder ?? '')}" aria-label="${escapeHtml(label)}" ${locked() ? 'disabled' : ''}>`;
  }

  function renderRow(p) {
    const house = ctx.house.get(p.id) || {};
    const line = lineFor(p);
    const priced = ctx.house.has(p.id);
    return `<tr class="dist-prod-row plan-row${priced ? '' : ' plan-row--off'}" data-pid="${escapeHtml(p.id)}">
      <th class="dist-sticky plan-col-product" scope="row">
        <div class="plan-item">
          <div class="dist-item">
            <span class="dist-item-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            ${p.menu_name && p.menu_name !== p.name ? `<span class="dist-item-meta">${escapeHtml(p.menu_name)}</span>` : ''}
          </div>
          ${priced && !locked() ? `<button type="button" class="plan-row-remove" data-remove title="Remove from house menu" aria-label="Remove ${escapeHtml(p.name)} from house menu">${icon('x', { size: 13 })}</button>` : ''}
        </div>
      </th>
      <td class="plan-cell">${input('serves_per_unit', house.serves_per_unit, line.servesPerUnit, 'Serves per unit')}</td>
      <td class="plan-cell plan-out" data-out="cost">${money(line.costPerServe)}</td>
      <td class="plan-cell plan-cell--key">${input('menu_price', house.menu_price, line.suggestedPrice?.toFixed(2), 'House menu price')}</td>
      <td class="plan-cell">${input('target_gp_pct', house.target_gp_pct, String(line.targetGpPct ?? ''), 'Target GP %')}</td>
      <td class="plan-cell plan-out" data-out="required">${money(line.requiredPrice)}</td>
      <td class="plan-cell">${input('suggested_price', house.suggested_price, line.requiredPrice?.toFixed(2), 'Suggested price')}</td>
      <td class="plan-cell plan-cell--key plan-out" data-out="gp"><span class="lta-badge plan-gp ${statusClass(line.status)}">${escapeHtml(formatGpPct(line.gpPct))}</span></td>
    </tr>`;
  }

  function renderBody() {
    const rows = visibleProducts();
    if (!rows.length) {
      return `<tr><td colspan="8" class="dist-empty">${ctx.house.size || (ctx.filter.priced || 'priced') !== 'priced'
        ? 'No products match the current filter.'
        : 'No house prices yet — switch the filter to “All products” and start pricing.'}</td></tr>`;
    }
    let html = '';
    let current = null;
    rows.forEach((p) => {
      const cat = p.category?.name || 'Uncategorised';
      if (cat !== current) {
        current = cat;
        html += `<tr class="dist-cat-row"><td class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(cat)}</span></td><td colspan="7" class="dist-cat-scroll"></td></tr>`;
      }
      html += renderRow(p);
    });
    return html;
  }

  function yearCards() {
    return ctx.years.map((y) => `
      <button type="button" class="py-year${y.id === ctx.year?.id ? ' is-active' : ''}" data-year="${escapeHtml(y.id)}">
        <span class="py-year-label">${escapeHtml(y.label)} ${y.status === 'locked' ? icon('lock', { size: 12 }) : ''}</span>
        <span class="py-year-meta">${[
          y.starts_on || y.ends_on ? `${fmtDate(y.starts_on)} – ${fmtDate(y.ends_on)}` : '',
          `VAT ${Math.round(Number(y.vat_rate) * 1000) / 10}%`,
          `Target ${y.default_target_gp_pct}%`,
        ].filter(Boolean).map(escapeHtml).join(' · ')}</span>
      </button>`).join('');
  }

  function paint() {
    setTopbarToolbarStrips(yearStrips(ctx.year));
    if (!ctx.years.length) {
      panel.innerHTML = emptyState({
        iconHtml: icon('calendar', { size: 22 }),
        title: 'No price years yet',
        copy: 'A price year holds your house menu prices and GP targets for a season. Events pick a year, then copy its prices onto their own menu.',
        variant: 'admin',
        ctaHtml: '<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-new-year>New price year</button>',
      });
      return;
    }
    panel.innerHTML = `
      <section class="plan-head admin-surface">
        <div class="py-years">${yearCards()}</div>
        ${locked() ? `<p class="plan-chip plan-chip--locked">${icon('lock', { size: 12 })} ${escapeHtml(ctx.year.label)} is locked — house prices are read-only. Events keep their own copies.</p>` : ''}
      </section>
      <div class="dist-grid-wrap plan-grid-wrap">
        <table class="dist-grid plan-grid">
          <thead><tr>
            <th class="dist-th dist-sticky plan-col-product"><div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div></th>
            <th class="dist-th plan-th" title="Serves per stock unit"><span class="dist-bar-name">Serves</span></th>
            <th class="dist-th plan-th" title="Cost per serve ex VAT (current supplier price)"><span class="dist-bar-name">Cost</span></th>
            <th class="dist-th plan-th plan-th--key" title="House menu price inc VAT"><span class="dist-bar-name">Menu £</span></th>
            <th class="dist-th plan-th" title="Target GP %"><span class="dist-bar-name">Target</span></th>
            <th class="dist-th plan-th" title="Price needed to hit target GP"><span class="dist-bar-name">Required</span></th>
            <th class="dist-th plan-th" title="Suggested selling price"><span class="dist-bar-name">Suggested</span></th>
            <th class="dist-th plan-th plan-th--key" title="GP % at the house price"><span class="dist-bar-name">GP</span></th>
          </tr></thead>
          <tbody id="pyBody">${renderBody()}</tbody>
        </table>
      </div>`;
  }

  function paintBody() {
    const body = $('pyBody');
    if (body) body.innerHTML = renderBody();
  }

  function refreshRow(pid) {
    const p = ctx.products.find((x) => x.id === pid);
    const row = panel.querySelector(`tr[data-pid="${CSS.escape(pid)}"]`);
    if (!p || !row) return;
    const line = lineFor(p);
    row.querySelector('[data-out="required"]').textContent = money(line.requiredPrice);
    row.querySelector('[data-out="cost"]').textContent = money(line.costPerServe);
    row.querySelector('[data-out="gp"]').innerHTML = `<span class="lta-badge plan-gp ${statusClass(line.status)}">${escapeHtml(formatGpPct(line.gpPct))}</span>`;
    row.classList.toggle('plan-row--off', !ctx.house.has(pid));
  }

  function queueSave(key, fn) {
    clearTimeout(ctx.saveTimers[key]?.timer);
    const timer = setTimeout(() => {
      delete ctx.saveTimers[key];
      fn().catch((err) => toast(err.message || 'Save failed', true));
    }, SAVE_DEBOUNCE_MS);
    ctx.saveTimers[key] = { timer, fn };
  }

  function flushSaves() {
    const pending = Object.values(ctx.saveTimers);
    ctx.saveTimers = {};
    return Promise.all(pending.map(({ timer, fn }) => {
      clearTimeout(timer);
      return fn().catch((err) => toast(err.message || 'Save failed', true));
    }));
  }

  function onInput(e) {
    const el = e.target;
    const field = el.dataset.field;
    if (!field || !FIELDS[field] || !ctx.year) return;
    const pid = el.closest('tr[data-pid]')?.dataset.pid;
    if (!pid) return;
    const spec = FIELDS[field];
    const parsed = parsePlanningNumber(el.value, { max: spec.max });
    const ok = parsed.ok && !(spec.positive && parsed.value === 0);
    el.classList.toggle('is-invalid', !ok);
    if (!ok) return;
    const row = { ...(ctx.house.get(pid) || { price_year_id: ctx.year.id, product_id: pid }), [field]: parsed.value };
    ctx.house.set(pid, row);
    refreshRow(pid);
    const yearId = ctx.year.id;
    queueSave(`${pid}:${field}`, async () => {
      const saved = await upsertHousePrice(yearId, pid, { [field]: parsed.value });
      if (saved && ctx.year?.id === yearId) ctx.house.set(pid, { ...ctx.house.get(pid), id: saved.id });
    });
  }

  async function onClick(e) {
    if (e.target.closest('[data-new-year]')) { openYearForm(); return; }
    const yearBtn = e.target.closest('[data-year]');
    if (yearBtn) {
      await flushSaves();
      await selectYear(yearBtn.dataset.year);
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const pid = remove.closest('tr[data-pid]')?.dataset.pid;
      if (!pid || !ctx.year) return;
      try {
        await removeHousePrice(ctx.year.id, pid);
        ctx.house.delete(pid);
        paintBody();
        toast('Removed from house menu — event menus are unchanged');
      } catch (err) {
        toast(err.message || 'Remove failed', true);
      }
    }
  }

  async function selectYear(id) {
    ctx.year = ctx.years.find((y) => y.id === id) || ctx.years[0] || null;
    if (ctx.year) sessionStorage.setItem(YEAR_KEY, ctx.year.id);
    const rows = await listHousePrices(ctx.year?.id);
    if (ctx.abort) return;
    ctx.house = new Map((rows || []).map((r) => [r.product_id, r]));
    paint();
  }

  function yearFormHtml(y = {}) {
    return `
      <div class="admin-drawer-form">
        <label class="admin-field"><span class="admin-label">Label</span>
          <input class="admin-input" id="pyLabel" maxlength="40" value="${escapeHtml(y.label || '')}" placeholder="e.g. 2027"></label>
        <div class="plan-form-row">
          <label class="admin-field"><span class="admin-label">Starts</span>
            <input class="admin-input" id="pyStart" type="date" value="${escapeHtml(y.starts_on || '')}"></label>
          <label class="admin-field"><span class="admin-label">Ends</span>
            <input class="admin-input" id="pyEnd" type="date" value="${escapeHtml(y.ends_on || '')}"></label>
        </div>
        <div class="plan-form-row">
          <label class="admin-field"><span class="admin-label">VAT %</span>
            <input class="admin-input num-math" id="pyVat" inputmode="decimal" value="${y.vat_rate != null ? Math.round(Number(y.vat_rate) * 10000) / 100 : 20}"></label>
          <label class="admin-field"><span class="admin-label">Default target GP %</span>
            <input class="admin-input num-math" id="pyTarget" inputmode="decimal" value="${escapeHtml(String(y.default_target_gp_pct ?? 70))}"></label>
        </div>
        <p class="plan-form-err" id="pyErr" hidden></p>
      </div>`;
  }

  function readYearForm(el) {
    const label = el.querySelector('#pyLabel').value.trim();
    const vat = parsePlanningNumber(el.querySelector('#pyVat').value, { max: 100 });
    const target = parsePlanningNumber(el.querySelector('#pyTarget').value, { max: 100 });
    const starts = el.querySelector('#pyStart').value || null;
    const ends = el.querySelector('#pyEnd').value || null;
    if (!label) return { error: 'Label is required' };
    if (!vat.ok || vat.value == null) return { error: 'VAT must be between 0 and 99.99%' };
    if (!target.ok || target.value == null) return { error: 'Target GP must be between 0 and 99.99%' };
    if (starts && ends && ends < starts) return { error: 'End date must be after the start date' };
    return {
      fields: {
        label, starts_on: starts, ends_on: ends,
        vat_rate: Math.round(vat.value * 100) / 10000,
        default_target_gp_pct: target.value,
      },
    };
  }

  function openYearForm(existing = null) {
    const el = openModal({
      title: existing ? `Edit ${existing.label}` : 'New price year',
      bodyHtml: yearFormHtml(existing || {}),
      footHtml: `<div class="admin-modal-confirm-foot">
        ${existing ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" data-delete>Delete</button>' : ''}
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>${existing ? 'Save' : 'Create'}</button>
      </div>`,
    });
    const err = el.querySelector('#pyErr');
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const { fields, error } = readYearForm(el);
      if (error) { err.textContent = error; err.hidden = false; return; }
      try {
        const saved = existing ? await updatePriceYear(existing.id, fields) : await createPriceYear(fields);
        closeModal();
        await reload(saved?.id);
        toast(existing ? 'Price year saved' : `${fields.label} created`);
      } catch (e2) {
        err.textContent = /price_years_org_label_key|duplicate/i.test(e2.message || '')
          ? 'A price year with that label already exists'
          : (e2.message || 'Save failed');
        err.hidden = false;
      }
    };
    el.querySelector('[data-delete]')?.addEventListener('click', async () => {
      closeModal();
      const ok = await confirmDialog({
        title: 'Delete price year',
        message: `Delete ${existing.label} and its house prices? Events using this year must be moved to another year first.`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      try {
        await deletePriceYear(existing.id);
        sessionStorage.removeItem(YEAR_KEY);
        await reload();
        toast('Price year deleted');
      } catch (e2) {
        toast(/foreign key|violates/i.test(e2.message || '')
          ? 'Events still use this price year — move them first'
          : (e2.message || 'Delete failed'), true);
      }
    });
    requestAnimationFrame(() => el.querySelector('#pyLabel')?.focus());
  }

  function openRollForm() {
    if (!ctx.year) return;
    const next = /^\d{4}$/.test(ctx.year.label) ? String(Number(ctx.year.label) + 1) : '';
    const el = openModal({
      title: `Roll ${ctx.year.label} forward`,
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="muted">Creates a new year with ${ctx.house.size} house price${ctx.house.size === 1 ? '' : 's'} copied from ${escapeHtml(ctx.year.label)}. ${escapeHtml(ctx.year.label)} and its events are not changed.</p>
          <label class="admin-field"><span class="admin-label">New label</span>
            <input class="admin-input" id="rollLabel" maxlength="40" value="${escapeHtml(next)}"></label>
          <div class="plan-form-row">
            <label class="admin-field"><span class="admin-label">Price change %</span>
              <input class="admin-input num-math" id="rollUplift" inputmode="decimal" placeholder="0"></label>
            <label class="admin-field"><span class="admin-label">Round up to</span>
              <select class="admin-select" id="rollRound">
                <option value="0.05">5p</option>
                <option value="0.1" selected>10p</option>
                <option value="0.5">50p</option>
                <option value="0">No rounding</option>
              </select></label>
          </div>
          <p class="plan-form-err" id="rollErr" hidden></p>
        </div>`,
      footHtml: `<div class="admin-modal-confirm-foot">
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Create year</button>
      </div>`,
    });
    const err = el.querySelector('#rollErr');
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const label = el.querySelector('#rollLabel').value.trim();
      const raw = el.querySelector('#rollUplift').value.trim().replace('%', '');
      const uplift = raw ? Number(raw) : 0;
      if (!label) { err.textContent = 'Label is required'; err.hidden = false; return; }
      if (!Number.isFinite(uplift) || uplift <= -100 || uplift > 500) {
        err.textContent = 'Price change must be between -99% and 500%'; err.hidden = false; return;
      }
      el.querySelector('[data-ok]').disabled = true;
      try {
        await flushSaves();
        const source = ctx.year.label;
        const newId = await rollPriceYear(ctx.year.id, label, uplift, Number(el.querySelector('#rollRound').value));
        closeModal();
        await reload(typeof newId === 'string' ? newId : null);
        toast(`${label} created from ${source}`);
      } catch (e2) {
        el.querySelector('[data-ok]').disabled = false;
        err.textContent = /price_years_org_label_key|duplicate/i.test(e2.message || '')
          ? 'A price year with that label already exists'
          : (e2.message || 'Roll forward failed');
        err.hidden = false;
      }
    };
  }

  async function toggleLock() {
    if (!ctx.year) return;
    const lock = ctx.year.status !== 'locked';
    const ok = await confirmDialog({
      title: lock ? `Lock ${ctx.year.label}` : `Unlock ${ctx.year.label}`,
      message: lock
        ? 'Locked years can’t have house prices, VAT or dates changed. Event menus already copied from this year are unaffected.'
        : 'Unlocking lets house prices change again. The change is recorded in the audit history.',
      confirmLabel: lock ? 'Lock year' : 'Unlock year',
      danger: !lock,
    });
    if (!ok) return;
    try {
      await flushSaves();
      await updatePriceYear(ctx.year.id, { status: lock ? 'locked' : 'open' });
      await reload(ctx.year.id);
      toast(lock ? 'Price year locked' : 'Price year unlocked');
    } catch (err) {
      toast(err.message || 'Update failed', true);
    }
  }

  function onToolbarAction(e) {
    const action = e.detail?.action;
    const handlers = {
      'price-year-new': () => openYearForm(),
      'price-year-roll': openRollForm,
      'price-year-edit': () => ctx.year && openYearForm(ctx.year),
      'price-year-lock': toggleLock,
    };
    if (!handlers[action]) return;
    e.detail.handled = true;
    handlers[action]();
  }

  function onTableFilter(e) {
    if (e.detail?.panel !== 'price-years') return;
    ctx.filter = e.detail.values || {};
    paintBody();
  }

  function onProductFilter(e) {
    ctx.query = e.detail?.query || '';
    paintBody();
    if (e.detail) e.detail.handled = true;
  }

  async function reload(selectId = null) {
    await flushSaves();
    const [years, products, caseSizes] = await Promise.all([
      listPriceYears(),
      loadLibraryProducts(),
      loadCaseSizes(),
    ]);
    if (ctx.abort) return;
    ctx.years = years || [];
    ctx.products = (products || []).filter((p) => !p.archived && (p.product_kind || 'stock') === 'stock');
    ctx.caseSizes = caseSizes || [];
    setTableFilterContext('price-years', {
      categories: [...new Set(ctx.products.map((p) => p.category?.name || 'Uncategorised'))].sort(),
    });
    await selectYear(selectId || sessionStorage.getItem(YEAR_KEY) || ctx.years[0]?.id);
  }

  panel.addEventListener('input', onInput);
  panel.addEventListener('click', onClick);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  reload().catch((err) => {
    reportError(err, { source: 'admin.price-years.reload', silent: true });
    const missing = isPlanningSchemaMissing(err);
    panel.innerHTML = errorState({
      title: missing ? 'Price years aren’t set up yet' : 'Couldn’t load price years',
      copy: missing
        ? 'Apply migration 068_pricing_gp_planning.sql, then retry.'
        : (err.message || 'Failed to load'),
      variant: 'admin',
    });
    bindEmptyRetry(panel, () => reload());
  });

  return () => {
    ctx.abort = true;
    void flushSaves();
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  };
}
