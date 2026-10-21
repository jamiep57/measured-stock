/**
 * Menu exports — Designer, Client pack and SOR (Schedule of Rates).
 *
 * Rows are built from resolved menu lines and passed through a per-type
 * field whitelist, so internal costs and GP can only appear when an admin
 * explicitly opts in on the client pack (`includeInternal`). Designer and
 * SOR exports never carry internal fields.
 */

import { barServesProduct } from '../bar-products.js';
import { isBoneYard } from './util.js';
import { drinkKindMeta } from './menu-cocktails.js';

/** Serving bars for a menu, in the same order as distribution. */
export function servingMenuBars(bars) {
  return (bars || [])
    .filter((bar) => bar?.id && !isBoneYard(bar))
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));
}

/**
 * Bars that serve a menu line. A bar with no distribution rows serves the
 * whole catalogue. Recipe drinks have no product, so they stay on every bar.
 * @returns {object[]|null} null when the event has no serving bars
 */
export function barsForMenuLine(line, bars, barProducts) {
  const serving = servingMenuBars(bars);
  if (!serving.length) return null;
  if (!line?.productId) return serving;
  return serving.filter((bar) => barServesProduct(barProducts, bar.id, line.productId));
}

const BAR_LIST_LIMIT = 3;

/**
 * Short bars cell. A long site stays readable: everywhere is "All bars",
 * a few names are listed, a few gaps are "All except …", and a mixed
 * list is a count. `detail` is the full list for a hover.
 */
export function barsMenuLabel(onBars, serving) {
  const names = (onBars || []).map((bar) => bar.name || 'Bar').filter(Boolean);
  const all = (serving || []).map((bar) => bar.name || 'Bar').filter(Boolean);
  const detail = names.join(', ');
  if (!names.length) return { label: 'Not on a bar', detail: '' };
  if (all.length && names.length === all.length) return { label: 'All bars', detail };
  const on = new Set(names);
  const missing = all.filter((name) => !on.has(name));
  if (names.length <= BAR_LIST_LIMIT && names.length <= missing.length) {
    return { label: detail, detail };
  }
  if (missing.length && missing.length <= BAR_LIST_LIMIT) {
    return { label: `All except ${missing.join(', ')}`, detail };
  }
  return { label: `${names.length} of ${all.length || names.length}`, detail };
}

export const EXPORT_TYPES = {
  designer: {
    label: 'Designer',
    title: 'Menu copy',
    fields: ['category', 'menuName', 'productName', 'serve', 'abv', 'bars', 'price'],
    allowInternal: false,
  },
  client: {
    label: 'Client pack',
    title: 'Product mix & pricing',
    fields: ['category', 'menuName', 'serve', 'price', 'mixPct', 'scenarios'],
    allowInternal: true,
  },
  sor: {
    label: 'Schedule of Rates',
    title: 'Schedule of rates',
    fields: ['category', 'menuName', 'serve', 'rate'],
    allowInternal: false,
  },
  ratecard: {
    label: '3rd Party Rate card',
    title: '3rd Party rate card',
    fields: ['category', 'menuName', 'serve', 'rate'],
    allowInternal: false,
  },
};

/** Margins offered on the 3rd Party Rate card. 0 is cost with nothing added. */
export const RATE_CARD_MARGINS = [0, 5, 10, 15, 20, 25, 30];

/** A margin of 0–200, to one decimal. Anything else becomes 0. */
export function rateCardMargin(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(200, Math.max(0, n));
  return Math.round(clamped * 10) / 10;
}

/** Sentence used on the rate card preview and its PDF. */
export function rateCardNote(marginPct) {
  const margin = rateCardMargin(marginPct);
  if (margin === 0) return 'Rates are the serve cost, ex VAT.';
  const label = Number.isInteger(margin) ? String(margin) : margin.toFixed(1);
  return `Rates are the serve cost plus ${label}%, ex VAT.`;
}

export const INTERNAL_FIELDS = ['costPerServe', 'gpPct'];

/** Strip everything not whitelisted for `type`. */
export function sanitizeRow(type, row, { includeInternal = false } = {}) {
  const spec = EXPORT_TYPES[type];
  if (!spec) throw new Error(`Unknown export type: ${type}`);
  const allowed = new Set(spec.fields);
  if (includeInternal && spec.allowInternal) INTERNAL_FIELDS.forEach((f) => allowed.add(f));
  const out = {};
  Object.keys(row).forEach((k) => {
    if (allowed.has(k)) out[k] = row[k];
  });
  return out;
}

function round2(n) {
  return n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100;
}

/** ABV for menu copy, e.g. 4.5 → "4.5%". Empty when the product has none. */
export function formatAbv(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${Math.round(n * 100) / 100}%`;
}

/**
 * Serve printed on a designer menu. An explicit serve label wins; otherwise
 * the unit in the pack (440ml, 330ml, 70cl). Draught packs are a pint.
 * A recipe drink uses its section name when it has no serve label.
 */
export function serveSizeOf(line) {
  const explicit = String(line?.serveLabel || '').trim();
  if (explicit) return explicit;
  if (line?.kind === 'cocktail') {
    const category = String(line.category || '').trim();
    if (category) return category;
    return drinkKindMeta(line.drinkKind).label;
  }
  const label = String(line?.caseSize || '').trim();
  const stockUnit = String(line?.stockUnit || '').toLowerCase();
  if (stockUnit === 'keg' || /\b(keg|keykeg|cask)\b/i.test(label) || /\d\s*gal\b/i.test(label)) return 'Pint';
  const sized = label.match(/[×x]\s*(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/i)
    || label.match(/(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/i);
  if (!sized) return '';
  const unit = sized[2].toLowerCase() === 'l' ? 'L' : sized[2].toLowerCase();
  return `${sized[1]}${unit}`;
}

/**
 * @param {'designer'|'client'|'sor'} type
 * @param {{
 *   lines: object[],                       resolved menu lines (resolveMenuLine)
 *   scenarios?: object[],                  pricing_scenarios with scenario_prices
 *   scenarioIds?: string[],                client pack: which scenarios to show
 *   rateSource?: 'menu'|'rider'|string,    SOR: menu price, rider agreement, or a scenario id
 *   riderPrices?: Map<string, { price }>,  SOR rider rates for the client account
 *   marginPct?: number,                    rate card: percent added to serve cost
 *   includeInternal?: boolean,
 *   bars?: object[],                       designer: event bars (boneyard ignored)
 *   barProducts?: object[],                designer: distribution menu rows
 *   barId?: string,                        designer: limit the menu to one bar
 * }} input
 * @returns {{ columns: {key,label,align?,money?}[], groups: {category, rows}[], count, missingRates, barName }}
 */
export function buildMenuExport(type, input) {
  const spec = EXPORT_TYPES[type];
  if (!spec) throw new Error(`Unknown export type: ${type}`);
  const includeInternal = !!input.includeInternal && spec.allowInternal;
  const serving = type === 'designer' ? servingMenuBars(input.bars) : [];
  const scoped = serving.find((bar) => bar.id === input.barId) || null;
  const showBars = serving.length > 1 && !scoped;
  const scenarios = (input.scenarios || []).filter((s) => (input.scenarioIds || []).includes(s.id));
  const scenarioPrice = (s, line) => {
    const rows = s.scenario_prices || [];
    if (line.itemId) {
      const hit = rows.find((r) => r.menu_item_id === line.itemId);
      if (hit) return round2(hit.price);
    }
    const byProduct = rows.filter((r) => r.product_id === line.productId);
    if (byProduct.length === 1) return round2(byProduct[0].price);
    return null;
  };

  const lines = (input.lines || []).filter((l) => l.included);
  const totalServes = lines.reduce((s, l) => s + (Number(l.projectedServes) || 0), 0);
  const marginPct = type === 'ratecard' ? rateCardMargin(input.marginPct) : null;
  let missingRates = 0;

  const rows = [];
  lines.forEach((l) => {
    const onBars = serving.length ? barsForMenuLine(l, serving, input.barProducts) : null;
    if (onBars && scoped && !onBars.some((bar) => bar.id === scoped.id)) return;
    if (onBars && serving.length === 1 && !onBars.length) return;
    const base = {
      category: l.category || 'Uncategorised',
      menuName: l.menuName || l.name,
      productName: l.name,
      serve: l.serveLabel || '',
    };
    if (type === 'sor' || type === 'ratecard') {
      let rate = type === 'ratecard' ? null : round2(l.menuPrice);
      if (type === 'ratecard') {
        const cost = l.costPerServe == null || l.costPerServe === '' ? null : Number(l.costPerServe);
        if (cost == null || !Number.isFinite(cost)) { missingRates += 1; return; }
        rate = round2(cost * (1 + marginPct / 100));
      } else if (input.rateSource === 'rider') {
        const r = input.riderPrices?.get(l.productId);
        if (r) {
          rate = round2(r.price);
          if (r.unitLabel) base.serve = r.unitLabel;
        }
      } else if (input.rateSource && input.rateSource !== 'menu') {
        const s = (input.scenarios || []).find((x) => x.id === input.rateSource);
        if (s) rate = scenarioPrice(s, l) ?? rate;
      }
      if (rate == null) { missingRates += 1; return; }
      rows.push({ ...base, rate });
      return;
    }
    const price = round2(l.menuPrice);
    if (type === 'designer' && price == null) missingRates += 1;
    const row = {
      ...base,
      serve: type === 'designer' ? serveSizeOf(l) : base.serve,
      abv: formatAbv(l.abv) || '—',
      price,
      mixPct: totalServes > 0 && l.projectedServes ? Math.round((Number(l.projectedServes) / totalServes) * 1000) / 10 : null,
      scenarios: Object.fromEntries(scenarios.map((s) => [s.id, scenarioPrice(s, l)])),
      costPerServe: round2(l.costPerServe),
      gpPct: l.gpPct == null ? null : Math.round(l.gpPct * 10) / 10,
    };
    const clean = sanitizeRow(type, row, { includeInternal });
    if (showBars) {
      const summary = barsMenuLabel(onBars || [], serving);
      clean.bars = summary.label;
      clean.barsDetail = summary.detail;
    }
    rows.push(clean);
  });

  const columns = [];
  if (type === 'designer') {
    columns.push({ key: 'menuName', label: 'Menu name' }, { key: 'productName', label: 'Product' },
      { key: 'serve', label: 'Serve size' }, { key: 'abv', label: 'ABV' });
    if (showBars) columns.push({ key: 'bars', label: 'Bars' });
    columns.push({ key: 'price', label: 'Price', align: 'right', money: true });
  } else if (type === 'client') {
    columns.push({ key: 'menuName', label: 'Product' }, { key: 'serve', label: 'Serve' },
      { key: 'price', label: 'Menu price', align: 'right', money: true });
    if (totalServes > 0) columns.push({ key: 'mixPct', label: 'Mix %', align: 'right', pct: true });
    scenarios.forEach((s) => columns.push({ key: `scenario:${s.id}`, label: s.name, align: 'right', money: true }));
    if (includeInternal) {
      columns.push({ key: 'costPerServe', label: 'Cost / serve', align: 'right', money: true, internal: true },
        { key: 'gpPct', label: 'GP %', align: 'right', pct: true, internal: true });
    }
  } else {
    columns.push({ key: 'menuName', label: 'Item' }, { key: 'serve', label: 'Unit' },
      { key: 'rate', label: 'Rate', align: 'right', money: true });
  }

  const byCat = new Map();
  rows.forEach((r) => {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category).push(r);
  });
  const groups = [...byCat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({
      category,
      rows: list.sort((a, b) => String(a.menuName).localeCompare(String(b.menuName))),
    }));

  const barName = scoped?.name || (serving.length === 1 ? (serving[0].name || '') : '');
  return { columns, groups, count: rows.length, missingRates, includeInternal, barName, marginPct };
}

/** Cell value for a column (scenario columns read the nested map). */
export function cellValue(row, col) {
  if (col.key.startsWith('scenario:')) return row.scenarios?.[col.key.slice(9)] ?? null;
  return row[col.key] ?? null;
}

export function formatCell(value, col) {
  if (value == null || value === '') return col.money || col.pct ? '—' : '';
  if (col.money) return `£${Number(value).toFixed(2)}`;
  if (col.pct) return `${Number(value).toFixed(1)}%`;
  return String(value);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Spreadsheet-friendly CSV: category column first, raw numbers. */
export function menuExportCsv(model) {
  const head = ['Category', ...model.columns.map((c) => c.label)];
  const lines = [head.map(csvEscape).join(',')];
  model.groups.forEach((g) => {
    g.rows.forEach((r) => {
      lines.push([g.category, ...model.columns.map((c) => {
        const v = cellValue(r, c);
        return v == null ? '' : (c.money ? Number(v).toFixed(2) : v);
      })].map(csvEscape).join(','));
    });
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportFileStem(type, eventName, yearLabel) {
  const part = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
  const event = part(eventName) || 'event';
  const year = part(yearLabel);
  return [part(EXPORT_TYPES[type]?.label || type), event, event.includes(year) ? '' : year].filter(Boolean).join('_');
}
