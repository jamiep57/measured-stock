/**
 * Spotlight tour for the admin shell.
 * The hole passes clicks through. Sheets and modals hide the overlay until they close.
 */

import '../styles/walkthrough.css';
import { toast } from '../lib/util.js';
import { parseRoute } from './router.js';
import { planEventSteps } from './walkthroughs/plan-event.js';
import {
  completeNextAction,
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

export {
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

const HOLE_PAD = 6;
const HOLE_MAX = 280;
const WAIT_MS = 12000;

/** @type {{ go: (route: object) => Promise<unknown>, eventId: () => string, can: (feature: string) => boolean } | null} */
let api = null;

let steps = [];
let index = 0;
let running = false;
let generation = 0;
let suppressAdvance = false;
let prepared = false;
/** @type {{ autoAdvance?: boolean, passthrough?: boolean, wasSatisfied?: boolean } | null} */
let armed = null;
let domReady = false;
let inviteEl = null;
/** @type {MutationObserver | null} */
let observer = null;
let layoutFrame = 0;
let previousEventId = '';

function storageLocal() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function storageSession() {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

function stepText(value) {
  if (typeof value === 'function') return value() || '';
  return value || '';
}

function overlayBlocked() {
  const sheet = document.getElementById('sheet');
  if (sheet && !sheet.hidden) return true;
  const modal = document.querySelector('.admin-modal');
  return !!(modal && !modal.hidden);
}

function shouldAutoAdvance() {
  const step = steps[index];
  if (suppressAdvance || !step || overlayBlocked()) return false;
  if (typeof step.complete === 'function') return !!step.complete();
  if (!armed?.autoAdvance || armed.wasSatisfied || !step.route) return false;
  return routeSatisfies(step.route, parseRoute());
}

function nextAction(step) {
  if (typeof step.complete === 'function') return completeNextAction(!!step.complete());
  if (typeof step.finishOnNext === 'function') return step.finishOnNext();
  if (step.route) {
    return routeNextAction({
      satisfied: routeSatisfies(step.route, parseRoute()),
      canNavigate: !!step.destination?.(api?.eventId() || ''),
    });
  }
  return 'advance';
}

function ensureDom() {
  if (domReady) return;
  domReady = true;
  const root = document.createElement('div');
  root.className = 'tour-root';
  root.id = 'tourRoot';
  root.hidden = true;
  root.innerHTML = `
    <div class="tour-shade" data-edge="top"></div>
    <div class="tour-shade" data-edge="left"></div>
    <div class="tour-shade" data-edge="right"></div>
    <div class="tour-shade" data-edge="bottom"></div>
    <div class="tour-ring" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tourTitle">
      <p class="tour-kicker" id="tourKicker"></p>
      <h2 class="tour-title" id="tourTitle"></h2>
      <p class="tour-copy" id="tourCopy"></p>
      <div class="tour-actions">
        <button type="button" class="tour-btn tour-btn--quiet" data-tour-act="skip">Skip</button>
        <div class="tour-actions-end">
          <button type="button" class="tour-btn" data-tour-act="back">Back</button>
          <button type="button" class="tour-btn tour-btn--primary" data-tour-act="next">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-tour-act]')?.getAttribute('data-tour-act');
    if (act === 'skip') finish('done');
    else if (act === 'back') show(index - 1);
    else if (act === 'next') void onNext();
  });

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onCaptureClick, true);
  document.addEventListener('input', onUserInput, true);
  document.addEventListener('change', onUserInput, true);
  document.addEventListener('v5-admin-rendered', onRendered);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('scroll', scheduleLayout, true);
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'class', 'aria-selected'],
  });
}

function rootEl() {
  return document.getElementById('tourRoot');
}

function onKeyDown(e) {
  if (!running || e.key !== 'Escape' || overlayBlocked()) return;
  e.preventDefault();
  e.stopPropagation();
  finish('done');
}

function onUserInput() {
  if (!running || suppressAdvance) return;
  if (shouldAutoAdvance()) {
    show(index + 1);
    return;
  }
  scheduleLayout();
}

function onCaptureClick(e) {
  if (!running) return;
  const step = steps[index];
  if (step?.id !== 'open-event' || eventSectionOpen()) return;
  const card = e.target.closest?.('a.event-card');
  if (!card || !card.closest('.home-page')) return;
  const route = parseRoute(card.getAttribute('href') || '');
  if (route.view !== 'event' || !route.eventId) return;
  e.preventDefault();
  e.stopPropagation();
  void api?.go(route);
}

function eventSectionOpen() {
  const section = document.querySelector('.sidebar-section[data-section="event-planning"]');
  return !!section && !section.hidden;
}

function onMutations(records) {
  if (!running) return;
  const tour = rootEl();
  const internal = records.every((record) => tour && (record.target === tour || tour.contains(record.target)));
  if (internal) return;
  onRendered();
}

function onRendered() {
  if (!running || suppressAdvance) return;
  if (shouldAutoAdvance()) {
    show(index + 1);
    return;
  }
  scheduleLayout();
}

function scheduleLayout() {
  if (!running) return;
  if (layoutFrame) cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    relayout();
  });
}

function paintCard() {
  const step = steps[index];
  const root = rootEl();
  if (!step || !root) return;
  const kicker = root.querySelector('#tourKicker');
  const title = root.querySelector('#tourTitle');
  const copy = root.querySelector('#tourCopy');
  const back = root.querySelector('[data-tour-act="back"]');
  const next = root.querySelector('[data-tour-act="next"]');
  if (kicker) kicker.textContent = `${index + 1} of ${steps.length}`;
  if (title) title.textContent = stepText(step.title);
  if (copy) copy.textContent = stepText(step.body);
  if (back) back.disabled = index === 0;
  if (next) {
    const waiting = typeof step.complete === 'function' && nextAction(step) === 'stay';
    next.textContent = waiting ? 'Waiting…' : (index === steps.length - 1 ? 'Done' : 'Next');
    next.disabled = nextAction(step) === 'stay';
  }
  const pass = armed?.passthrough ?? !!step.passthrough;
  root.classList.toggle('tour-root--pass', pass && !eventSectionOpen());
}

function holeFor(rect) {
  let top = rect.top - HOLE_PAD;
  let left = rect.left - HOLE_PAD;
  let right = rect.right + HOLE_PAD;
  let bottom = rect.bottom + HOLE_PAD;
  const maxBottom = Math.min(window.innerHeight - 8, top + HOLE_MAX);
  if (bottom > maxBottom) bottom = maxBottom;
  top = Math.max(8, top);
  left = Math.max(8, left);
  right = Math.min(window.innerWidth - 8, right);
  bottom = Math.min(window.innerHeight - 8, bottom);
  if (right - left < 16 || bottom - top < 16) return null;
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

function setEdge(edge, box) {
  const el = rootEl()?.querySelector(`[data-edge="${edge}"]`);
  if (!el) return;
  el.hidden = !!box.hidden;
  if (box.hidden) return;
  el.style.top = `${box.top}px`;
  el.style.left = `${box.left}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

function placeShades(hole) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!hole) {
    setEdge('top', { top: 0, left: 0, width: vw, height: vh });
    setEdge('left', { hidden: true });
    setEdge('right', { hidden: true });
    setEdge('bottom', { hidden: true });
    return;
  }
  setEdge('top', { top: 0, left: 0, width: vw, height: Math.max(0, hole.top) });
  setEdge('left', { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height });
  setEdge('right', {
    top: hole.top,
    left: hole.right,
    width: Math.max(0, vw - hole.right),
    height: hole.height,
  });
  setEdge('bottom', {
    top: hole.bottom,
    left: 0,
    width: vw,
    height: Math.max(0, vh - hole.bottom),
  });
}

function placeCard(hole) {
  const card = rootEl()?.querySelector('.tour-card');
  if (!card) return;
  const margin = 12;
  const gap = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(card.offsetWidth, Math.min(320, vw - margin * 2));
  const h = Math.max(card.offsetHeight, 120);
  let left = (vw - w) / 2;
  let top = (vh - h) / 2;
  if (hole) {
    const spaceRight = vw - hole.right - gap - margin;
    const spaceLeft = hole.left - gap - margin;
    if (spaceRight >= w) {
      left = hole.right + gap;
      top = hole.top;
    } else if (spaceLeft >= w) {
      left = hole.left - gap - w;
      top = hole.top;
    } else if (vh - hole.bottom - gap - margin >= h) {
      left = Math.min(hole.left, vw - w - margin);
      top = hole.bottom + gap;
    } else {
      left = Math.min(Math.max(margin, hole.left), vw - w - margin);
      top = Math.max(margin, hole.top - gap - h);
    }
  }
  left = Math.max(margin, Math.min(left, vw - w - margin));
  top = Math.max(margin, Math.min(top, vh - h - margin));
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function maybePrepare() {
  const step = steps[index];
  if (!step || prepared) return;
  if (step.ready && !step.ready()) return;
  prepared = true;
  try {
    step.prepare?.();
  } catch (err) {
    console.warn('tour prepare', err);
  }
}

function relayout({ scroll = false } = {}) {
  if (!running) return;
  const root = rootEl();
  if (!root) return;
  if (overlayBlocked()) {
    root.hidden = true;
    return;
  }
  maybePrepare();
  const step = steps[index];
  const target = step?.target?.() || null;
  root.hidden = false;
  paintCard();
  if (scroll && target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = target ? holeFor(target.getBoundingClientRect()) : null;
  const ring = root.querySelector('.tour-ring');
  if (ring) {
    ring.hidden = !rect;
    if (rect) {
      ring.style.top = `${rect.top}px`;
      ring.style.left = `${rect.left}px`;
      ring.style.width = `${rect.width}px`;
      ring.style.height = `${rect.height}px`;
    }
  }
  placeShades(rect);
  placeCard(rect);
}

function waitFor(gen, probe) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (gen !== generation) {
        resolve(false);
        return;
      }
      if (probe()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= WAIT_MS) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

async function show(nextIndex) {
  const gen = ++generation;
  if (nextIndex < 0) nextIndex = 0;
  const present = (step) => !!step.target?.();
  const resolved = skipMissingOptional(steps, nextIndex, present);
  if (resolved >= steps.length) {
    finish('done');
    return;
  }
  index = resolved;
  const step = steps[index];
  armed = null;
  prepared = false;
  writeActiveStep(storageSession(), step.id);
  ensureDom();
  const root = rootEl();
  if (root) root.hidden = false;
  paintCard();

  if (step.ensure && step.route && !routeSatisfies(step.route, parseRoute())) {
    const dest = step.destination?.(api?.eventId() || '');
    if (dest) {
      suppressAdvance = true;
      try {
        await api?.go(dest);
      } catch (err) {
        console.warn('tour navigate', err);
      } finally {
        suppressAdvance = false;
      }
      if (gen !== generation) return;
    }
  }

  if (step.ready || step.target) {
    await waitFor(gen, () => {
      if (step.ready && !step.ready()) return false;
      if (step.target) return !!step.target();
      return true;
    });
    if (gen !== generation) return;
  }

  const arm = step.arm?.() || {};
  armed = {
    autoAdvance: arm.autoAdvance ?? !!step.autoAdvance,
    passthrough: arm.passthrough ?? !!step.passthrough,
    wasSatisfied: !!(step.route && routeSatisfies(step.route, parseRoute())),
  };

  if (gen !== generation) return;
  if (shouldAutoAdvance()) {
    show(index + 1);
    return;
  }
  relayout({ scroll: true });
  const nextBtn = rootEl()?.querySelector('[data-tour-act="next"]');
  if (nextBtn && !nextBtn.disabled) nextBtn.focus({ preventScroll: true });
}

async function onNext() {
  const step = steps[index];
  if (!step || !running) return;
  const action = nextAction(step);
  if (action === 'stay') return;
  if (action === 'navigate') {
    const dest = step.destination?.(api?.eventId() || '');
    if (!dest) return;
    suppressAdvance = true;
    try {
      await api?.go(dest);
    } catch (err) {
      console.warn('tour navigate', err);
      return;
    } finally {
      suppressAdvance = false;
    }
    if (!routeSatisfies(step.route, parseRoute())) return;
  }
  show(index + 1);
}

function finish(status) {
  generation += 1;
  running = false;
  armed = null;
  index = 0;
  writeActiveStep(storageSession(), null);
  if (status) writeTourStatus(storageLocal(), status);
  const root = rootEl();
  if (root) root.hidden = true;
  paintLauncher();
  const sampleId = api?.eventId?.() || '';
  const leave = api?.isSample?.(sampleId);
  api?.forgetSample?.();
  const prev = previousEventId;
  previousEventId = '';
  if (leave) {
    void api?.go(prev
      ? { view: 'event', eventId: prev, panel: 'dashboard' }
      : { view: 'home' });
  }
}

function hideInvite() {
  if (inviteEl) inviteEl.hidden = true;
}

function ensureLauncher() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return null;
  if (!inviteEl) {
    inviteEl = document.createElement('div');
    inviteEl.id = 'tourInvite';
    inviteEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-tour-invite]')?.getAttribute('data-tour-invite');
      if (act === 'later') {
        writeTourStatus(storageLocal(), 'later');
        paintLauncher();
      } else if (act === 'start') {
        startPlanTour();
      }
    });
  }
  if (!footer.contains(inviteEl)) footer.insertBefore(inviteEl, footer.firstChild);
  return inviteEl;
}

function paintLauncher() {
  const el = ensureLauncher();
  if (!el) return;
  if (running) {
    el.hidden = true;
    return;
  }
  const offer = shouldOfferTour(readTourStatus(storageLocal()));
  el.className = offer ? 'tour-invite' : 'tour-invite tour-invite--compact';
  el.hidden = false;
  el.innerHTML = offer
    ? `
      <p class="tour-invite-title">Plan an event</p>
      <p class="tour-invite-copy">Practice on a hidden sample event: add a product, price it, then raise an order.</p>
      <div class="tour-invite-actions">
        <button type="button" class="tour-btn tour-btn--quiet" data-tour-invite="later">Later</button>
        <button type="button" class="tour-btn tour-btn--primary" data-tour-invite="start">Start</button>
      </div>`
    : `<button type="button" class="tour-btn tour-btn--primary tour-replay-btn" data-tour-invite="start">Walkthrough</button>`;
}

/**
 * @param {{ go: (route: object) => Promise<unknown>, eventId: () => string, can?: (feature: string) => boolean }} nextApi
 */
export function configurePlanTour(nextApi) {
  api = {
    go: nextApi.go,
    eventId: nextApi.eventId,
    can: nextApi.can || (() => true),
    isSample: nextApi.isSample || (() => false),
    ensureSample: nextApi.ensureSample,
    rememberEvent: nextApi.rememberEvent,
    forgetSample: nextApi.forgetSample,
  };
}

/** First successful paint: resume an in-progress tour, or show the launcher. */
export function maybeOfferPlanTour() {
  if (!api) return;
  const active = readActiveStep(storageSession());
  if (active) {
    startPlanTour({ startId: active });
    return;
  }
  paintLauncher();
}

/** @param {{ startId?: string | null }} [opts] */
export function startPlanTour({ startId = null } = {}) {
  if (!api) return;
  hideInvite();
  const current = api.eventId?.() || '';
  if (current && !api.isSample?.(current)) previousEventId = current;
  steps = stepsForRole(planEventSteps(), api.can);
  running = true;
  paintLauncher();
  ensureDom();
  const start = resumeIndex(steps, startId);
  void bootSample(startId, start);
}

async function bootSample(startId, start) {
  const gen = generation;
  try {
    const sample = await api?.ensureSample?.({ reset: !startId });
    if (gen !== generation && !running) return;
    if (sample) api?.rememberEvent?.(sample);
  } catch (err) {
    running = false;
    paintLauncher();
    toast(err.message || 'Could not open the practice event', true);
    return;
  }
  if (!running) return;
  show(start);
}
