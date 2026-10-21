/**
 * Tour state helpers. No DOM, so the step list and the engine can share them.
 */

export const TOUR_STORAGE_KEY = 'v5-tour-plan-event';
export const TOUR_STEP_KEY = 'v5-tour-plan-event-step';

const FEATURE_NOTICES = {
  'planning.menu_gp': {
    id: 'planning-unavailable',
    title: 'Menu & GP',
    body: 'Your role cannot open Menu & GP, so this tour skips pricing.',
    notice: true,
  },
  'planning.orders': {
    id: 'orders-unavailable',
    title: 'Orders',
    body: 'Your role cannot open Orders, so this tour skips purchase orders.',
    notice: true,
  },
};

export function readTourStatus(storage) {
  try {
    const value = storage?.getItem?.(TOUR_STORAGE_KEY);
    return value === 'done' || value === 'later' ? value : null;
  } catch {
    return null;
  }
}

export function writeTourStatus(storage, status) {
  try {
    if (status) storage?.setItem?.(TOUR_STORAGE_KEY, status);
    else storage?.removeItem?.(TOUR_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

export function shouldOfferTour(status) {
  return status !== 'done' && status !== 'later';
}

export function readActiveStep(storage) {
  try {
    return storage?.getItem?.(TOUR_STEP_KEY) || null;
  } catch {
    return null;
  }
}

export function writeActiveStep(storage, stepId) {
  try {
    if (stepId) storage?.setItem?.(TOUR_STEP_KEY, stepId);
    else storage?.removeItem?.(TOUR_STEP_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * @param {{ view?: string, panel?: string, needsEvent?: boolean } | null | undefined} expect
 * @param {{ view?: string, panel?: string, eventId?: string } | null | undefined} route
 */
export function routeSatisfies(expect, route) {
  if (!expect || !route) return false;
  if (expect.view && route.view !== expect.view) return false;
  if (expect.panel && route.panel !== expect.panel) return false;
  if (expect.needsEvent && !(route.view === 'event' && route.eventId)) return false;
  return true;
}

/** Next on the first step: continue when an event is open, or when there is no event to open. */
export function openEventNextAction({ eventOpen, hasEvents }) {
  if (eventOpen) return 'advance';
  if (!hasEvents) return 'advance';
  return 'stay';
}

/** Next on a navigation step: move on, go to the panel, or wait for an event. */
export function routeNextAction({ satisfied, canNavigate }) {
  if (satisfied) return 'advance';
  if (canNavigate) return 'navigate';
  return 'stay';
}

export function resumeIndex(steps, startId) {
  if (!startId) return 0;
  const index = steps.findIndex((step) => step.id === startId);
  return index >= 0 ? index : 0;
}

/** Skip optional steps whose control is not on screen. */
export function skipMissingOptional(steps, index, present) {
  let i = index;
  while (i < steps.length && steps[i].optional && !present(steps[i])) i += 1;
  return i;
}

/**
 * Drop steps the role cannot open. One notice card replaces each missing feature.
 * @param {Array<{ feature?: string }>} steps
 * @param {(feature: string) => boolean} can
 */
export function stepsForRole(steps, can) {
  const out = [];
  const noted = new Set();
  for (const step of steps) {
    if (step.feature && !can(step.feature)) {
      if (!noted.has(step.feature)) {
        noted.add(step.feature);
        const notice = FEATURE_NOTICES[step.feature];
        if (notice) out.push(notice);
      }
      continue;
    }
    out.push(step);
  }
  return out;
}
