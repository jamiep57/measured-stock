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
import { openCocktailEditor } from '../planning-cocktail.js';
import {
  closePlanningContextMenu,
  editablePlanningField,
  openPlanningContextMenu,
  planningColumnLabel,
  planningContextActions,
} from '../planning-context-menu.js';
import { ADMIN_PRODUCT_FILTER, getLastProductFilter } from '../global-search.js';
import { ADMIN_TOOLBAR_ACTION } from '../topbar-toolbar.js';
import { ADMIN_TABLE_FILTER, getTableFilterValues, setTableFilterContext } from '../table-filter.js';
import { formatGpPct, roundUpToStep } from '../../lib/gp.js';
import {
  liveUnitCost,
  menuTotals,
  formatPlanningPriceInput,
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
import { cocktailLineKey, drinkKindMeta, resolveCocktailLine } from '../../lib/menu-cocktails.js';
import { serveSizeOf } from '../../lib/menu-exports.js';
import {
  PLANNING_MARK_IDS,
  planningCellMark,
  planningRowMark,
  readPlanningMarks,
  setPlanningMark,
  writePlanningMarks,
} from '../../lib/planning-marks.js';
import {
  clearEventCostSnapshots,
  createScenario,
  deleteEventCocktail,
  deleteScenario,
  isCocktailSchemaMissing,
  isEventPricingLocked,
  isPlanningSchemaMissing,
  listEventCocktails,
  listEventMenu,
  listScenarios,
  loadEventPricing,
  normaliseCocktail,
  replaceScenarioPrices,
  scenarioPricesFrom,
  applySavedMenu,
  deleteSavedMenu,
  listSavedMenus,
  saveEventMenu,
  savedMenuProductCount,
  setScenarioPrice,
  snapshotEventCosts,
  updateEventCocktail,
  updateEventMenuItem,
  updateEventPricing,
  updateScenario,
  insertEventMenuItem,
  patchEventMenuItems,
} from '../../lib/planning-data.js';
import { baseMenuItem, portionOf, serveKey, SHARED_MENU_FIELDS } from '../../lib/menu-serves.js';

const SAVE_DEBOUNCE_MS = 450;

const NUMERIC_FIELDS = {
  serves_per_unit: { max: null, positive: true },
  portion: { max: null, positive: true },
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
  { key: 'serves', label: 'Target serves' },
  { key: 'revenue', label: 'Revenue / GP £' },
  { key: 'deal', label: 'Deal cost & ref' },
];

function money(n, dp = 2) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function formatMeasures(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return v.toFixed(4).replace(/\.?0+$/, '');
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
    cocktails: new Map(),
    cocktailsUnavailable: false,
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
    marks: readPlanningMarks(typeof localStorage === 'undefined' ? null : localStorage, route.eventId),
    abort: false,
  };

  const locked = () => isEventPricingLocked(ctx.event);
  const colOn = (key) => !(ctx.filter.hiddenColumns || []).includes(key);

  // ---------- derived data -------------------------------------------

  function itemsForProduct(pid) {
    return [...ctx.items.values()].filter((item) => item.product_id === pid);
  }

  function suggestedServeSize(line) {
    if (!line || line.kind === 'cocktail') return '';
    return serveSizeOf({ ...line, serveLabel: '' });
  }

  function serveLabelTaken(pid, label, exceptId) {
    const key = serveKey(label);
    return itemsForProduct(pid).some((item) => item.id !== exceptId && serveKey(item.serve_label) === key);
  }

  /** One full serve per product, for cocktail costing. */
  function cocktailItemMap() {
    const map = new Map();
    const grouped = new Map();
    ctx.items.forEach((item) => {
      const list = grouped.get(item.product_id) || [];
      list.push(item);
      grouped.set(item.product_id, list);
    });
    grouped.forEach((list, pid) => {
      const base = baseMenuItem(list);
      if (base) map.set(pid, { ...base, portion: 1 });
    });
    return map;
  }

  function lineFor(itemId) {
    const item = ctx.items.get(itemId);
    if (!item) return null;
    const line = resolveMenuLine(item, {
      product: ctx.productById.get(item.product_id),
      event: ctx.event,
      caseSizes: ctx.caseSizes,
    });
    ctx.lines.set(itemId, line);
    return line;
  }

  function cocktailLineFor(cocktail) {
    const line = resolveCocktailLine(cocktail, cocktail.ingredients, {
      productById: ctx.productById,
      items: cocktailItemMap(),
      caseSizes: ctx.caseSizes,
      event: ctx.event,
    });
    ctx.lines.set(cocktailLineKey(cocktail.id), line);
    return line;
  }

  function recomputeAll() {
    ctx.lines.clear();
    ctx.items.forEach((_item, id) => lineFor(id));
    ctx.cocktails.forEach((cocktail) => cocktailLineFor(cocktail));
  }

  function scenarioPrice(scenario, itemId) {
    const row = (scenario.scenario_prices || []).find((r) => r.menu_item_id === itemId);
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
        const p = l.productId ? ctx.productById.get(l.productId) : null;
        const hay = [l.name, l.menuName, l.serveLabel, l.caseSize, l.category, l.ingredientSummary, p?.sku, productSupplierSearchText(p)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sort = ctx.filter.sort || 'category';
    const byName = (a, b) => a.name.localeCompare(b.name)
      || String(a.serveLabel || '').localeCompare(String(b.serveLabel || ''))
      || (a.portion || 1) - (b.portion || 1);
    if (sort === 'name') rows.sort(byName);
    else if (sort === 'gp-asc') rows.sort((a, b) => (a.gpPct ?? Infinity) - (b.gpPct ?? Infinity));
    else if (sort === 'gp-desc') rows.sort((a, b) => (b.gpPct ?? -Infinity) - (a.gpPct ?? -Infinity));
    else if (sort === 'revenue-desc') rows.sort((a, b) => (b.revenueGross ?? -1) - (a.revenueGross ?? -1));
    else rows.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));
    return rows;
  }

  // ---------- rendering ----------------------------------------------

  function cellInput(field, value, { placeholder = '', label = '', text = false, width = '', suffix = '', money = false } = {}) {
    const dis = locked() ? 'disabled' : '';
    if (text) {
      const wide = width === 'size' ? ' plan-cell-input--size' : '';
      return `<input type="text" class="plan-cell-input plan-cell-input--text${wide}" data-field="${field}"
        value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}"
        maxlength="${width === 'size' ? 40 : 120}" autocomplete="off" ${dis}>`;
    }
    const shown = money ? formatPlanningPriceInput(value) : inputValue(value);
    const hint = money ? formatPlanningPriceInput(placeholder) : placeholder;
    const input = `<input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input${width ? ` plan-cell-input--${width}` : ''}"
      data-field="${field}"${money ? ' data-money="1"' : ''} value="${escapeHtml(shown)}" placeholder="${escapeHtml(hint)}"
      aria-label="${escapeHtml(label)}" ${dis}>`;
    if (money) {
      return `<span class="plan-cell-affix plan-cell-affix--money"><span class="plan-cell-prefix" aria-hidden="true">£</span>${input}</span>`;
    }
    if (!suffix) return input;
    const mark = escapeHtml(suffix);
    return `<span class="plan-cell-affix"><span class="plan-cell-suffix plan-cell-suffix--balance" aria-hidden="true">${mark}</span>${input}<span class="plan-cell-suffix" aria-hidden="true">${mark}</span></span>`;
  }

  function paintMoneyInput(input) {
    if (!input?.matches?.('[data-money]')) return;
    const parsed = parsePlanningNumber(input.value);
    if (!parsed.ok) return;
    const next = formatPlanningPriceInput(parsed.value);
    if (input.value !== next) input.value = next;
  }

  function columnShown(id) {
    if (id.startsWith('scenario:')) return colOn('scenarios');
    if (id === 'gp-amount') return colOn('revenue');
    if (id === 'deal-ref') return colOn('deal');
    if (id === 'size' || id === 'menu' || id === 'target' || id === 'gp') return true;
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
    if (id === 'size') return th(id, 'Size', 'Serve the customer buys: 330ml, 440ml, pint or half', 'plan-th--size');
    if (id === 'serve') return th(id, 'Serves', 'Serves from one case (e.g. 24 cans, or 88 pints from a keg)');
    if (id === 'cost') return th(id, 'Cost', 'Cost per serve (ex VAT)');
    if (id === 'menu') return th(id, 'Menu £', 'Event menu price inc VAT', 'plan-th--key');
    if (id === 'target') return th(id, 'Target', 'Target GP %');
    if (id === 'required') return th(id, 'Required', 'Price inc VAT needed to hit the target GP — click to use');
    if (id === 'suggested') return th(id, 'Suggested', 'Suggested selling price (defaults to required)');
    if (id === 'gp') return th(id, 'GP', 'Projected GP % at the menu price', 'plan-th--key');
    if (id === 'serves') return th(id, 'Target serves', 'Target serves for the event', 'plan-th--narrow');
    if (id === 'revenue') return th(id, 'Revenue', 'Projected revenue inc VAT');
    if (id === 'gp-amount') return th(id, 'GP £', 'Projected GP £ (ex VAT)');
    if (id === 'deal') return th(id, 'Deal cost', 'Agreed price of one can, bottle or keg. Cost per serve is this times the units in the case, divided once by Serves');
    if (id === 'deal-ref') return th(id, 'Deal ref', 'Deal or agreement reference', 'plan-th--ref');
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

  function markRowKey(line) {
    return line.kind === 'cocktail' ? `c:${line.cocktailId}` : `p:${line.itemId}`;
  }

  function markClasses(rowKey, colId) {
    const color = planningCellMark(ctx.marks, rowKey, colId);
    return color ? ` plan-cell--mark plan-cell--mark-${color}` : '';
  }

  function rowMarkClass(rowKey) {
    const color = planningRowMark(ctx.marks, rowKey);
    return color ? ` plan-row--mark plan-row--mark-${color}` : '';
  }

  function decorateCell(html, id, rowKey) {
    if (!html) return '';
    return html.replace(
      /^<td class="([^"]*)"/,
      `<td class="$1${markClasses(rowKey, id)}" data-col="${escapeHtml(id)}"`,
    );
  }

  function rowMenuButton(name) {
    return `<button type="button" class="plan-row-menu" data-row-menu aria-haspopup="menu" aria-label="Actions for ${escapeHtml(name)}">${icon('ellipsis', { size: 14 })}</button>`;
  }

  function sizeCell(line, item) {
    const typed = String(item?.serve_label || '').trim();
    const shown = typed || suggestedServeSize(line);
    const portion = portionOf(item);
    const portionInput = portion !== 1
      ? cellInput('portion', item.portion, { label: 'Share of one serve', width: 'sm' })
      : '';
    const serve = cellInput('serve_label', shown, { text: true, placeholder: 'Pint', label: 'Serve size', width: 'size' });
    const body = portionInput ? `<div class="plan-size-split">${serve}${portionInput}</div>` : serve;
    return `<td class="plan-cell">${body}</td>`;
  }

  function columnCell(id, line, item) {
    if (line.kind === 'cocktail') return cocktailColumnCell(id, line, item);
    const dis = locked() ? 'disabled' : '';
    if (id === 'size') return sizeCell(line, item);
    if (id === 'serve') {
      return `<td class="plan-cell">${cellInput('serves_per_unit', item.serves_per_unit, { placeholder: line.servesPerUnit ?? '', label: 'Serves from one case', width: 'sm' })}</td>`;
    }
    if (id === 'cost') {
      const split = line.caseCost != null && line.servesPerUnit
        ? (line.portion !== 1
          ? `${money(line.caseCost)} ÷ ${line.servesPerUnit} × ${line.portion}`
          : `${money(line.caseCost)} ÷ ${line.servesPerUnit} serves`)
        : `${money(line.unitCost)} per unit`;
      return `<td class="plan-cell plan-out" data-out="cost" title="${escapeHtml(`${costSourceLabel(line.costSource)} · ${split}`)}">
        ${money(line.costPerServe)}${line.costSource === 'locked' ? ` <span class="plan-lock">${icon('lock', { size: 11 })}</span>` : ''}
      </td>`;
    }
    if (id === 'menu') {
      return `<td class="plan-cell plan-cell--key">${cellInput('menu_price', item.menu_price, { placeholder: line.suggestedPrice, label: 'Menu price', money: true })}</td>`;
    }
    if (id === 'target') {
      return `<td class="plan-cell">${cellInput('target_gp_pct', item.target_gp_pct, { placeholder: line.targetGpPct != null ? String(line.targetGpPct) : '', label: 'Target GP %', width: 'sm', suffix: '%' })}</td>`;
    }
    if (id === 'required') {
      return `<td class="plan-cell plan-out" data-out="required">${line.requiredPrice != null && !locked()
        ? `<button type="button" class="plan-use-price" data-use-price="${line.requiredPrice}" title="Use as menu price">${money(line.requiredPrice)}</button>`
        : money(line.requiredPrice)}</td>`;
    }
    if (id === 'suggested') {
      return `<td class="plan-cell">${cellInput('suggested_price', item.suggested_price, { placeholder: line.requiredPrice, label: 'Suggested price', money: true })}</td>`;
    }
    if (id === 'gp') {
      return `<td class="plan-cell plan-cell--key plan-out" data-out="gp">${gpBadge(line.gpPct, line.status)}</td>`;
    }
    if (id.startsWith('scenario:')) {
      const s = ctx.scenarios.find((x) => scenarioColumnId(x.id) === id);
      if (!s) return '';
      const price = scenarioPrice(s, line.itemId);
      const sg = scenarioGp(line, price);
      return `<td class="plan-cell plan-cell--scenario" data-scenario="${escapeHtml(s.id)}">
          <div class="plan-scenario-cell">
            <span class="plan-cell-affix plan-cell-affix--money"><span class="plan-cell-prefix" aria-hidden="true">£</span><input type="text" inputmode="decimal" autocomplete="off" class="num-math plan-cell-input"
              data-money="1" data-scenario-price="${escapeHtml(s.id)}" value="${escapeHtml(formatPlanningPriceInput(price))}"
              aria-label="${escapeHtml(s.name)} price" ${dis}></span>
            <span class="plan-scenario-gp ${statusClass(sg.status)}" data-out="scenario-gp">${escapeHtml(formatGpPct(sg.gpPct))}</span>
          </div>
        </td>`;
    }
    if (id === 'serves') {
      return `<td class="plan-cell">${cellInput('projected_serves', item.projected_serves, { label: 'Target serves' })}</td>`;
    }
    if (id === 'revenue') {
      return `<td class="plan-cell plan-out" data-out="revenue">${money(line.revenueGross, 0)}</td>`;
    }
    if (id === 'gp-amount') {
      return `<td class="plan-cell plan-out" data-out="gp-amount">${money(line.gpAmount, 0)}</td>`;
    }
    if (id === 'deal') {
      const live = liveUnitCost(ctx.productById.get(line.productId));
      return `<td class="plan-cell">${cellInput('unit_cost_override', item.unit_cost_override, { placeholder: live, label: 'Deal cost per unit', money: true })}</td>`;
    }
    if (id === 'deal-ref') {
      return `<td class="plan-cell plan-cell--text">${cellInput('deal_ref', item.deal_ref, { text: true, placeholder: 'Ref', label: 'Deal reference' })}</td>`;
    }
    return '';
  }

  function cocktailColumnCell(id, line, item) {
    if (id === 'size') {
      return `<td class="plan-cell">${cellInput('serve_label', item.serve_label, { text: true, placeholder: 'Serve', label: 'Serve size', width: 'size' })}</td>`;
    }
    if (id === 'serve') {
      return '<td class="plan-cell"></td>';
    }
    if (id === 'cost') {
      const detail = (line.ingredients || []).map((p) => {
        const each = p.costPerMeasure == null ? 'no cost' : money(p.costPerMeasure);
        return `${p.name}: ${p.measures} × ${each}`;
      }).join('\n');
      return `<td class="plan-cell plan-out" data-out="cost" title="${escapeHtml(detail || 'Cost of the ingredients')}">${money(line.costPerServe)}</td>`;
    }
    if (id === 'menu') {
      return `<td class="plan-cell plan-cell--key">${cellInput('menu_price', item.menu_price, { placeholder: line.suggestedPrice, label: 'Menu price', money: true })}</td>`;
    }
    if (id === 'target') {
      return `<td class="plan-cell">${cellInput('target_gp_pct', item.target_gp_pct, { placeholder: line.targetGpPct != null ? String(line.targetGpPct) : '', label: 'Target GP %', width: 'sm', suffix: '%' })}</td>`;
    }
    if (id === 'required') {
      return `<td class="plan-cell plan-out" data-out="required">${line.requiredPrice != null && !locked()
        ? `<button type="button" class="plan-use-price" data-use-price="${line.requiredPrice}" title="Use as menu price">${money(line.requiredPrice)}</button>`
        : money(line.requiredPrice)}</td>`;
    }
    if (id === 'suggested') {
      return `<td class="plan-cell">${cellInput('suggested_price', item.suggested_price, { placeholder: line.requiredPrice, label: 'Suggested price', money: true })}</td>`;
    }
    if (id === 'gp') {
      return `<td class="plan-cell plan-cell--key plan-out" data-out="gp">${gpBadge(line.gpPct, line.status)}</td>`;
    }
    if (id.startsWith('scenario:')) {
      return `<td class="plan-cell plan-cell--scenario" title="Recipe drinks keep their menu price in scenarios"><span class="plan-scenario-gp ${statusClass(line.status)}">${escapeHtml(formatGpPct(line.gpPct))}</span></td>`;
    }
    if (id === 'serves') {
      return `<td class="plan-cell">${cellInput('projected_serves', item.projected_serves, { label: 'Target serves' })}</td>`;
    }
    if (id === 'revenue') {
      return `<td class="plan-cell plan-out" data-out="revenue">${money(line.revenueGross, 0)}</td>`;
    }
    if (id === 'gp-amount') {
      return `<td class="plan-cell plan-out" data-out="gp-amount">${money(line.gpAmount, 0)}</td>`;
    }
    if (id === 'deal' || id === 'deal-ref') {
      return `<td class="plan-cell plan-out" title="This drink’s cost comes from its ingredients">—</td>`;
    }
    return '';
  }

  function renderRow(line) {
    if (line.kind === 'cocktail') return renderCocktailRow(line);
    const pid = line.productId;
    const item = ctx.items.get(line.itemId) || {};
    const packMeta = line.caseSize
      ? `<span class="dist-item-meta">${escapeHtml(line.caseSize)}</span>` : '';
    const menuMeta = line.menuName && line.menuName !== line.name
      ? `<span class="dist-item-meta">${escapeHtml(line.menuName)}</span>` : '';
    const rowKey = markRowKey(line);
    const cells = shownColumnIds().map((id) => decorateCell(columnCell(id, line, item), id, rowKey)).join('');
    const label = line.serveLabel ? `${line.name} ${line.serveLabel}` : line.name;
    return `<tr class="dist-prod-row plan-row${line.included ? '' : ' plan-row--off'}${rowMarkClass(rowKey)}" data-item="${escapeHtml(line.itemId || '')}" data-pid="${escapeHtml(pid)}">
      <th class="dist-sticky plan-col-product${markClasses(rowKey, 'product')}" scope="row" data-col="product">
        <div class="plan-item">
          <div class="dist-item">
            <span class="dist-item-name" title="${escapeHtml(line.name)}">${escapeHtml(line.name)}</span>
            ${packMeta}
            ${menuMeta}
          </div>
          ${rowMenuButton(label)}
        </div>
      </th>${cells}</tr>`;
  }

  function renderIngredientSubRow(line, part) {
    const cells = shownColumnIds().map((id) => {
      if (id === 'serve') {
        return `<td class="plan-cell plan-sub-num">${escapeHtml(formatMeasures(part.measures))}</td>`;
      }
      if (id === 'cost') {
        const title = part.costPerMeasure == null
          ? 'No cost for this product'
          : `${formatMeasures(part.measures)} × ${money(part.costPerMeasure)}`;
        return `<td class="plan-cell plan-sub-num" data-out="ing-cost" data-ing="${escapeHtml(part.productId || '')}" title="${escapeHtml(title)}">${money(part.cost)}</td>`;
      }
      return '<td class="plan-cell"></td>';
    }).join('');
    const pack = part.pack ? `<span class="dist-item-meta">${escapeHtml(part.pack)}</span>` : '';
    return `<tr class="plan-sub-row${line.included ? '' : ' plan-row--off'}" data-cid-sub="${escapeHtml(line.cocktailId)}">
      <th class="dist-sticky plan-col-product" scope="row">
        <button type="button" class="plan-sub-open" data-edit-cocktail="${escapeHtml(line.cocktailId)}">
          <span class="plan-sub-label">↳ ${escapeHtml(part.name || 'Product')}</span>
          ${pack}
        </button>
      </th>${cells}</tr>`;
  }

  function renderCocktailRow(line) {
    const item = ctx.cocktails.get(line.cocktailId) || {};
    const serve = line.serveLabel
      ? `<span class="dist-item-meta">${escapeHtml(line.serveLabel)}</span>` : '';
    const parts = line.ingredients || [];
    const rowKey = markRowKey(line);
    const cells = shownColumnIds().map((id) => decorateCell(cocktailColumnCell(id, line, item), id, rowKey)).join('');
    const parent = `<tr class="dist-prod-row plan-row plan-row--cocktail${parts.length ? ' plan-row--has-subs' : ''}${line.included ? '' : ' plan-row--off'}${rowMarkClass(rowKey)}" data-cid="${escapeHtml(line.cocktailId)}">
      <th class="dist-sticky plan-col-product${markClasses(rowKey, 'product')}" scope="row" data-col="product">
        <div class="plan-item">
          <button type="button" class="plan-cocktail-open" data-edit-cocktail="${escapeHtml(line.cocktailId)}">
            <span class="dist-item-name" title="${escapeHtml(line.name)}">${escapeHtml(line.name)}</span>
            <span class="dist-item-meta">${escapeHtml(drinkKindMeta(line.drinkKind).label)}</span>
            ${serve}
          </button>
          ${rowMenuButton(line.name)}
        </div>
      </th>${cells}</tr>`;
    return parent + parts.map((part) => renderIngredientSubRow(line, part)).join('');
  }

  function renderBody() {
    const rows = visibleLines();
    if (!rows.length) {
      return `<tr><td colspan="${colCount()}" class="dist-empty">${ctx.items.size || ctx.cocktails.size
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
      const st = menuTotals(lines, { priceFor: (l) => (l.itemId ? scenarioPrice(s, l.itemId) : null) ?? l.menuPrice });
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
    closePlanningContextMenu();
    if (!ctx.items.size && !ctx.cocktails.size) {
      panel.innerHTML = emptyState({
        iconHtml: icon('calculator', { size: 22 }),
        title: 'Plan this event’s menu',
        copy: 'Add products and set prices here, or sell a cocktail or a spirit and mixer as one drink costed from its ingredients. Save the menu when you want to reuse it on another event.',
        variant: 'admin',
        ctaHtml: '<button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-add-product>Add product</button> <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-add-cocktail>Create cocktail</button> <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-add-spirit-mixer>Spirit & mixer</button>',
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
    closePlanningContextMenu();
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
  function refreshRow(itemId) {
    const line = lineFor(itemId);
    const row = panel.querySelector(`tr.plan-row[data-item="${CSS.escape(itemId)}"]`);
    if (line && row) {
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
        const sg = scenarioGp(line, scenarioPrice(s, itemId));
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
    if (line) refreshCocktailsUsing(line.productId);
    paintKpis();
  }

  function refreshCocktailRow(id) {
    const cocktail = ctx.cocktails.get(id);
    if (!cocktail) return;
    const line = cocktailLineFor(cocktail);
    const row = panel.querySelector(`tr.plan-row[data-cid="${CSS.escape(id)}"]`);
    if (row) {
      const set = (key, html) => {
        const el = row.querySelector(`[data-out="${key}"]`);
        if (el) el.innerHTML = html;
      };
      set('gp', gpBadge(line.gpPct, line.status));
      set('cost', money(line.costPerServe));
      set('required', line.requiredPrice != null && !locked()
        ? `<button type="button" class="plan-use-price" data-use-price="${line.requiredPrice}" title="Use as menu price">${money(line.requiredPrice)}</button>`
        : money(line.requiredPrice));
      set('revenue', money(line.revenueGross, 0));
      set('gp-amount', money(line.gpAmount, 0));
      const menuInput = row.querySelector('[data-field="menu_price"]');
      if (menuInput) menuInput.placeholder = line.suggestedPrice != null ? line.suggestedPrice.toFixed(2) : '';
      const sugInput = row.querySelector('[data-field="suggested_price"]');
      if (sugInput) sugInput.placeholder = line.requiredPrice != null ? line.requiredPrice.toFixed(2) : '';
      const tgtInput = row.querySelector('[data-field="target_gp_pct"]');
      if (tgtInput) tgtInput.placeholder = line.targetGpPct != null ? String(line.targetGpPct) : '';
      row.querySelectorAll('.plan-cell--scenario .plan-scenario-gp').forEach((el) => {
        el.textContent = formatGpPct(line.gpPct);
        el.className = `plan-scenario-gp ${statusClass(line.status)}`;
      });
    }
    panel.querySelectorAll(`tr.plan-sub-row[data-cid-sub="${CSS.escape(id)}"]`).forEach((sub) => {
      const cell = sub.querySelector('[data-out="ing-cost"]');
      const part = (line.ingredients || []).find((p) => p.productId === cell?.dataset.ing);
      if (cell && part) cell.textContent = money(part.cost);
    });
  }

  function refreshCocktailsUsing(pid) {
    ctx.cocktails.forEach((cocktail) => {
      if ((cocktail.ingredients || []).some((ing) => ing.product_id === pid)) refreshCocktailRow(cocktail.id);
    });
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

  function setItemField(itemId, field, value, { immediate = false } = {}) {
    const item = ctx.items.get(itemId);
    if (!item) return null;
    if (field === 'serve_label' && serveLabelTaken(item.product_id, value, itemId)) {
      toast('This product already has that serve', true);
      return null;
    }
    const targets = SHARED_MENU_FIELDS.has(field) ? itemsForProduct(item.product_id) : [item];
    targets.forEach((row) => { row[field] = value; });
    targets.forEach((row) => {
      refreshRow(row.id);
      if (row.id === itemId) return;
      const tr = panel.querySelector(`tr.plan-row[data-item="${CSS.escape(row.id)}"]`);
      const input = tr?.querySelector(`[data-field="${CSS.escape(field)}"]`);
      if (!input || document.activeElement === input) return;
      if (field === 'deal_ref') input.value = value || '';
      else if (field === 'unit_cost_override') input.value = formatPlanningPriceInput(value);
      else input.value = value == null ? '' : String(value);
    });
    const save = async () => {
      if (SHARED_MENU_FIELDS.has(field)) {
        await patchEventMenuItems(ctx.eventId, item.product_id, { [field]: value });
        return;
      }
      const saved = await updateEventMenuItem(itemId, { [field]: value });
      if (saved) ctx.items.set(itemId, { ...ctx.items.get(itemId), ...saved });
    };
    if (immediate) {
      return save().then(() => true, (err) => {
        toast(err.message || 'Save failed', true);
        return false;
      });
    }
    const key = SHARED_MENU_FIELDS.has(field) ? `${item.product_id}:${field}` : `${itemId}:${field}`;
    queueSave(key, save);
    return null;
  }

  function setCocktailField(id, field, value, { immediate = false } = {}) {
    const cocktail = ctx.cocktails.get(id);
    if (!cocktail) return null;
    cocktail[field] = value;
    refreshCocktailRow(id);
    paintKpis();
    const save = () => updateEventCocktail(id, { [field]: value });
    if (immediate) {
      return save().then(() => true, (err) => {
        toast(err.message || 'Save failed', true);
        return false;
      });
    }
    queueSave(`cocktail:${id}:${field}`, save);
    return null;
  }

  function onGridInput(e) {
    const input = e.target;
    const row = input.closest('tr.plan-row');
    if (!row) return;
    if (row.dataset.cid) {
      const field = input.dataset.field;
      if (!field || field === 'included') return;
      if (field === 'serve_label') {
        setCocktailField(row.dataset.cid, field, input.value.trim() || null);
        return;
      }
      const spec = NUMERIC_FIELDS[field];
      if (!spec) return;
      const parsed = parsePlanningNumber(input.value, { max: spec.max ?? undefined });
      const ok = parsed.ok && !(spec.positive && parsed.value === 0);
      input.classList.toggle('is-invalid', !ok);
      if (!ok) return;
      setCocktailField(row.dataset.cid, field, parsed.value);
      return;
    }
    const itemId = row.dataset.item;
    const item = ctx.items.get(itemId);
    if (!item) return;

    if (input.dataset.scenarioPrice) {
      const parsed = parsePlanningNumber(input.value);
      input.classList.toggle('is-invalid', !parsed.ok);
      if (!parsed.ok) return;
      const s = ctx.scenarios.find((x) => x.id === input.dataset.scenarioPrice);
      if (!s) return;
      const list = (s.scenario_prices || []).filter((r) => r.menu_item_id !== itemId);
      if (parsed.value != null) list.push({ menu_item_id: itemId, product_id: item.product_id, price: parsed.value });
      s.scenario_prices = list;
      refreshRow(itemId);
      queueSave(`${itemId}:scenario:${s.id}`, () => setScenarioPrice(s.id, itemId, item.product_id, parsed.value));
      return;
    }

    const field = input.dataset.field;
    if (!field || field === 'included') return;
    if (field === 'deal_ref' || field === 'serve_label') {
      setItemField(itemId, field, input.value.trim() || null);
      return;
    }
    const spec = NUMERIC_FIELDS[field];
    if (!spec) return;
    const parsed = parsePlanningNumber(input.value, { max: spec.max ?? undefined });
    const ok = parsed.ok && !(spec.positive && parsed.value === 0);
    input.classList.toggle('is-invalid', !ok);
    if (!ok) return;
    setItemField(itemId, field, parsed.value);
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
    colDrag.x = e.clientX;
    colDrag.y = e.clientY;
    if (!colDrag.active && e.type !== 'pointercancel') {
      const dx = e.clientX - colDrag.startX;
      const dy = e.clientY - colDrag.startY;
      if (dx * dx + dy * dy >= 25) colDrag.active = true;
    }
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

  const CELL_MARK_CLASSES = PLANNING_MARK_IDS.map((id) => `plan-cell--mark-${id}`);
  const ROW_MARK_CLASSES = PLANNING_MARK_IDS.map((id) => `plan-row--mark-${id}`);

  function persistMarks() {
    writePlanningMarks(typeof localStorage === 'undefined' ? null : localStorage, ctx.eventId, ctx.marks);
  }

  function applyMarks(row, rowKey) {
    const rowColor = planningRowMark(ctx.marks, rowKey);
    row.classList.remove('plan-row--mark', ...ROW_MARK_CLASSES);
    if (rowColor) row.classList.add('plan-row--mark', `plan-row--mark-${rowColor}`);
    row.querySelectorAll('[data-col]').forEach((cell) => {
      const color = planningCellMark(ctx.marks, rowKey, cell.dataset.col);
      cell.classList.remove('plan-cell--mark', ...CELL_MARK_CLASSES);
      if (color) cell.classList.add('plan-cell--mark', `plan-cell--mark-${color}`);
    });
  }

  function lineFromRow(row) {
    if (row?.dataset.cid) {
      const cocktail = ctx.cocktails.get(row.dataset.cid);
      return cocktail ? cocktailLineFor(cocktail) : null;
    }
    if (row?.dataset.item) return lineFor(row.dataset.item);
    return null;
  }

  function cellCopyText(row, line, colId) {
    if (colId === 'product') return line.name || '';
    const cell = row.querySelector(`[data-col="${CSS.escape(colId)}"]`);
    if (!cell) return '';
    const input = cell.querySelector('input');
    if (input) return input.value.trim();
    return cell.textContent.replace(/\s+/g, ' ').trim();
  }

  async function copyText(text) {
    const value = String(text || '').trim();
    if (!value || value === '—') {
      toast('Nothing to copy', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast('Copied');
    } catch {
      toast('Couldn’t copy', true);
    }
  }

  async function pasteCell(row, colId) {
    if (locked()) return;
    let text;
    try {
      text = String(await navigator.clipboard.readText()).trim();
    } catch {
      toast('Couldn’t read the clipboard', true);
      return;
    }
    const input = row.querySelector(`[data-col="${CSS.escape(colId)}"] input`);
    if (!input || input.disabled) return;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function useRequiredPrice(row, line) {
    const price = line.requiredPrice;
    if (price == null || locked()) return;
    const input = row.querySelector('[data-field="menu_price"]');
    if (input) input.value = price.toFixed(2);
    if (line.kind === 'cocktail') setCocktailField(line.cocktailId, 'menu_price', price);
    else setItemField(line.itemId, 'menu_price', price);
  }

  function clearPlanningCell(row, line, colId) {
    if (locked()) return;
    const kind = line.kind === 'cocktail' ? 'cocktail' : 'product';
    const field = editablePlanningField(kind, colId);
    if (!field) return;
    const input = row.querySelector(`[data-col="${CSS.escape(colId)}"] input`);
    if (input) {
      input.value = '';
      input.classList.remove('is-invalid');
    }
    if (field === 'scenario') {
      const scenarioId = colId.slice('scenario:'.length);
      const s = ctx.scenarios.find((x) => x.id === scenarioId);
      if (!s || !line.itemId) return;
      s.scenario_prices = (s.scenario_prices || []).filter((r) => r.menu_item_id !== line.itemId);
      refreshRow(line.itemId);
      queueSave(`${line.itemId}:scenario:${s.id}`, () => setScenarioPrice(s.id, line.itemId, line.productId, null));
      return;
    }
    if (line.kind === 'cocktail') setCocktailField(line.cocktailId, field, null);
    else setItemField(line.itemId, field, null);
  }

  function makeCocktailFromProduct(itemId, drinkKind) {
    if (!ensureCocktails()) return;
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    const item = ctx.items.get(itemId);
    const line = lineFor(itemId);
    if (!item || !line) return;
    const name = (line.menuName || line.name || drinkKindMeta(drinkKind).label).trim().slice(0, 80);
    openCocktail(null, {
      drinkKind,
      seed: {
        name,
        drink_kind: drinkKind,
        square_item_name: name,
        serve_label: item.serve_label || line.serveLabel || '',
        menu_price: item.menu_price ?? null,
        target_gp_pct: item.target_gp_pct ?? null,
        projected_serves: item.projected_serves ?? null,
        ingredients: [{ product_id: item.product_id, measures: portionOf(item) }],
      },
      convertItemId: itemId,
    });
  }

  async function toggleOnMenu(line) {
    const next = !line.included;
    if (line.kind === 'cocktail') await setCocktailField(line.cocktailId, 'included', next, { immediate: true });
    else await setItemField(line.itemId, 'included', next, { immediate: true });
    paintGrid();
    const name = line.name || 'Item';
    if (next) {
      toast(`${name} is back on the menu`);
      return;
    }
    toast(`${name} removed from the menu`, false, {
      action: {
        label: 'Undo',
        onClick: () => {
          const put = line.kind === 'cocktail'
            ? setCocktailField(line.cocktailId, 'included', true, { immediate: true })
            : setItemField(line.itemId, 'included', true, { immediate: true });
          Promise.resolve(put).then(() => paintGrid());
        },
      },
    });
  }

  async function deleteCocktailFromMenu(line) {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    const drink = drinkKindMeta(line.drinkKind).label.toLowerCase();
    const name = line.name || `this ${drink}`;
    const ok = await confirmDialog({
      title: `Delete ${drink}`,
      message: `Remove “${name}” from this event? The stock products stay in the library.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteEventCocktail(line.cocktailId);
      ctx.cocktails.delete(line.cocktailId);
      ctx.lines.delete(cocktailLineKey(line.cocktailId));
      showMenu();
      toast(`${drinkKindMeta(line.drinkKind).label} removed`);
    } catch (err) {
      toast(err.message || 'Could not delete cocktail', true);
    }
  }

  async function runContextAction(id, row, line, colId) {
    if (id === 'use-required') useRequiredPrice(row, line);
    else if (id === 'copy') await copyText(cellCopyText(row, line, colId));
    else if (id === 'copy-name') await copyText(line.name || '');
    else if (id === 'paste') await pasteCell(row, colId);
    else if (id === 'clear') clearPlanningCell(row, line, colId);
    else if (id === 'add-size') openAddSize(ctx.items.get(line.itemId));
    else if (id === 'make-cocktail') makeCocktailFromProduct(line.itemId, 'cocktail');
    else if (id === 'make-spirit-mixer') makeCocktailFromProduct(line.itemId, 'spirit_mixer');
    else if (id === 'edit-cocktail') openCocktail(line.cocktailId);
    else if (id === 'toggle-menu') await toggleOnMenu(line);
    else if (id === 'delete-cocktail') await deleteCocktailFromMenu(line);
  }

  function openRowMenu(row, colId, x, y, scope, anchor) {
    const line = lineFromRow(row);
    if (!line) return;
    const rowKey = markRowKey(line);
    const kind = line.kind === 'cocktail' ? 'cocktail' : 'product';
    let columnLabel = planningColumnLabel(colId);
    if (String(colId).startsWith('scenario:')) {
      const scenario = ctx.scenarios.find((s) => scenarioColumnId(s.id) === colId);
      if (scenario?.name) columnLabel = scenario.name;
    }
    const actions = planningContextActions({
      kind,
      drinkKind: line.drinkKind,
      included: !!line.included,
      colId,
      locked: locked(),
      hasRequired: line.requiredPrice != null,
    });
    const use = actions.cell.find((action) => action.id === 'use-required');
    if (use) use.hint = money(line.requiredPrice);
    const cell = row.querySelector(`[data-col="${CSS.escape(colId)}"]`);
    cell?.classList.add('plan-cell--menu');
    openPlanningContextMenu({
      x,
      y,
      title: line.name || 'Menu item',
      columnLabel,
      scope,
      marks: {
        cell: planningCellMark(ctx.marks, rowKey, colId),
        row: planningRowMark(ctx.marks, rowKey),
      },
      actions,
      anchor,
      onClose: () => cell?.classList.remove('plan-cell--menu'),
      onColor: (nextScope, color) => {
        const target = nextScope === 'row' ? 'row' : colId;
        ctx.marks = setPlanningMark(ctx.marks, rowKey, target, color);
        persistMarks();
        applyMarks(row, rowKey);
      },
      onAction: (id) => { void runContextAction(id, row, line, colId); },
    });
  }

  function onContextMenu(e) {
    const row = e.target.closest('tr.plan-row');
    if (!row || !panel.contains(row)) return;
    e.preventDefault();
    const cell = e.target.closest('[data-col]');
    const colId = cell?.dataset.col || 'product';
    const fromKeyboard = e.button === 0 && e.clientX === 0 && e.clientY === 0 && !e.ctrlKey && !e.metaKey;
    if (fromKeyboard) {
      const box = (cell || row).getBoundingClientRect();
      openRowMenu(row, colId, box.left, box.bottom + 4, 'cell', null);
      return;
    }
    openRowMenu(row, colId, e.clientX, e.clientY, 'cell', null);
  }

  function onPanelClick(e) {
    if (suppressHeaderClick) {
      suppressHeaderClick = false;
      return;
    }
    const menuBtn = e.target.closest('[data-row-menu]');
    if (menuBtn) {
      e.preventDefault();
      const row = menuBtn.closest('tr.plan-row');
      if (!row) return;
      if (menuBtn.getAttribute('aria-expanded') === 'true') {
        closePlanningContextMenu();
        return;
      }
      const rect = menuBtn.getBoundingClientRect();
      openRowMenu(row, 'product', rect.left, rect.bottom + 4, 'row', menuBtn);
      return;
    }
    if (e.target.closest('[data-add-product]')) {
      openAddProduct();
      return;
    }
    if (e.target.closest('[data-add-cocktail]')) {
      openCocktail(null, { drinkKind: 'cocktail' });
      return;
    }
    if (e.target.closest('[data-add-spirit-mixer]')) {
      openCocktail(null, { drinkKind: 'spirit_mixer' });
      return;
    }
    const edit = e.target.closest('[data-edit-cocktail]');
    if (edit) {
      openCocktail(edit.dataset.editCocktail);
      return;
    }
    const use = e.target.closest('[data-use-price]');
    if (use) {
      const row = use.closest('tr.plan-row');
      const price = Number(use.dataset.usePrice);
      if (!row || !Number.isFinite(price)) return;
      const input = row.querySelector('[data-field="menu_price"]');
      if (input) input.value = price.toFixed(2);
      if (row.dataset.cid) setCocktailField(row.dataset.cid, 'menu_price', price);
      else if (row.dataset.item) setItemField(row.dataset.item, 'menu_price', price);
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

  function ensureCocktails() {
    if (!ctx.cocktailsUnavailable) return true;
    toast('Cocktails need the latest database update. Apply migration 077_menu_cocktails.sql, then reload.', true);
    return false;
  }

  function showMenu() {
    recomputeAll();
    setTableFilterContext('planning', {
      categories: [...new Set([...ctx.lines.values()].map((l) => l.category))].sort(),
    });
    if (!ctx.items.size && !ctx.cocktails.size) paint();
    else if ($('planGrid')) paintGrid();
    else paint();
  }

  function openCocktail(id, extra = {}) {
    if (!ensureCocktails()) return;
    if (!id && locked()) { toast('Pricing is locked for this event', true); return; }
    const cocktail = id ? ctx.cocktails.get(id) : (extra.seed || null);
    if (id && !cocktail) return;
    const convertItemId = extra.convertItemId || null;
    openCocktailEditor({
      cocktail,
      drinkKind: extra.drinkKind,
      ctx,
      locked: locked(),
      nameTaken: (name, exceptId) => {
        const key = name.trim().toLowerCase();
        return [...ctx.cocktails.values()].some((c) => c.id !== exceptId && String(c.name || '').trim().toLowerCase() === key);
      },
      squareTaken: (square, variation, exceptId) => {
        const key = square.trim().toLowerCase();
        const variant = variation.trim().toLowerCase();
        return [...ctx.cocktails.values()].some((c) => {
          if (c.id === exceptId) return false;
          if (String(c.square_item_name || '').trim().toLowerCase() !== key) return false;
          return String(c.square_variation || '').trim().toLowerCase() === variant;
        });
      },
      quiet: !!convertItemId,
      onSaved: async (saved) => {
        ctx.cocktails.set(saved.id, normaliseCocktail(saved));
        if (convertItemId) {
          const source = ctx.items.get(convertItemId);
          const productName = ctx.productById.get(source?.product_id)?.name || 'The product';
          const size = source?.serve_label ? ` ${source.serve_label}` : '';
          const removed = await setItemField(convertItemId, 'included', false, { immediate: true });
          if (removed) {
            toast(`${saved.name || drinkKindMeta(saved.drink_kind).label} is on the menu. ${productName}${size} was taken off so it isn’t counted twice.`);
          }
        }
        showMenu();
      },
      onDeleted: (cid) => {
        ctx.cocktails.delete(cid);
        ctx.lines.delete(cocktailLineKey(cid));
        showMenu();
      },
    });
  }

  function openAddSize(source) {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    if (!source?.id) return;
    const productName = ctx.productById.get(source.product_id)?.name || 'This product';
    const needsCurrentName = !String(source.serve_label || '').trim();
    const el = openModal({
      title: `Another size of ${productName}`,
      bodyHtml: `
        <div class="admin-drawer-form">
          <p class="muted plan-sheet-lead">Same keg or bottle, its own price. A half is 0.5 of one serve. The Serves column stays the yield of the whole case.</p>
          ${needsCurrentName ? `<label class="admin-field"><span class="admin-label">Name the size already on the menu</span>
            <input class="admin-input" id="sizeCurrent" maxlength="40" placeholder="Pint"></label>` : ''}
          <label class="admin-field"><span class="admin-label">New size</span>
            <input class="admin-input" id="sizeName" maxlength="40" placeholder="Half"></label>
          <label class="admin-field"><span class="admin-label">How much of one serve</span>
            <input class="admin-input num-math" id="sizePortion" inputmode="decimal" placeholder="0.5" value="0.5"></label>
          <p class="plan-form-err" id="sizeErr" hidden></p>
        </div>`,
      footHtml: `
        <div class="admin-modal-confirm-foot">
          <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
          <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Add size</button>
        </div>`,
    });
    el.querySelector('[data-cancel]').onclick = closeModal;
    el.querySelector('[data-ok]').onclick = async () => {
      const err = el.querySelector('#sizeErr');
      const currentName = needsCurrentName ? el.querySelector('#sizeCurrent').value.trim() : String(source.serve_label || '').trim();
      const name = el.querySelector('#sizeName').value.trim();
      const portion = parsePlanningNumber(el.querySelector('#sizePortion').value);
      if (needsCurrentName && !currentName) { err.textContent = 'Name the size already on the menu'; err.hidden = false; return; }
      if (!name) { err.textContent = 'Name the new size'; err.hidden = false; return; }
      if (!portion.ok || !(portion.value > 0)) { err.textContent = 'Size must be a number above 0. A half is 0.5.'; err.hidden = false; return; }
      if (serveKey(name) === serveKey(currentName) || serveLabelTaken(source.product_id, name, source.id)) {
        err.textContent = 'This product already has that serve';
        err.hidden = false;
        return;
      }
      el.querySelector('[data-ok]').disabled = true;
      try {
        if (needsCurrentName) {
          const renamed = await updateEventMenuItem(source.id, { serve_label: currentName });
          const row = ctx.items.get(source.id);
          if (row) row.serve_label = renamed?.serve_label ?? currentName;
        }
        const saved = await insertEventMenuItem(ctx.eventId, source.product_id, {
          included: true,
          serve_label: name,
          portion: portion.value,
          serves_per_unit: source.serves_per_unit ?? null,
          unit_cost_override: source.unit_cost_override ?? null,
          deal_ref: source.deal_ref ?? null,
          target_gp_pct: source.target_gp_pct ?? null,
        });
        if (!saved?.id) throw new Error('Could not add that size');
        ctx.items.set(saved.id, saved);
        closeModal();
        showMenu();
        toast(`${productName} ${name} added`);
      } catch (e2) {
        el.querySelector('[data-ok]').disabled = false;
        err.textContent = e2.message || 'Could not add that size';
        err.hidden = false;
      }
    };
    requestAnimationFrame(() => el.querySelector(needsCurrentName ? '#sizeCurrent' : '#sizeName')?.focus());
  }

  function openAddProduct() {
    if (locked()) { toast('Pricing is locked for this event', true); return; }
    openSheet({
      title: 'Add product to event menu',
      variant: 'admin-full',
      bodyHtml: '<p class="muted plan-sheet-lead">Adds the product to this event’s menu. Pick one that is already there to add another size, such as a half.</p><div id="planAddSearch"></div>',
      footHtml: `<div class="admin-drawer-foot"><button class="admin-drawer-btn admin-drawer-btn--solid" type="button" id="planAddCancel">Close</button></div>`,
    });
    mountProductSearch($('planAddSearch'), {
      products: ctx.products,
      categories: ctx.categories,
      caseSizes: ctx.caseSizes,
      placeholder: 'Search library to add…',
      onSelect: async ({ productId }) => {
        const existing = itemsForProduct(productId);
        const onMenu = existing.filter((item) => item.included !== false);
        if (onMenu.length) {
          closeSheet();
          openAddSize(baseMenuItem(onMenu));
          return;
        }
        if (existing.length) {
          closeSheet();
          await Promise.all(existing.map((item) => setItemField(item.id, 'included', true, { immediate: true })));
          showMenu();
          toast(`${ctx.productById.get(productId)?.name || 'Product'} is back on the menu`);
          return;
        }
        try {
          const saved = await insertEventMenuItem(ctx.eventId, productId, { included: true });
          if (!saved?.id) throw new Error('Could not add that product');
          ctx.items.set(saved.id, saved);
          lineFor(saved.id);
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
    const products = [...ctx.items.values()].filter((item) => item.included !== false).length;
    const cocktails = [...ctx.cocktails.values()].filter((c) => c.included !== false).length;
    return products + cocktails;
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
          <p class="admin-modal-confirm-msg">Saves the ${count} item${count === 1 ? '' : 's'} on this menu — products with their prices, and cocktails with their recipes. You can apply it to any event. Projected serves and deal costs stay on this event.</p>
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
          err.textContent = `“${name}” already exists. Update replaces its products, cocktails and prices with this event’s menu.`;
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
    if (!count) { toast('Add something to the menu before saving it', true); return; }
    const suggested = String(ctx.event?.name || '').trim().slice(0, 60);
    bindSaveMenu(openModal(saveMenuForm(count, suggested)));
  }

  function showSaveMenu(el) {
    const count = includedMenuCount();
    if (!count) { toast('Add something to the menu before saving it', true); return; }
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
        const addedLabel = `${added} added`;
        toast(refresh
          ? `${menu.name} applied — ${addedLabel}, prices overwritten`
          : (added
            ? `${addedLabel} from ${menu.name}. Existing prices were left as they are.`
            : `Everything on ${menu.name} is already on this menu. Prices were left as they are.`));
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
      'plan-add-cocktail': () => openCocktail(null, { drinkKind: 'cocktail' }),
      'plan-add-spirit-mixer': () => openCocktail(null, { drinkKind: 'spirit_mixer' }),
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
    const [event, items, scenarios, products, caseSizes, categories, cocktailRows] = await Promise.all([
      loadEventPricing(ctx.eventId),
      listEventMenu(ctx.eventId),
      listScenarios(ctx.eventId),
      loadLibraryProducts(),
      loadCaseSizes(),
      loadCategories(),
      listEventCocktails(ctx.eventId).catch((err) => {
        if (isCocktailSchemaMissing(err)) return null;
        throw err;
      }),
    ]);
    if (ctx.abort) return;
    if (!event) throw new Error('Event not found');
    ctx.event = event;
    ctx.items = new Map((items || []).filter((i) => i.id).map((i) => [i.id, i]));
    ctx.cocktailsUnavailable = cocktailRows == null;
    ctx.cocktails = new Map((cocktailRows || []).map((c) => [c.id, normaliseCocktail(c)]));
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
  panel.addEventListener('blur', (e) => paintMoneyInput(e.target), true);
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('contextmenu', onContextMenu);
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
    closePlanningContextMenu();
    void flushSaves();
    if (colDrag?.raf) cancelAnimationFrame(colDrag.raf);
    colDrag = null;
    panel.classList.remove('plan-col-dragging');
    panel.removeEventListener('click', onPanelClick);
    panel.removeEventListener('contextmenu', onContextMenu);
    panel.removeEventListener('pointerdown', onColPointerDown);
    document.removeEventListener('pointermove', onColPointerMove);
    document.removeEventListener('pointerup', endColDrag);
    document.removeEventListener('pointercancel', endColDrag);
    document.removeEventListener(ADMIN_TOOLBAR_ACTION, onToolbarAction);
    document.removeEventListener(ADMIN_TABLE_FILTER, onTableFilter);
    document.removeEventListener(ADMIN_PRODUCT_FILTER, onProductFilter);
  };
}
