/**
 * The Square item name for each product on an event menu. Shared by the server menu
 * push and the sales page, so sales of pushed items find their product again.
 *
 * Products with the same menu name (a can and a keg of one beer) get a format suffix,
 * because Square would otherwise show two identical buttons.
 */

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function baseSquareName(product) {
  return String(product?.menu_name || '').trim() || String(product?.name || '').trim();
}

function formatLabel(product) {
  const size = String(product?.case_size || '').trim();
  const unit = String(product?.stock_unit || '').trim().toLowerCase();
  if (unit === 'keg' || /\bkeg\b|keykeg/i.test(size)) return 'Draught';
  if (/\bcans?\b/i.test(size)) return 'Can';
  if (unit === 'bottle' && size) return size;
  return size || unit || '';
}

/**
 * @param {Array<{ id: string, name?: string, menu_name?: string|null, case_size?: string|null, stock_unit?: string|null }>} products
 * @returns {{ names: Map<string, string>, clashes: string[] }}
 */
export function squareItemNames(products) {
  const unique = [...new Map((products || []).filter((p) => p?.id).map((p) => [p.id, p])).values()];
  const groups = new Map();
  for (const p of unique) {
    const key = norm(baseSquareName(p));
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const names = new Map();
  const clashes = [];
  for (const group of groups.values()) {
    const base = baseSquareName(group[0]);
    if (group.length === 1) {
      names.set(group[0].id, base);
      continue;
    }
    clashes.push(base);
    const sorted = group.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const pass = (labelOf) => {
      const counts = new Map();
      sorted.forEach((p) => {
        const label = norm(labelOf(p));
        counts.set(label, (counts.get(label) || 0) + 1);
      });
      return counts;
    };
    const first = pass(formatLabel);
    const sizeOf = (p) => String(p.case_size || '').trim() || formatLabel(p);
    const second = pass((p) => (first.get(norm(formatLabel(p))) > 1 ? sizeOf(p) : formatLabel(p)));
    const used = new Map();
    for (const p of sorted) {
      let label = first.get(norm(formatLabel(p))) > 1 ? sizeOf(p) : formatLabel(p);
      if (!label || second.get(norm(label)) > 1) {
        const n = (used.get(norm(label)) || 0) + 1;
        used.set(norm(label), n);
        label = label ? `${label} ${n}` : String(n);
      }
      names.set(p.id, `${base} (${label})`);
    }
  }
  return { names, clashes };
}
