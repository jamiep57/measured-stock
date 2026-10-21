import { describe, expect, it } from 'vitest';
import { planEventSteps } from './walkthroughs/plan-event.js';
import {
  completeNextAction,
  openEventNextAction,
  readActiveStep,
  readTourStatus,
  resumeIndex,
  routeNextAction,
  routeSatisfies,
  shouldOfferTour,
  skipMissingOptional,
  stepsForRole,
  writeActiveStep,
  writeTourStatus,
} from './walkthrough-model.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
}

describe('plan-event tour', () => {
  it('keeps every lesson when the role can open planning and orders', () => {
    const steps = stepsForRole(planEventSteps(), () => true);
    expect(steps.map((step) => step.id)).toEqual([
      'add-menu',
      'price-gp',
      'orders-nav',
      'projections',
      'raise-order',
      'ledger',
    ]);
  });

  it('replaces a hidden feature with one notice', () => {
    const steps = stepsForRole(planEventSteps(), (feature) => feature !== 'planning.orders');
    expect(steps.map((step) => step.id)).toEqual([
      'add-menu',
      'price-gp',
      'orders-unavailable',
    ]);
    expect(steps.at(-1).body).toMatch(/cannot open Orders/);
  });

  it('skips both features when the role has neither', () => {
    const steps = stepsForRole(planEventSteps(), () => false);
    expect(steps.map((step) => step.id)).toEqual([
      'planning-unavailable',
      'orders-unavailable',
    ]);
  });

  it('matches a route only when every part agrees', () => {
    expect(routeSatisfies(
      { view: 'event', panel: 'planning' },
      { view: 'event', eventId: 'a', panel: 'planning' },
    )).toBe(true);
    expect(routeSatisfies(
      { view: 'event', panel: 'orders' },
      { view: 'event', eventId: 'a', panel: 'planning' },
    )).toBe(false);
    expect(routeSatisfies({ needsEvent: true }, { view: 'event', eventId: 'a', panel: 'dashboard' })).toBe(true);
    expect(routeSatisfies({ needsEvent: true }, { view: 'home' })).toBe(false);
    expect(routeSatisfies(null, { view: 'home' })).toBe(false);
  });

  it('continues the first step when an event is open or there is nothing to open', () => {
    expect(openEventNextAction({ eventOpen: true, hasEvents: true })).toBe('advance');
    expect(openEventNextAction({ eventOpen: false, hasEvents: false })).toBe('advance');
    expect(openEventNextAction({ eventOpen: false, hasEvents: true })).toBe('stay');
  });

  it('waits on a do-this step until the action is done', () => {
    expect(completeNextAction(false)).toBe('stay');
    expect(completeNextAction(true)).toBe('advance');
  });

  it('navigates a panel step only when that panel is not open yet', () => {
    expect(routeNextAction({ satisfied: true, canNavigate: true })).toBe('advance');
    expect(routeNextAction({ satisfied: false, canNavigate: true })).toBe('navigate');
    expect(routeNextAction({ satisfied: false, canNavigate: false })).toBe('stay');
  });

  it('stores completion separately from the in-progress step', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    expect(readTourStatus(local)).toBe(null);
    expect(shouldOfferTour(null)).toBe(true);
    writeTourStatus(local, 'later');
    expect(readTourStatus(local)).toBe('later');
    expect(shouldOfferTour('later')).toBe(false);
    expect(shouldOfferTour('done')).toBe(false);
    writeActiveStep(session, 'menu-nav');
    expect(readActiveStep(session)).toBe('menu-nav');
    writeActiveStep(session, null);
    expect(readActiveStep(session)).toBe(null);
    writeTourStatus(local, null);
    expect(readTourStatus(local)).toBe(null);
  });

  it('resumes on a known step and skips optional controls that are missing', () => {
    const steps = [{ id: 'a' }, { id: 'b', optional: true }, { id: 'c' }];
    expect(resumeIndex(steps, 'c')).toBe(2);
    expect(resumeIndex(steps, 'missing')).toBe(0);
    expect(skipMissingOptional(steps, 0, () => false)).toBe(0);
    expect(skipMissingOptional(steps, 1, () => false)).toBe(2);
    expect(skipMissingOptional(steps, 1, () => true)).toBe(1);
  });
});
