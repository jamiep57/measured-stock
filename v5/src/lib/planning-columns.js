/**
 * Menu & GP column order.
 * Product stays pinned. Every other header is an id in this list.
 * Scenario columns are `scenario:<id>` and travel with the rest.
 */

export const PLANNING_COLUMN_ORDER_KEY = 'v5PlanningColumnOrder';

const BEFORE_SCENARIOS = ['serve', 'cost', 'menu', 'target', 'required', 'suggested', 'gp'];
const AFTER_SCENARIOS = ['serves', 'revenue', 'gp-amount', 'deal', 'deal-ref'];

export function scenarioColumnId(scenarioId) {
  return `scenario:${scenarioId}`;
}

export function defaultPlanningColumnOrder(scenarioIds = []) {
  return [
    ...BEFORE_SCENARIOS,
    ...scenarioIds.map(scenarioColumnId),
    ...AFTER_SCENARIOS,
  ];
}

/**
 * Keep a saved order, drop columns that no longer exist, and slot new ones
 * in beside the column they normally follow.
 */
export function reconcilePlanningColumnOrder(saved, scenarioIds = []) {
  const defaults = defaultPlanningColumnOrder(scenarioIds);
  const allowed = new Set(defaults);
  if (!Array.isArray(saved) || !saved.length) return defaults;

  const order = [];
  const seen = new Set();
  saved.forEach((id) => {
    if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) return;
    order.push(id);
    seen.add(id);
  });
  if (!order.length) return defaults;

  defaults.forEach((id) => {
    if (seen.has(id)) return;
    if (id.startsWith('scenario:')) {
      let lastScenario = -1;
      order.forEach((col, index) => {
        if (col.startsWith('scenario:')) lastScenario = index;
      });
      if (lastScenario !== -1) {
        order.splice(lastScenario + 1, 0, id);
        seen.add(id);
        return;
      }
    }
    const defIndex = defaults.indexOf(id);
    let insertAt = null;
    for (let j = defIndex - 1; j >= 0; j -= 1) {
      const at = order.indexOf(defaults[j]);
      if (at !== -1) {
        insertAt = at + 1;
        break;
      }
    }
    if (insertAt == null) {
      insertAt = order.length;
      for (let j = defIndex + 1; j < defaults.length; j += 1) {
        const at = order.indexOf(defaults[j]);
        if (at !== -1) {
          insertAt = at;
          break;
        }
      }
    }
    order.splice(insertAt, 0, id);
    seen.add(id);
  });
  return order;
}

export function movePlanningColumn(order, fromId, toId, place) {
  if (!fromId || !toId || fromId === toId) return order.slice();
  if (place !== 'before' && place !== 'after') return order.slice();
  if (!order.includes(fromId) || !order.includes(toId)) return order.slice();
  const next = order.filter((id) => id !== fromId);
  let index = next.indexOf(toId);
  if (place === 'after') index += 1;
  next.splice(index, 0, fromId);
  return next;
}

export function readPlanningColumnOrder(storage) {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(PLANNING_COLUMN_ORDER_KEY) || 'null');
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : null;
  } catch {
    return null;
  }
}

export function writePlanningColumnOrder(storage, order) {
  if (!storage) return;
  try {
    storage.setItem(PLANNING_COLUMN_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode or a full quota */
  }
}
