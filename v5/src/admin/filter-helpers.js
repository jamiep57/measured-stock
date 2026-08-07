/**
 * Shared helpers for declarative table-filter configs.
 */

export function extractCategoryNames(products) {
  const set = new Set();
  (products || []).forEach((item) => {
    const cat = item.product?.category?.name || item.category?.name || item.category_name;
    set.add(cat || 'Uncategorised');
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function extractCategoryIdOptions(products) {
  const map = new Map();
  (products || []).forEach((item) => {
    const cat = item.product?.category || item.category;
    if (cat?.id) map.set(cat.id, cat.name || 'Uncategorised');
  });
  return [...map.entries()]
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function extractSupplierOptions(products) {
  const map = new Map();
  let hasNone = false;
  (products || []).forEach((item) => {
    const p = item.product || item;
    const sup = p.supplier || item.supplier;
    if (sup?.id) map.set(sup.id, sup.name || 'Supplier');
    else hasNone = true;
  });
  const list = [...map.entries()]
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (hasNone) list.push({ value: '__none__', label: 'No supplier' });
  return list;
}

export function loadPersisted(storageKey, defaults, keys) {
  if (!storageKey || !keys?.length || typeof localStorage === 'undefined') {
    return { ...defaults };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    const next = { ...defaults };
    keys.forEach((key) => {
      if (parsed[key] !== undefined) next[key] = parsed[key];
    });
    return next;
  } catch {
    return { ...defaults };
  }
}

export function savePersisted(storageKey, state, keys) {
  if (!storageKey || !keys?.length || typeof localStorage === 'undefined') return;
  try {
    const payload = {};
    keys.forEach((key) => { payload[key] = state[key]; });
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch { /* ignore */ }
}

/** Build removable chips for non-default multi / radio / text / date values. */
export function buildStandardActiveItems({
  state,
  defaults,
  activeTab,
  sectionsByTab,
  optionLabels = {},
}) {
  const items = [];
  Object.entries(sectionsByTab || {}).forEach(([tabId, sections]) => {
    if (tabId === activeTab) return;
    (sections || []).forEach((section) => {
      const val = state[section.id];
      const def = defaults[section.id];
      if (section.type === 'checkbox' || section.type === 'searchable-checkbox') {
        const selected = Array.isArray(val) ? val : [];
        const labels = optionLabels[section.id] || {};
        selected.forEach((v) => {
          items.push({
            id: `${section.id}:${v}`,
            label: labels[v] || section.options?.find((o) => String(o.value) === String(v))?.label || String(v),
          });
        });
        return;
      }
      if (section.type === 'radio' || section.type === 'segment') {
        if (val === def) return;
        const opt = section.options?.find((o) => String(o.value) === String(val));
        if (opt) items.push({ id: section.id, label: opt.label });
        return;
      }
      if (section.type === 'text') {
        if (!val || val === def) return;
        items.push({ id: section.id, label: `${section.label}: ${val}` });
        return;
      }
      if (section.type === 'date-range') {
        const from = val?.from || '';
        const to = val?.to || '';
        const dFrom = def?.from || '';
        const dTo = def?.to || '';
        if (from === dFrom && to === dTo) return;
        if (from || to) {
          items.push({
            id: section.id,
            label: `${section.label}: ${from || '…'} → ${to || '…'}`,
          });
        }
      }
    });
  });
  return items;
}

export function removeStandardActiveItem(state, defaults, id) {
  const idx = String(id).indexOf(':');
  if (idx === -1) {
    if (Object.prototype.hasOwnProperty.call(defaults, id)) {
      return { ...state, [id]: structuredCloneSafe(defaults[id]) };
    }
    return state;
  }
  const sectionId = id.slice(0, idx);
  const value = id.slice(idx + 1);
  const cur = state[sectionId];
  if (Array.isArray(cur)) {
    return { ...state, [sectionId]: cur.filter((v) => String(v) !== String(value)) };
  }
  return state;
}

function structuredCloneSafe(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

export function tabValuesFromState(state, sectionIds) {
  const values = {};
  sectionIds.forEach((id) => { values[id] = state[id]; });
  return values;
}

export function applySectionChange(state, sectionId, value) {
  return { ...state, [sectionId]: value };
}

export function resetSections(state, defaults, sectionIds) {
  const next = { ...state };
  sectionIds.forEach((id) => {
    next[id] = structuredCloneSafe(defaults[id]);
  });
  return next;
}
