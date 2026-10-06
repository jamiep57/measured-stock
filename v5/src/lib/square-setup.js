/**
 * Progress through the per-event Square live sales setup on the sales page.
 */

export const SQUARE_STEPS = [
  { id: 'connect', title: 'Connect Square' },
  { id: 'link', title: 'Link bars' },
  { id: 'pull', title: 'Pull sales' },
  { id: 'compare', title: 'Compare' },
  { id: 'switch', title: 'Go live' },
];

/**
 * @param {{
 *   connected: boolean,
 *   barCount: number,
 *   linkedCount: number,
 *   squareLines: number,
 *   uploadLines: number,
 *   salesSource: 'csv'|'square',
 *   compareSeen?: boolean,
 * }} state
 */
export function squareSetupProgress(state) {
  const live = state.salesSource === 'square';
  const done = {
    connect: Boolean(state.connected),
    link: state.barCount > 0 && state.linkedCount >= state.barCount,
    pull: state.squareLines > 0,
    compare: live || (state.squareLines > 0 && (state.uploadLines === 0 || Boolean(state.compareSeen))),
    switch: live,
  };
  const steps = SQUARE_STEPS.map((step) => ({ ...step, done: done[step.id] }));
  const firstOpen = steps.findIndex((step) => !step.done);
  return {
    steps,
    current: firstOpen === -1 ? steps.length - 1 : firstOpen,
    doneCount: steps.filter((step) => step.done).length,
    complete: firstOpen === -1,
  };
}

/** @param {Array<{ items_sold?: number, net_sales?: number }>} rows */
export function feedTotals(rows) {
  let items = 0;
  let net = 0;
  for (const row of rows || []) {
    items += Number(row.items_sold) || 0;
    net += Number(row.net_sales) || 0;
  }
  return { lines: (rows || []).length, items, net: Math.round(net * 100) / 100 };
}
