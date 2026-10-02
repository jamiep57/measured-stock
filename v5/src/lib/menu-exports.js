/**
 * Menu exports — Designer, Client pack and SOR (Schedule of Rates).
 *
 * Rows are built from resolved menu lines and passed through a per-type
 * field whitelist, so internal costs and GP can only appear when an admin
 * explicitly opts in on the client pack (`includeInternal`). Designer and
 * SOR exports never carry internal fields.
 */

export const EXPORT_TYPES = {
  designer: {
    label: 'Designer',
    title: 'Menu copy',
    fields: ['category', 'menuName', 'productName', 'serve', 'price'],
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
};

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

/**
 * @param {'designer'|'client'|'sor'} type
 * @param {{
 *   lines: object[],                       resolved menu lines (resolveMenuLine)
 *   scenarios?: object[],                  pricing_scenarios with scenario_prices
 *   scenarioIds?: string[],                client pack: which scenarios to show
 *   rateSource?: 'menu'|'rider'|string,    SOR: menu price, rider agreement, or a scenario id
 *   riderPrices?: Map<string, { price }>,  SOR rider rates for the client account
 *   includeInternal?: boolean,
 * }} input
 * @returns {{ columns: {key,label,align?,money?}[], groups: {category, rows}[], count, missingRates }}
 */
export function buildMenuExport(type, input) {
  const spec = EXPORT_TYPES[type];
  if (!spec) throw new Error(`Unknown export type: ${type}`);
  const includeInternal = !!input.includeInternal && spec.allowInternal;
  const scenarios = (input.scenarios || []).filter((s) => (input.scenarioIds || []).includes(s.id));
  const scenarioPrice = (s, pid) => {
    const row = (s.scenario_prices || []).find((r) => r.product_id === pid);
    return row ? round2(row.price) : null;
  };

  const lines = (input.lines || []).filter((l) => l.included);
  const totalServes = lines.reduce((s, l) => s + (Number(l.projectedServes) || 0), 0);
  let missingRates = 0;

  const rows = [];
  lines.forEach((l) => {
    const base = {
      category: l.category || 'Uncategorised',
      menuName: l.menuName || l.name,
      productName: l.name,
      serve: l.serveLabel || '',
    };
    if (type === 'sor') {
      let rate = round2(l.menuPrice);
      if (input.rateSource === 'rider') {
        const r = input.riderPrices?.get(l.productId);
        if (r) {
          rate = round2(r.price);
          if (r.unitLabel) base.serve = r.unitLabel;
        }
      } else if (input.rateSource && input.rateSource !== 'menu') {
        const s = (input.scenarios || []).find((x) => x.id === input.rateSource);
        if (s) rate = scenarioPrice(s, l.productId) ?? rate;
      }
      if (rate == null) { missingRates += 1; return; }
      rows.push({ ...base, rate });
      return;
    }
    const price = round2(l.menuPrice);
    if (type === 'designer' && price == null) missingRates += 1;
    const row = {
      ...base,
      price,
      mixPct: totalServes > 0 && l.projectedServes ? Math.round((Number(l.projectedServes) / totalServes) * 1000) / 10 : null,
      scenarios: Object.fromEntries(scenarios.map((s) => [s.id, scenarioPrice(s, l.productId)])),
      costPerServe: round2(l.costPerServe),
      gpPct: l.gpPct == null ? null : Math.round(l.gpPct * 10) / 10,
    };
    rows.push(sanitizeRow(type, row, { includeInternal }));
  });

  const columns = [];
  if (type === 'designer') {
    columns.push({ key: 'menuName', label: 'Menu name' }, { key: 'productName', label: 'Product' },
      { key: 'serve', label: 'Serve' }, { key: 'price', label: 'Price', align: 'right', money: true });
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

  return { columns, groups, count: rows.length, missingRates, includeInternal };
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
