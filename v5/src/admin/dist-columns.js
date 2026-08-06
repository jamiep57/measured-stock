/** Column visibility helpers for the distribution grid. */

export function colVisible(ctx, key) {
  if (key === 'product') return true;
  return !(ctx.controls?.hiddenColumns || []).includes(key);
}

export function stickyColCount(ctx) {
  // Pack is folded into the product cell meta — not a separate sticky column.
  let n = 1;
  if (colVisible(ctx, 'opening')) n += 1;
  if (colVisible(ctx, 'lta')) n += 1;
  return n;
}

export function scrollColCount(ctx) {
  let n = 0;
  if (colVisible(ctx, 'bone-yard')) n += 1;
  (ctx.bars || []).forEach((b) => {
    if (colVisible(ctx, `bar:${b.id}`)) n += 1;
  });
  return n;
}

export function totalColCount(ctx) {
  return stickyColCount(ctx) + scrollColCount(ctx);
}

export function applyStickyColumnOffsets(grid, panelEl, ctx) {
  if (!grid) return;
  const rs = getComputedStyle(panelEl);
  const productW = rs.getPropertyValue('--dist-product-w').trim() || '240px';
  const openingW = rs.getPropertyValue('--dist-opening-w').trim() || '64px';

  let openingLeft = productW;
  grid.style.setProperty('--col-opening-left', openingLeft);

  let ltaLeft = openingLeft;
  if (colVisible(ctx, 'opening')) {
    ltaLeft = `calc(${productW} + ${openingW})`;
  }
  grid.style.setProperty('--col-lta-left', ltaLeft);

  const scrollHintLeft = colVisible(ctx, 'lta')
    ? ltaLeft
    : colVisible(ctx, 'opening')
      ? openingLeft
      : productW;
  grid.closest('.dist-grid-wrap')?.style.setProperty('--dist-scroll-hint-left', scrollHintLeft);
}
