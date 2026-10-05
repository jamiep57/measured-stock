/**
 * Planning — event menu, pricing and GP (spreadsheet grid).
 *
 * Rows are event_menu_items. Each event keeps its own menu prices.
 * Menu items never create stock: quantities here are projections only.
 */

import { $, escapeHtml, toast } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { loadingWidget } from '../../components/loading-widget.js';
import { emptyState, errorState, bindEmptyRetry } from '../../components/empty-state.js';
import { reportError } from '../../lib/client-errors.js';
import { loadCaseSizes, loadLibraryProducts, loadCategories } from '../../db.js';
import { openModal, closeModal, confirmDialog } from '../../components/modal.js';
import { openSheet, closeSheet } from '../../components/sheet.js';
import { mountProductSearch, productSupplierSearchText } from '../../components/product-search.js';
import { listAccounts, loadEventClientAccount } from '../../lib/accounts-data.js';
import { openMenuExportDialog } from '../planning-export.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { ADMIN_TABLE_FILTER, getTableFilterValues, setTableFilterContext } from '../table-filter.js';
import { formatGpPct, roundUpToStep } from '../../lib/gp.js';
import {
  liveUnitCost,
  menuTotals,
  parsePlanningNumber,
  resolveMenuLine,
  scenarioGp,
} from '../../lib/planning-menu.js';
import {
  movePlanningColumn,
  readPlanningColumnOrder,
  reconcilePlanningColumnOrder,
  scenarioColumnId,
  writePlanningColumnOrder,
} from '../../lib/planning-columns.js';
import {
  clearEventCostSnapshots,
  createScenario,
  deleteScenario,
  isEventPricingLocked,
  isPlanningSchemaMissing,
  listEventMenu,
  listScenarios,
  loadEventPricing,
  replaceScenarioPrices,
  scenarioPricesFrom,
  applySavedMenu,
  deleteSavedMenu,
  listSavedMenus,
  saveEventMenu,
  savedMenuProductCount,
  setScenarioPrice,
  snapshotEventCosts,
  updateEventPricing,
  updateScenario,
  upsertEventMenuItem,
} from '../../lib/planning-data.js';

const SAVE_DEBOUNCE_MS = 450;

const NUMERIC_FIELDS = {
  serves_per_unit: { max: null, positive: true },
  menu_price: {},
  target_gp_pct: { max: 100 },
  suggested_price: {},
  projected_serves: {},
  unit_cost_override: {},
};

export const PLANNING_COLUMNS = [
  { key: 'serve', label: 'Serves / unit' },
  { key: 'cost', label: 'Cost / serve' },
  { key: 'required', label: 'Required £' },
  { key: 'suggested', label: 'Suggested £' },
  { key: 'scenarios', label: 'Scenarios' },
  { key: 'serves', label: 'Projected serves' },
  { key: 'revenue', label: 'Revenue / GP £' },
  { key: 'deal', label: 'Deal cost & ref' },
];

function money(n, dp = 2) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function inputValue(n) {
  return n == null ? '' : String(n);
}

function statusClass(status) {
  if (status === 'green') return 'lta-ok';
  if (status === 'amber') return 'plan-gp--amber';
  if (status === 'red') return 'lta-over';
  return 'lta-neutral';
}

function statusLabel(status) {
  if (status === 'green') return 'On target';
  if (status === 'amber') return 'Near target';
  if (status === 'red') return 'Below target';
  return 'No GP yet';
}

function gpBadge(gp, status, attrs = '') {
  return `<span class="lta-badge plan-gp ${statusClass(status)}" ${attrs} title="${escapeHtml(statusLabel(status))}">${escapeHtml(formatGpPct(gp))}</span>`;
}

function costSourceLabel(source) {
  if (source === 'locked') return 'Locked cost';
  if (source === 'deal') return 'Deal cost';
  if (source === 'supplier') return 'Supplier cost';
  return 'No cost';
}

export function renderPlanningShell() {
  return `
    <div class="dist-panel plan-panel" id="planPanel">
      ${loadingWidget('Loading menu & GP…')}
    </div>`;
}

export function mountPlanningPanel(route) {
  const panel = $('planPanel');
  if (!panel) return null;

  const ctx = {
    eventId: route.eventId,
    event: null,
    items: new Map(),
    products: [],
    productById: new Map(),
    categories: [],
    caseSizes: [],
    scenarios: [],
    lines: new Map(),
    filter: getTableFilterValues('planning') || {},
    query: getLastProductFilter().query || '',
    saveTimers: {},
    accounts: null,
    clientAccountId: null,
    columnOrder: readPlanningColumnOrder(typeof localStorage === 'undefined' ? null : localStorage),
    abort: false,
  };

  const locked = () => isEventPricingLocked(ctx.event);
  const colOn = (key) => !(ctx.filter.hiddenColumns || []).includes(key);

  // ---------- derived data -------------------------------------------

  function lineFor(pid) {
    const item = ctx.items.get(pid);
    const line = resolveMenuLine(item, {
      product: ctx.productById.get(pid),
      event: ctx.event,
      caseSizes: ctx.caseSizes,
    });
    ctx.lines.set(pid, line);
    return line;
  }

  function recomputeAll() {
    ctx.lines.clear();
    ctx.items.forEach((_item, pid) => lineFor(pid));
  }

  function scenarioPrice(scenario, pid) {
    const row = (scenario.scenario_prices || []).find((r) => r.product_id === pid);
    return row ? Number(row.price) : null;
  }

  function visibleLines() {
    const menu = ctx.filter.menu || 'on';
    const status = ctx.filter.gpStatus || 'all';
    const cat = ctx.filter.category || '';
    const q = ctx.query.trim().toLowerCase();
    let rows = [...ctx.lines.values()].filter((l) => {
      if (menu === 'on' && !l.included) return false;
      if (menu === 'off' && l.included) return false;
      if (status !== 'all') {
        if (status === 'none' ? l.status != null : l.status !== status) return false;
      }
      if (cat && l.category !== cat) return false;
      if (q) {
        const p = ctx.productById.get(l.productId);
        const hay = [l.name, l.menuName, l.caseSize, l.category, p?.sku, productSupplierSearchText(p)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sort = ctx.filter.sort || 'category';
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (sort === 'name') rows.sort(byName);
    else if (sort === 'gp-asc') rows.sort((a, b) => (a.gpPct ?? Infinity) - (b.gpPct ?? Infinity));
    else if (sort === 'gp-desc') rows.sort((a, b) => (b.gpPct ?? -Infinity) - (a.gpPct ?? -Infinity));
    else if (sort === 'revenue-desc') rows.sort((a, b) => (b.revenueGross ?? -1) - (a.revenueGross ?? -1));
    else rows.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));
    return rows;
  }

  // ---------- rendering ----------------------------------------------

  function cellInput(field, value, { placeholder = '', label = '', text = false, width = '' } = {}) {
    const dis = locked() ? 'disabled' : '';
    if (text) {
      return `<input type="text" class="plan-cell-input plan-cell-input--text" data-field="${field}"
        value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}"
        maxlength="120" autocomplete="off" ${dis}>`;
    }
    return `<input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input${width ? ` plan-cell-input--${width}` : ''}"
      data-field="${field}" value="${escapeHtml(inputValue(value))}" placeholder="${escapeHtml(placeholder)}"
      aria-label="${escapeHtml(label)}" ${dis}>`;
  }

  function columnShown(id) {
    if (id.startsWith('scenario:')) return colOn('scenarios');
    if (id === 'gp-amount') return colOn('revenue');
    if (id === 'deal-ref') return colOn('deal');
    if (id === 'menu' || id === 'target' || id === 'gp') return true;
    return colOn(id);
  }

  function fullColumnOrder() {
    return reconcilePlanningColumnOrder(ctx.columnOrder, ctx.scenarios.map((s) => s.id));
  }

  function shownColumnIds() {
    return fullColumnOrder().filter(columnShown);
  }

  function th(id, label, title = '', cls = '') {
    const hint = title || label;
    return `<th class="dist-th plan-th plan-th--move ${cls}" data-col="${escapeHtml(id)}" title="${escapeHtml(`${hint}. Drag to reorder`)}"><div class="dist-bar-head"><span class="dist-bar-name">${escapeHtml(label)}</span></div></th>`;
  }

  function columnHead(id) {
    if (id === 'serve') return th(id, 'Serves', 'Serves per stock unit (e.g. 88 pints per keg)');
    if (id === 'cost') return th(id, 'Cost', 'Cost per serve (ex VAT)');
    if (id === 'menu') return th(id, 'Menu £', 'Event menu price inc VAT', 'plan-th--key');
    if (id === 'target') return th(id, 'Target', 'Target GP %');
    if (id === 'required') return th(id, 'Required', 'Price inc VAT needed to hit the target GP — click to use');
    if (id === 'suggested') return th(id, 'Suggested', 'Suggested selling price (defaults to required)');
    if (id === 'gp') return th(id, 'GP', 'Projected GP % at the menu price', 'plan-th--key');
    if (id === 'serves') return th(id, 'Serves', 'Projected serves for the event');
    if (id === 'revenue') return th(id, 'Revenue', 'Projected revenue inc VAT');
    if (id === 'gp-amount') return th(id, 'GP £', 'Projected GP £ (ex VAT)');
    if (id === 'deal') return th(id, 'Deal cost', 'Agreed deal cost per stock unit — replaces the supplier cost');
    if (id === 'deal-ref') return th(id, 'Deal ref', 'Deal or agreement reference');
    if (id.startsWith('scenario:')) {
      const s = ctx.scenarios.find((x) => scenarioColumnId(x.id) === id);
      if (!s) return '';
      return `<th class="dist-th plan-th plan-th--move plan-th--scenario" data-col="${escapeHtml(id)}" title="Drag to reorder. Click the name to edit.">
          <button type="button" class="plan-scenario-head" data-scenario-edit="${escapeHtml(s.id)}">
            <span class="dist-bar-name">${escapeHtml(s.name)}</span>
            ${s.client_visible ? '<span class="dist-bar-tag">Client</span>' : ''}
          </button>
        </th>`;
    }
    return '';
  }

  function renderHead() {
    const cells = shownColumnIds().map(columnHead).join('');
    return `<tr>
      <th class="dist-th dist-sticky plan-col-product" data-col="product" title="Product"><div class="dist-bar-head dist-bar-head--left"><span class="dist-bar-name">Product</span></div></th>
      ${cells}</tr>`;
  }

  function colCount() {
    return 1 + shownColumnIds().length;
  }

  function columnCell(id, line, item) {
    const dis = locked() ? 'disabled' : '';
    if (id === 'serve') {
      return `<td class="plan-cell">${cellInput('serves_per_unit', item.serves_per_unit, { placeholder: line.servesPerUnit ?? '', label: 'Serves per unit', width: 'sm' })}</td>`;
    }
    if (id === 'cost') {
      return `<td class="plan-cell plan-out" data-out="cost" title="${escapeHtml(`${costSourceLabel(line.costSource)} · ${money(line.unitCost)} per unit`)}">
        ${money(line.costPerServe)}${line.costSource === 'locked' ? ` <span class="plan-lock">${icon('lock', { size: 11 })}</span>` : ''}
      </td>`;
    }
    if (id === 'menu') {
      return `<td class="plan-cell plan-cell--key">${cellInput('menu_price', item.menu_price, { placeholder: line.suggestedPrice != null ? line.suggestedPrice.toFixed(2) : '', label: 'Menu price' })}</td>`;
    }
    if (id === 'target') {
      return `<td class="plan-cell">${cellInput('target_gp_pct', item.target_gp_pct, { placeholder: line.targetGpPct != null ? String(line.targetGpPct) : '', label: 'Target GP %', width: 'sm' })}</td>`;
    }
    if (id === 'required') {
      return `<td class="plan-cell plan-out" data-out="required">${line.requiredPrice != null && !locked()
        ? `<button type="button" class="plan-use-price" data-use-price="${line.requiredPrice}" title="Use as menu price">${money(line.requiredPrice)}</button>`
        : money(line.requiredPrice)}</td>`;
    }
    if (id === 'suggested') {
      return `<td class="plan-cell">${cellInput('suggested_price', item.suggested_price, { placeholder: line.requiredPrice != null ? line.requiredPrice.toFixed(2) : '', label: 'Suggested price' })}</td>`;
    }
    if (id === 'gp') {
      return `<td class="plan-cell plan-cell--key plan-out" data-out="gp">${gpBadge(line.gpPct, line.status)}</td>`;
    }
    if (id.startsWith('scenario:')) {
      const s = ctx.scenarios.find((x) => scenarioColumnId(x.id) === id);
      if (!s) return '';
      const price = scenarioPrice(s, line.productId);
      const sg = scenarioGp(line, price);
      return `<td class="plan-cell plan-cell--scenario" data-scenario="${escapeHtml(s.id)}">
          <div class="plan-scenario-cell">
            <input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input"
              data-scenario-price="${escapeHtml(s.id)}" value="${escapeHtml(inputValue(price))}"
              aria-label="${escapeHtml(s.name)} price" ${dis}>
            <span class="plan-scenario-gp ${statusClass(sg.status)}" data-out="scenario-gp">${escapeHtml(formatGpPct(sg.gpPct))}</span>
          </div>
        </td>`;
    }
    if (id === 'serves') {
      return `<td class="plan-cell">${cellInput('projected_serves', item.projected_serves, { label: 'Projected serves' })}</td>`;
    }
    if (id === 'revenue') {
      return `<td class="plan-cell plan-out" data-out="revenue">${money(line.revenueGross, 0)}</td>`;
    }
    if (id === 'gp-amount') {
      return `<td class="plan-cell plan-out" data-out="gp-amount">${money(line.gpAmount, 0)}</td>`;
    }
    if (id === 'deal') {
      const live = liveUnitCost(ctx.productById.get(line.productId));
      return `<td class="plan-cell">${cellInput('unit_cost_override', item.unit_cost_override, { placeholder: live != null ? live.toFixed(2) : '', label: 'Deal cost per unit' })}</td>`;
    }
    if (id === 'deal-ref') {
      return `<td class="plan-cell plan-cell--text">${cellInput('deal_ref', item.deal_ref, { text: true, placeholder: 'Ref', label: 'Deal reference' })}</td>`;
    }
    return '';
  }

  function renderRow(line) {
    const pid = line.productId;
    const item = ctx.items.get(pid) || {};
    const dis = locked() ? 'disabled' : '';
    const packMeta = line.caseSize
      ? `<span class="dist-item-meta">${escapeHtml(line.caseSize)}</span>` : '';
    const menuMeta = line.menuName && line.menuName !== line.name
      ? `<span class="dist-item-meta">${escapeHtml(line.menuName)}</span>` : '';
    const cells = shownColumnIds().map((id) => columnCell(id, line, item)).join('');
    return `<tr class="dist-prod-row plan-row${line.included ? '' : ' plan-row--off'}" data-pid="${escapeHtml(pid)}">
      <th class="dist-sticky plan-col-product" scope="row">
        <div class="plan-item">
          <input type="checkbox" class="plan-include" data-field="included" ${line.included ? 'checked' : ''} ${dis}
            aria-label="${line.included ? 'Remove from' : 'Add to'} event menu" title="${line.included ? 'On the event menu — untick to take off (product stays in the library)' : 'Off the event menu — tick to add'}">
          <div class="dist-item">
            <span class="dist-item-name" title="${escapeHtml(line.name)}">${escapeHtml(line.name)}</span>
            ${packMeta}
            ${menuMeta}
          </div>
        </div>
      </th>${cells}</tr>`;
  }

  function renderBody() {
    const rows = visibleLines();
    if (!rows.length) {
      return `<tr><td colspan="${colCount()}" class="dist-empty">${ctx.items.size
        ? 'No menu items match the current filter.'
        : 'No products on this event menu yet.'}</td></tr>`;
    }
    const sort = ctx.filter.sort || 'category';
    if (sort !== 'category') return rows.map(renderRow).join('');
    let html = '';
    let current = null;
    rows.forEach((line) => {
      if (line.category !== current) {
        current = line.category;
        html += `<tr class="dist-cat-row"><td colspan="1" class="dist-cat-pinned"><span class="dist-bar-name">${escapeHtml(current)}</span></td><td colspan="${colCount() - 1}" class="dist-cat-scroll"></td></tr>`;
      }
      html += renderRow(line);
    });
    return html;
  }

  function totalsHtml() {
    const lines = [...ctx.lines.values()];
    const totals = menuTotals(lines);
    const target = ctx.event?.target_gp_pct ?? null;
    const amber = ctx.event?.gp_amber_band ?? 5;
    const onMenu = lines.filter((l) => l.included).length;
    const statusCounts = { red: 0, amber: 0, green: 0 };
    lines.forEach((l) => { if (l.included && l.status) statusCounts[l.status] += 1; });
    const mixStatus = totals.gpPct == null || target == null ? null
      : (totals.gpPct >= target ? 'green' : totals.gpPct >= target - amber ? 'amber' : 'red');
    const scenarioCards = ctx.scenarios.map((s) => {
      const st = menuTotals(lines, { priceFor: (l) => scenarioPrice(s, l.productId) ?? l.menuPrice });
      return `<div class="plan-kpi plan-kpi--scenario">
        <span class="plan-kpi-label">${escapeHtml(s.name)}</span>
        <span class="plan-kpi-value">${money(st.revenueGross, 0)}</span>
        <span class="plan-kpi-sub">${gpBadge(st.gpPct, st.gpPct == null || target == null ? null : (st.gpPct >= target ? 'green' : st.gpPct >= target - amber ? 'amber' : 'red'))}</span>
      </div>`;
    }).join('');
    return `
      <div class="plan-kpi"><span class="plan-kpi-label">On menu</span><span class="plan-kpi-value">${onMenu}</span>
        <span class="plan-kpi-sub muted">${statusCounts.red ? `<span class="plan-dot plan-dot--red"></span>${statusCounts.red} below` : ''}
        ${statusCounts.amber ? `<span class="plan-dot plan-dot--amber"></span>${statusCounts.amber} near` : ''}
        ${statusCounts.green ? `<span class="plan-dot plan-dot--green"></span>${statusCounts.green} on target` : ''}</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Projected revenue</span><span class="plan-kpi-value">${money(totals.revenueGross, 0)}</span>
        <span class="plan-kpi-sub muted">${money(totals.revenueNet, 0)} ex VAT</span></div>
      <div class="plan-kpi"><span class="plan-kpi-label">Projected GP</span><span class="plan-kpi-value">${money(totals.gpAmount, 0)}</span>
        <span class="plan-kpi-sub muted">${money(totals.cost, 0)} cost</span></div>
      <div class="plan-kpi plan-kpi--mix"><span class="plan-kpi-label">Mix GP</span><span class="plan-kpi-value">${gpBadge(totals.gpPct, mixStatus)}</span>
        <span class="plan-kpi-sub muted">${totals.excluded ? `${totals.excluded} item${totals.excluded === 1 ? '' : 's'} missing price or cost` : 'Weighted by projected serves'}</span></div>
      ${scenarioCards}`;
  }

  function settingsHtml() {
    const dis = locked() ? 'disabled' : '';
    const snapshots = [...ctx.items.values()].filter((i) => i.unit_cost_snapshot != null).length;
    const costState = snapshots
      ? `<span class="plan-chip plan-chip--locked">${icon('lock', { size: 12 })} Costs locked (${snapshots})</span>`
      : '<span class="plan-chip">Live supplier costs</span>';
    return `
      <label class="admin-field plan-field plan-field--sm">
        <span class="admin-label">Target GP %</span>
        <input type="text" inputmode="decimal" class="admin-input num-math" id="planTarget"
          value="${escapeHtml(inputValue(ctx.event?.target_gp_pct))}"
          placeholder="70" ${dis}>
      </label>
      <label class="admin-field plan-field plan-field--sm">
        <span class="admin-label">Amber band (pts)</span>
        <input type="text" inputmode="decimal" class="admin-input num-math" id="planAmber"
          value="${escapeHtml(inputValue(ctx.event?.gp_amber_band ?? 5))}" ${dis}>
      </label>
      <div class="plan-settings-meta">
        ${locked() ? `<span class="plan-chip plan-chip--locked">${icon('lock', { size: 12 })} Event ${escapeHtml(ctx.event.status)} — pricing is read-only</span>` : ''}
        ${costState}
      </div>`;
  }

  function paint() {
    if (!ctx.items.size) {
      panel.innerHTML = emptyState({
        iconHtml: icon('calculator', { size: 22 }),
        title: 'Plan this event’s menu',
        copy: 'Add products and set prices here. Save the menu when you want to reuse it on another event.',
        variant: 'admin',
        ctaHtml: '<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-add-product>Add product</button>',
      });
      return;
    }
    panel.innerHTML = `
      <section class="plan-head admin-surface">
        <div class="plan-settings" id="planSettings">${settingsHtml()}</div>
        <div class="plan-kpis" id="planKpis">${totalsHtml()}</div>
      </section>
      <div class="dist-grid-wrap plan-grid-wrap">
        <table class="dist-grid plan-grid" id="planGrid">
          <thead id="planHead">${renderHead()}</thead>
          <tbody id="planBody">${renderBody()}</tbody>
        </table>
      </div>`;
    syncTheadHeight();
  }

  function paintGrid() {
    const head = $('planHead');
    const body = $('planBody');
    if (!head || !body) { paint(); return; }
    head.innerHTML = renderHead();
    body.innerHTML = renderBody();
    paintKpis();
    syncTheadHeight();
  }

  function paintKpis() {
    const el = $('planKpis');
    if (el) el.innerHTML = totalsHtml();
  }

  function syncTheadHeight() {
    requestAnimationFrame(() => {
      const wrap = panel.querySelector('.plan-grid-wrap');
      const row = panel.querySelector('#planHead tr');
      if (wrap && row) wrap.style.setProperty('--dist-thead-h', `${row.getBoundingClientRect().height}px`);
    });
  }

  /** Refresh computed cells for one row without re-rendering inputs. */
  function refreshRow(pid) {
    const line = lineFor(pid);
    const row = panel.querySelector(`tr.plan-row[data-pid="${CSS.escape(pid)}"]`);
    if (row) {
      const set = (key, html) => {
        const el = row.querySelector(`[data-out="${key}"]`);
        if (el) el.innerHTML = html;
      };
      set('gp', gpBadge(line.gpPct, line.status));
      set('cost', `${money(line.costPerServe)}${line.costSource === 'locked' ? ` <span class="plan-lock">${icon('lock', { size: 11 })}</span>` : ''}`);
      set('required', line.requiredPrice != null && !locked()
        ? `<button type="button" class="plan-use-price" data-use-price="${line.requiredPrice}" title="Use as menu price">${money(line.requiredPrice)}</button>`
        : money(line.requiredPrice));
      set('revenue', money(line.revenueGross, 0));
      set('gp-amount', money(line.gpAmount, 0));
      row.querySelectorAll('[data-scenario]').forEach((cell) => {
        const s = ctx.scenarios.find((x) => x.id === cell.dataset.scenario);
        if (!s) return;
        const sg = scenarioGp(line, scenarioPrice(s, pid));
        const out = cell.querySelector('[data-out="scenario-gp"]');
        if (out) {
          out.textContent = formatGpPct(sg.gpPct);
          out.className = `plan-scenario-gp ${statusClass(sg.status)}`;
        }
      });
      const menuInput = row.querySelector('[data-field="menu_price"]');
      if (menuInput) menuInput.placeholder = line.suggestedPrice != null ? line.suggestedPrice.toFixed(2) : '';
      const sugInput = row.querySelector('[data-field="suggested_price"]');
      if (sugInput) sugInput.placeholder = line.requiredPrice != null ? line.requiredPrice.toFixed(2) : '';
      const tgtInput = row.querySelector('[data-field="target_gp_pct"]');
      if (tgtInput) tgtInput.placeholder = line.targetGpPct != null ? String(line.targetGpPct) : '';
    }
    paintKpis();
  }

  // ---------- saving -------------------------------------------------

  async function runSave(fn) {
    try {
      await fn();
    } catch (err) {
      reportError(err, { source: 'admin.planning.save', silent: true });
      toast(err.message || 'Save failed', true);
    }
  }

  function queueSave(key, fn) {
    clearTimeout(ctx.saveTimers[key]?.timer);
    const timer = setTimeout(() => {
      delete ctx.saveTimers[key];
      void runSave(fn);
    }, SAVE_DEBOUNCE_MS);
    ctx.saveTimers[key] = { timer, fn };
  }

  /** Save pending edits now (navigation away, reload). */
  function flushSaves() {
    const pending = Object.values(ctx.saveTimers);
    ctx.saveTimers = {};
    return Promise.all(pending.map(({ timer, fn }) => {
      clearTimeout(timer);
      return runSave(fn);
    }));
  }

  function setItemField(pid, field, value, { immediate = false } = {}) {
    const item = ctx.items.get(pid) || { event_id: ctx.eventId, product_id: pid, included: true };
    item[field] = value;
    ctx.items.set(pid, item);
    refreshRow(pid);
    const save = async () => {
      const saved = await upsertEventMenuItem(ctx.eventId, pid, { [field]: value });
      if (saved) ctx.items.set(pid, { ...ctx.items.get(pid), id: saved.id, org_id: saved.org_id });
    };
    if (immediate) return save().catch((err) => toast(err.message || 'Save failed', true));
    queueSave(`${pid}:${field}`, save);
    return null;
  }

  function onGridInput(e) {
    const input = e.target;
    const row = input.closest('tr.plan-row');
    if (!row) return;
    const pid = row.dataset.pid;

    if (input.dataset.scenarioPrice) {
      const parsed = parsePlanningNumber(input.value);
      input.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok) return;
      const s = ctx.scenarios.find((x) => x.id === input.dataset.scenarioPrice);
      if (!s) return;
      const list = (s.scenario_prices || []).filter((r) => r.product_id !== pid);
      if (parsed.value != null) list.push({ product_id: pid, price: parsed.value });
      s.scenario_prices = list;
      refreshRow(pid);
      queueSave(`${pid}:scenario:${s.id}`, () => setScenarioPrice(s.id, pid, parsed.value));
      return;
    }

    const field = input.dataset.field;
    if (!field || field === 'included') return;
    if (field === 'deal_ref') {
      setItemField(pid, field, input.value.trim() || null);
      return;
    }
    const spec = NUMERIC_FIELDS[field];
    if (!spec) return;
    const parsed = parsePlanningNumber(input.value, { max: spec.max ?? undefined });
    const ok = parsed.ok && !(spec.positive && parsed.value === 0);
    input.classList.toggle('is-invalid', !ok);
    if (!ok) return;
    setItemField(pid, field, parsed.value);
  }

  async function onGridChange(e) {
    const input = e.target;
    if (!input.matches('.plan-include')) return;
    const pid = input.closest('tr.plan-row')?.dataset.pid;
    if (!pid) return;
    await setItemField(pid, 'included', input.checked, { immediate: true });
    paintGrid();
  }

  let colDrag = null;
  let suppressHeaderClick = false;

  function sameOrder(a, b) {
    return a.length === b.length && a.every((id, i) => id === b[i]);
  }

  function clearColumnDragMarks() {
    panel.querySelectorAll('.plan-th--drop-before, .plan-th--drop-after, .plan-th--dragging').forEach((el) => {
      el.classList.remove('plan-th--drop-before', 'plan-th--drop-after', 'plan-th--dragging');
    });
  }

  function headerAt(clientX, clientY) {
    const wrap = panel.querySelector('.plan-grid-wrap');
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const headers = [...panel.querySelectorAll('#planHead th[data-col]')];
    const product = headers.find((el) => el.dataset.col === 'product');
    const productRight = product ? product.getBoundingClientRect().right : rect.left;
    let match = null;
    headers.forEach((thEl) => {
      const box = thEl.getBoundingClientRect();
      const left = thEl.dataset.col === 'product' ? box.left : Math.max(box.left, productRight);
      if (clientX >= left && clientX <= box.right && box.right > left) match = thEl;
    });
    return match;
  }

  function markColumnDrop(clientX, clientY) {
    panel.querySelectorAll('.plan-th--drop-before, .plan-th--drop-after').forEach((el) => {
      el.classList.remove('plan-th--drop-before', 'plan-th--drop-after');
    });
    colDrag.overId = null;
    colDrag.place = null;
    const hit = headerAt(clientX, clientY);
    if (!hit || hit.dataset.col === colDrag.id) return;
    if (hit.dataset.col === 'product') {
      hit.classList.add('plan-th--drop-after');
      colDrag.overId = 'product';
      colDrag.place = 'before';
      return;
    }
    const box = hit.getBoundingClientRect();
    const after = clientX > box.left + box.width / 2;
    hit.classList.add(after ? 'plan-th--drop-after' : 'plan-th--drop-before');
    colDrag.overId = hit.dataset.col;
    colDrag.place = after ? 'after' : 'before';
  }

  function applyColumnMove(fromId, toId, place) {
    const order = fullColumnOrder();
    let target = toId;
    let where = place;
    if (toId === 'product') {
      target = order.find((id) => id !== fromId && columnShown(id));
      where = 'before';
    }
    if (!target) return;
    const next = movePlanningColumn(order, fromId, target, where);
    if (sameOrder(order, next)) return;
    ctx.columnOrder = next;
    writePlanningColumnOrder(typeof localStorage === 'undefined' ? null : localStorage, next);
    paintGrid();
  }

  function onColPointerDown(e) {
    if (e.button !== 0) return;
    const thEl = e.target.closest('#planHead th[data-col]');
    if (!thEl || thEl.dataset.col === 'product') return;
    colDrag = {
      id: thEl.dataset.col,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      th: thEl,
      overId: null,
      place: null,
      raf: 0,
    };
  }

  function onColPointerMove(e) {
    if (!colDrag || e.pointerId !== colDrag.pointerId) return;
    colDrag.x = e.clientX;
    colDrag.y = e.clientY;
    if (!colDrag.active) {
      const dx = e.clientX - colDrag.startX;
      const dy = e.clientY - colDrag.startY;
      if (dx * dx + dy * dy < 25) return;
      colDrag.active = true;
      colDrag.th.classList.add('plan-th--dragging');
      panel.classList.add('plan-col-dragging');
      try { colDrag.th.setPointerCapture(e.pointerId); } catch { /* already released */ }
      const step = () => {
        if (!colDrag?.active) return;
        const wrap = panel.querySelector('.plan-grid-wrap');
        if (wrap) {
          const rect = wrap.getBoundingClientRect();
          if (colDrag.x < rect.left + 56) wrap.scrollLeft -= 14;
          else if (colDrag.x > rect.right - 56) wrap.scrollLeft += 14;
        }
        markColumnDrop(colDrag.x, colDrag.y);
        colDrag.raf = requestAnimationFrame(step);
      };
      colDrag.raf = requestAnimationFrame(step);
    }
    markColumnDrop(colDrag.x, colDrag.y);
    e.preventDefault();
  }

  function endColDrag(e) {
    if (!colDrag || e.pointerId !== colDrag.pointerId) return;
    if (colDrag.active) markColumnDrop(colDrag.x, colDrag.y);
    const drag = colDrag;
    colDrag = null;
    if (drag.raf) cancelAnimationFrame(drag.raf);
    panel.classList.remove('plan-col-dragging');
    try { drag.th.releasePointerCapture(drag.pointerId); } catch { /* not captured */ }
    clearColumnDragMarks();
    if (!drag.active) return;
    suppressHeaderClick = true;
    setTimeout(() => { suppressHeaderClick = false; }, 400);
    if (e.type === 'pointercancel' || !drag.overId || !drag.place) return;
    applyColumnMove(drag.id, drag.overId, drag.place);
  }

  function onPanelClick(e) {
    if (suppressHeaderClick) {
      suppressHeaderClick = false;
      return;
    }
    if (e.target.closest('[data-add-product]')) {
      openAddProduct();
      return;
    }
    const use = e.target.closest('[data-use-price]');
    if (use) {
      const pid = use.closest('tr.plan-row')?.dataset.pid;
      const price = Number(use.dataset.usePrice);
      if (!pid || !Number.isFinite(price)) return;
      const input = use.closest('tr').querySelector('[data-field="menu_price"]');
      if (input) input.value = price.toFixed(2);
      setItemField(pid, 'menu_price', price);
      return;
    }
    const scen = e.target.closest('[data-scenario-edit]');
    if (scen) openScenarioEditor(scen.dataset.scenarioEdit);
  }

  function onSettingsInput(e) {
    const id = e.target.id;
    if (id !== 'planTarget' && id !== 'planAmber') return;
    const parsed = parsePlanningNumber(e.target.value, { max: id === 'planTarget' ? 100 : 101 });
    const ok = parsed.ok && !(id === 'planAmber' && parsed.value == null);
    e.target.classList.toggle('is-invalid', !ok);
    if (!ok) return;
    const field = id === 'planTarget' ? 'target_gp_pct' : 'gp_amber_band';
    ctx.event[field] = parsed.value;
    recomputeAll();
    paintGrid();
    queueSave(`event:${field}`, () => updateEventPricing(ctx.eventId, { [field]: parsed.value }));
  }

  // ---------- toolbar actions ----------------------------------------

  function openAddProduct() {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    const available = ctx.products.filter((p) => !ctx.items.has(p.id) || ctx.items.get(p.id).included === false);
    openSheet({
      title: 'Add product to event menu',
      variant: 'admin-full',
      bodyHtml: '<p class="muted plan-sheet-lead">Adds the product to this event’s menu only — the library and stock are unchanged.</p><div id="planAddSearch"></div>',
      footHtml: `<div class="admin-drawer-foot"><button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="planAddCancel">Close</button></div>`,
    });
    mountProductSearch($('planAddSearch'), {
      products: available,
      categories: ctx.categories,
      caseSizes: ctx.caseSizes,
      placeholder: 'Search library to add…',
      onSelect: async ({ productId }) => {
        try {
          const patch = { included: true };
          const saved = await upsertEventMenuItem(ctx.eventId, productId, patch);
          ctx.items.set(productId, saved || { product_id: productId, ...patch });
          lineFor(productId);
          closeSheet();
          paintGrid();
          toast(`${ctx.productById.get(productId)?.name || 'Product'} added to menu`);
        } catch (err) {
          toast(err.message || 'Add failed', true);
        }
      },
    });
    $('planAddCancel').onclick = closeSheet;
  }

  function openAddScenario() {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    const el = openModal({
      title: 'New pricing scenario',
      bodyHtml: `
        <div class="admin-drawer-form">
          <label class="admin-field"><span class="admin-label">Name</span>
            <input class="admin-input" id="scnName" maxlength="60" placeholder="e.g. Client rate, +5% 2027"></label>
          <label class="admin-field"><span class="admin-label">Start from</span>
            <select class="admin-select" id="scnBase">
              <option value="menu">Event menu prices</option>
              <option value="blank">Blank</option>
            </select></label>
          <label class="admin-field"><span class="admin-label">Change %</span>
            <input class="admin-input num-math" id="scnUplift" inputmode="decimal" placeholder="0"></label>
          <label class="plan-check"><input type="checkbox" id="scnClient"> Show in client exports</label>
          <p class="plan-form-err" id="scnErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Create</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const err = el.querySelector('#scnErr');
      const name = el.querySelector('#scnName').value.trim();
      const upliftRaw = el.querySelector('#scnUplift').value.trim();
      const uplift = upliftRaw ? Number(upliftRaw.replace('%', '')) : 0;
      if (!name) { err.textContent = 'Name is required'; err.hidden = false; return; }
      if (!Number.isFinite(uplift) || uplift <= -100) { err.textContent = 'Change % must be a number above -100'; err.hidden = false; return; }
      if (ctx.scenarios.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        err.textContent = 'A scenario with that name already exists'; err.hidden = false; return;
      }
      const base = el.querySelector('#scnBase').value;
      el.querySelector('[data-ok]').disabled = true;
      try {
        const scenario = await createScenario(ctx.eventId, {
          name,
          client_visible: el.querySelector('#scnClient').checked,
          sort_order: ctx.scenarios.length,
        });
        const lines = [...ctx.lines.values()].filter((l) => l.included);
        const rows = base === 'blank' ? [] : scenarioPricesFrom(lines, uplift, 0.05, roundUpToStep);
        const saved = await replaceScenarioPrices(scenario.id, rows);
        scenario.scenario_prices = saved || rows;
        ctx.scenarios.push(scenario);
        closeModal();
        paintGrid();
        toast(`Scenario “${name}” created`);
      } catch (e2) {
        el.querySelector('[data-ok]').disabled = false;
        err.textContent = e2.message || 'Could not create scenario';
        err.hidden = false;
      }
    };
    requestAnimationFrame(() => el.querySelector('#scnName')?.focus());
  }

  function openScenarioEditor(id) {
    const s = ctx.scenarios.find((x) => x.id === id);
    if (!s) return;
    const dis = locked() ? 'disabled' : '';
    const el = openModal({
      title: 'Edit scenario',
      bodyHtml: `
        <div class="admin-drawer-form">
          <label class="admin-field"><span class="admin-label">Name</span>
            <input class="admin-input" id="scnEditName" maxlength="60" value="${escapeHtml(s.name)}" ${dis}></label>
          <label class="plan-check"><input type="checkbox" id="scnEditClient" ${s.client_visible ? 'checked' : ''} ${dis}> Show in client exports</label>
          <p class="plan-form-err" id="scnEditErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--danger" data-delete ${dis}>Delete</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok ${dis}>Save</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const name = el.querySelector('#scnEditName').value.trim();
      const err = el.querySelector('#scnEditErr');
      if (!name) { err.textContent = 'Name is required'; err.hidden = false; return; }
      try {
        const saved = await updateScenario(s.id, { name, client_visible: el.querySelector('#scnEditClient').checked });
        Object.assign(s, { name: saved?.name ?? name, client_visible: saved?.client_visible ?? el.querySelector('#scnEditClient').checked });
        closeModal();
        paintGrid();
      } catch (e2) {
        err.textContent = e2.message || 'Save failed';
        err.hidden = false;
      }
    };
    el.querySelector('[data-delete]').onclick = async () => {
      closeModal();
      const ok = await confirmDialog({
        title: 'Delete scenario',
        message: `Delete “${s.name}” and its prices? Event menu prices are not affected.`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      try {
        await deleteScenario(s.id);
        ctx.scenarios = ctx.scenarios.filter((x) => x.id !== s.id);
        paintGrid();
        toast('Scenario deleted');
      } catch (e2) {
        toast(e2.message || 'Delete failed', true);
      }
    };
  }

  async function toggleCostLock() {
    if (locked()) { toast('Costs are frozen for reconciled events', true); return; }
    const snapshots = [...ctx.items.values()].filter((i) => i.unit_cost_snapshot != null).length;
    if (snapshots) {
      const ok = await confirmDialog({
        title: 'Unlock costs',
        message: `${snapshots} menu item cost${snapshots === 1 ? ' is' : 's are'} locked. Unlock to use live supplier and deal costs again?`,
        confirmLabel: 'Unlock costs',
        danger: false,
      });
      if (!ok) return;
      try {
        await clearEventCostSnapshots(ctx.eventId);
        await reload();
        toast('Costs unlocked');
      } catch (err) {
        toast(err.message || 'Unlock failed', true);
      }
      return;
    }
    const ok = await confirmDialog({
      title: 'Lock costs',
      message: 'Freeze today’s cost per unit on every menu item so later supplier price changes don’t move this event’s GP. Costs also lock automatically when the event is reconciled.',
      confirmLabel: 'Lock costs',
      danger: false,
    });
    if (!ok) return;
    try {
      const n = await snapshotEventCosts(ctx.eventId);
      await reload();
      toast(`Locked ${Number(n) || 0} cost${Number(n) === 1 ? '' : 's'}`);
    } catch (err) {
      toast(err.message || 'Lock failed', true);
    }
  }

  function includedMenuCount() {
    return [...ctx.items.values()].filter((item) => item.included !== false).length;
  }

  function menuNameTaken(err) {
    const msg = String(err?.message || err || '');
    return /already exists/i.test(msg) || /\b23505\b/.test(msg);
  }

  function saveMenuForm(count, suggested) {
    return {
      title: 'Save menu',
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="admin-modal-confirm-msg">Saves the ${count} product${count === 1 ? '' : 's'} on this menu, with their menu price, suggested price, target GP and serves per unit. You can apply it to any event. Projected serves and deal costs stay on this event.</p>
          <label class="admin-field"><span class="admin-label">Name</span>
            <input class="admin-input" id="savedMenuName" maxlength="60" value="${escapeHtml(suggested)}" placeholder="e.g. Festival bar"></label>
          <p class="plan-form-err" id="savedMenuErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Save menu</button>
        </div>`,
    };
  }

  function bindSaveMenu(el) {
    const nameInput = el.querySelector('#savedMenuName');
    const err = el.querySelector('#savedMenuErr');
    let replaceExisting = false;
    el.querySelector('[data-cancel]').onclick = closeModal;
    nameInput.addEventListener('input', () => {
      if (!replaceExisting) return;
      replaceExisting = false;
      el.querySelector('[data-ok]').textContent = 'Save menu';
      err.hidden = true;
    });
    el.querySelector('[data-ok]').onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { err.textContent = 'Name is required'; err.hidden = false; return; }
      const okBtn = el.querySelector('[data-ok]');
      okBtn.disabled = true;
      try {
        await flushSaves();
        await saveEventMenu(ctx.eventId, name, replaceExisting);
        closeModal();
        toast(replaceExisting ? `Updated “${name}”` : `Saved “${name}”`);
      } catch (e2) {
        okBtn.disabled = false;
        if (menuNameTaken(e2)) {
          replaceExisting = true;
          okBtn.textContent = 'Update menu';
          err.textContent = `“${name}” already exists. Update replaces its products and prices with this event’s menu.`;
          err.hidden = false;
          return;
        }
        err.textContent = e2.message || 'Could not save menu';
        err.hidden = false;
      }
    };
    requestAnimationFrame(() => {
      nameInput?.focus();
      nameInput?.select();
    });
  }

  async function openSaveMenu() {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    await flushSaves();
    const count = includedMenuCount();
    if (!count) { toast('Add products to the menu before saving it', true); return; }
    const suggested = String(ctx.event?.name || '').trim().slice(0, 60);
    bindSaveMenu(openModal(saveMenuForm(count, suggested)));
  }

  function showSaveMenu(el) {
    const count = includedMenuCount();
    if (!count) { toast('Add products to the menu before saving it', true); return; }
    const suggested = String(ctx.event?.name || '').trim().slice(0, 60);
    const form = saveMenuForm(count, suggested);
    el.querySelector('.admin-modal-title').textContent = form.title;
    el.querySelector('.admin-modal-body').innerHTML = form.bodyHtml;
    el.querySelector('.admin-modal-foot').innerHTML = form.footHtml;
    bindSaveMenu(el);
  }

  function savedMenuOptions(menus, selectedId) {
    return menus.map((menu) => {
      const n = savedMenuProductCount(menu);
      const label = `${menu.name} (${n} product${n === 1 ? '' : 's'})`;
      const selected = menu.id === selectedId ? ' selected' : '';
      return `<option value="${escapeHtml(menu.id)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  async function openApplyMenu() {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    let menus = [];
    try {
      menus = (await listSavedMenus()) || [];
    } catch (err) {
      toast(err.message || 'Could not load saved menus', true);
      return;
    }

    const el = openModal({
      title: 'Apply menu',
      bodyHtml: menus.length ? `
        <div class="admin-drawer-form">
          <p class="admin-modal-confirm-msg">Copies the saved menu onto this event. Products already here keep their prices unless you overwrite them. Projected serves and deal costs are left alone.</p>
          <label class="admin-field"><span class="admin-label">Saved menu</span>
            <select class="admin-select" id="applyMenu">${savedMenuOptions(menus)}</select></label>
          <label class="plan-check"><input type="checkbox" id="applyRefresh"> Overwrite prices already on this event</label>
          <p class="plan-form-err" id="applyMenuErr" hidden></p>
        </div>` : `
        <p class="admin-modal-confirm-msg">No saved menus yet. Save this event’s menu, then apply that same menu to any other event.</p>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          ${menus.length ? '<button type="button" class="admin-drawer-btn admin-drawer-btn--danger" data-delete>Delete</button>' : ''}
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>${menus.length ? 'Apply menu' : 'Save this menu'}</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    if (!menus.length) {
      el.querySelector('[data-ok]').onclick = async () => {
        await flushSaves();
        showSaveMenu(el);
      };
      return;
    }

    let pendingDeleteId = '';
    const deleteBtn = el.querySelector('[data-delete]');
    el.querySelector('#applyMenu').addEventListener('change', () => {
      pendingDeleteId = '';
      deleteBtn.textContent = 'Delete';
      el.querySelector('#applyMenuErr').hidden = true;
    });
    deleteBtn.onclick = async () => {
      const id = el.querySelector('#applyMenu').value;
      const menu = menus.find((m) => m.id === id);
      const err = el.querySelector('#applyMenuErr');
      if (!menu) return;
      if (pendingDeleteId !== id) {
        pendingDeleteId = id;
        deleteBtn.textContent = 'Confirm delete';
        err.textContent = `Delete “${menu.name}”? Events that already used it keep their own copy.`;
        err.hidden = false;
        return;
      }
      deleteBtn.disabled = true;
      try {
        await deleteSavedMenu(id);
        menus = menus.filter((m) => m.id !== id);
        pendingDeleteId = '';
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
        toast(`Deleted “${menu.name}”`);
        if (!menus.length) {
          closeModal();
          return;
        }
        el.querySelector('#applyMenu').innerHTML = savedMenuOptions(menus);
        err.hidden = true;
      } catch (e2) {
        deleteBtn.disabled = false;
        err.textContent = e2.message || 'Could not delete menu';
        err.hidden = false;
      }
    };

    el.querySelector('[data-ok]').onclick = async () => {
      const id = el.querySelector('#applyMenu').value;
      const menu = menus.find((m) => m.id === id);
      const refresh = el.querySelector('#applyRefresh').checked;
      const err = el.querySelector('#applyMenuErr');
      if (!menu) { err.textContent = 'Choose a menu'; err.hidden = false; return; }
      el.querySelector('[data-ok]').disabled = true;
      try {
        const added = Number(await applySavedMenu(ctx.eventId, menu.id, refresh)) || 0;
        closeModal();
        await reload();
        const addedLabel = `${added} product${added === 1 ? '' : 's'} added`;
        toast(refresh
          ? `${menu.name} applied — ${addedLabel}, prices overwritten`
          : (added
            ? `${addedLabel} from ${menu.name}. Existing prices were left as they are.`
            : `Every product on ${menu.name} is already on this menu. Prices were left as they are.`));
      } catch (e2) {
        el.querySelector('[data-ok]').disabled = false;
        err.textContent = e2.message || 'Could not apply menu';
        err.hidden = false;
      }
    };
  }

  function onToolbarAction(e) {
    const action = e.detail?.action;
    const handlers = {
      'plan-save-menu': () => { void openSaveMenu(); },
      'plan-apply-menu': () => { void openApplyMenu(); },
      'plan-add-product': openAddProduct,
      'plan-add-scenario': openAddScenario,
      'plan-costs': toggleCostLock,
      'plan-export': () => {
        if (!ctx.event) return;
        openMenuExportDialog(ctx);
      },
    };
    if (!handlers[action]) return;
    e.detail.handled = true;
    handlers[action]();
  }

  function onTableFilter(e) {
    if (e.detail?.panel !== 'planning') return;
    const prevCols = JSON.stringify(ctx.filter.hiddenColumns || []);
    ctx.filter = e.detail.values || {};
    if (prevCols !== JSON.stringify(ctx.filter.hiddenColumns || [])) paintGrid();
    else {
      const body = $('planBody');
      if (body) body.innerHTML = renderBody();
    }
  }

  function onProductFilter(e) {
    ctx.query = e.detail?.query || '';
    const body = $('planBody');
    if (body) body.innerHTML = renderBody();
    if (e.detail?.productId) {
      panel.querySelector(`tr[data-pid="${CSS.escape(e.detail.productId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    if (e.detail) e.detail.handled = true;
  }

  // ---------- load ---------------------------------------------------

  async function reload() {
    await flushSaves();
    const [event, items, scenarios, products, caseSizes, categories] = await Promise.all([
      loadEventPricing(ctx.eventId),
      listEventMenu(ctx.eventId),
      listScenarios(ctx.eventId),
      loadLibraryProducts(),
      loadCaseSizes(),
      loadCategories(),
    ]);
    if (ctx.abort) return;
    if (!event) throw new Error('Event not found');
    ctx.event = event;
    ctx.items = new Map((items || []).map((i) => [i.product_id, i]));
    ctx.scenarios = scenarios || [];
    ctx.products = (products || []).filter((p) => !p.archived && (p.product_kind || 'stock') === 'stock');
    ctx.productById = new Map((products || []).map((p) => [p.id, p]));
    ctx.caseSizes = caseSizes || [];
    ctx.categories = categories || [];
    const [accounts, clientId] = await Promise.all([
      listAccounts().catch(() => null),
      loadEventClientAccount(ctx.eventId).catch(() => null),
    ]);
    if (ctx.abort) return;
    ctx.accounts = accounts;
    ctx.clientAccountId = clientId;
    recomputeAll();
    setTableFilterContext('planning', {
      categories: [...new Set([...ctx.lines.values()].map((l) => l.category))].sort(),
    });
    paint();
  }

  function onLoadError(err) {
    reportError(err, { source: 'admin.planning.reload', silent: true });
    const missing = isPlanningSchemaMissing(err);
    panel.innerHTML = errorState({
      title: missing ? 'Planning isn’t set up yet' : 'Couldn’t load menu & GP',
      copy: missing
        ? 'The pricing tables are missing. Apply migration 068_pricing_gp_planning.sql, then retry.'
        : (err.message || 'Failed to load'),
      variant: 'admin',
    });
    bindEmptyRetry(panel, () => reload().catch(onLoadError));
  }

  panel.addEventListener('input', (e) => {
    if (e.target.closest('#planSettings')) onSettingsInput(e);
    else onGridInput(e);
  });
  panel.addEventListener('change', (e) => {
    if (!e.target.closest('#planSettings')) void onGridChange(e);
  });
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('pointerdown', onColPointerDown);
  document.addEventListener('pointermove', onColPointerMove, { passive: false });
  document.addEventListener('pointerup', endColDrag);
  document.addEventListener('pointercancel', endColDrag);
  document.addEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
  document.addEventListener(ADMIN_TABLE_FILTER, onTableFilter);
  document.addEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);

  reload().catch(onLoadError);

  return () => {
    ctx.abort = true;
    void flushSaves();
    if (colDrag?.raf) cancelAnimationFrame(colDrag.raf);
    colDrag = null;
    panel.classList.remove('plan-col-dragging');
    panel.removeEventListener('click', onPanelClick);
    panel.removeEventListener('pointerdown', onColPointerDown);
    document.removeEventListener('pointermove', onColPointerMove);
    document.removeEventListener('pointerup', endColDrag);
    document.removeEventListener('pointercancel', endColDrag);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  };
}
