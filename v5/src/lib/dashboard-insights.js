/**
 * Dashboard chart data + HTML helpers (CSS/SVG — no chart library).
 */

import { escapeHtml } from './util.js';
import { findRecipe, recipeIsMapped } from './square-recipes.js';
import { projectionStatus } from './stock-projection.js';
import { hrefForRoute } from '../admin/router.js';

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function countMappedRows(rows, itemKey, variationKey, recipes) {
  let mapped = 0;
  (rows || []).forEach((r) => {
    if (recipeIsMapped(findRecipe(recipes, r[itemKey], r[variationKey]))) mapped += 1;
  });
  return mapped;
}

export function computeDashboardInsights(ctx) {
  const p = ctx.projection || {};
  const tillMapped = countMappedRows(ctx.tillRows, 'name', 'variation', ctx.recipes);
  const modMapped = countMappedRows(ctx.modRows, 'modifier', 'modifier_set', ctx.recipes);
  const tillTotal = ctx.tillRows?.length || 0;
  const modTotal = ctx.modRows?.length || 0;

  const mappedNet = Number(p.mappedNet) || 0;
  const baselineNet = Number(p.baselineNet) || 0;
  const unmappedNet = Math.max(0, baselineNet - mappedNet);

  const stockOutlook = { lasts: 0, tight: 0, runsOut: 0, other: 0 };
  (p.items || []).forEach((it) => {
    if (!it.inEvent) {
      stockOutlook.other += 1;
      return;
    }
    const st = projectionStatus(it, p.target);
    if (st.tone === 'ok') stockOutlook.lasts += 1;
    else if (st.label === 'Tight') stockOutlook.tight += 1;
    else if (st.label === 'Runs out' || st.label === 'No stock') stockOutlook.runsOut += 1;
    else stockOutlook.other += 1;
  });

  const stockTotal = stockOutlook.lasts + stockOutlook.tight + stockOutlook.runsOut + stockOutlook.other;

  const atRisk = (p.items || [])
    .filter((it) => it.inEvent && it.runOutRevenue != null && p.target > 0)
    .map((it) => ({
      name: it.name,
      pct: (it.runOutRevenue / p.target) * 100,
      tone: projectionStatus(it, p.target).tone,
    }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 6);

  return {
    till: { mapped: tillMapped, total: tillTotal, pct: pct(tillMapped, tillTotal) },
    mod: { mapped: modMapped, total: modTotal, pct: pct(modMapped, modTotal) },
    sales: {
      mappedNet,
      unmappedNet,
      baselineNet,
      mappedPct: pct(mappedNet, baselineNet),
    },
    stockOutlook,
    stockTotal,
    atRisk,
  };
}

export function buildQuickActions(ctx) {
  const { eventId } = ctx;
  const href = (panel) => hrefForRoute({ view: 'event', eventId, panel });
  const insights = computeDashboardInsights(ctx);
  const actions = [];

  if (!ctx.tillRows?.length) {
    actions.push({
      icon: 'upload',
      label: 'Import item sales',
      desc: 'Upload Square Item Sales',
      href: href('sales'),
      primary: true,
    });
  } else if (insights.till.mapped < insights.till.total) {
    actions.push({
      icon: 'wand-sparkles',
      label: 'Import sales',
      desc: `${insights.till.total - insights.till.mapped} lines need recipes`,
      href: href('sales'),
      primary: true,
    });
  }

  if (!ctx.modRows?.length) {
    actions.push({
      icon: 'upload',
      label: 'Import modifiers',
      desc: 'Upload Modifier Sales',
      href: href('sales'),
    });
  } else if (insights.mod.mapped < insights.mod.total) {
    actions.push({
      icon: 'wand-sparkles',
      label: 'Map modifiers',
      desc: `${insights.mod.total - insights.mod.mapped} lines need recipes`,
      href: href('sales'),
    });
  }

  if (!ctx.event?.target_revenue) {
    actions.push({
      icon: 'pound-sterling',
      label: 'Set target revenue',
      desc: 'Required for run-out projection',
      href: href('setup'),
      primary: !actions.some((a) => a.primary),
    });
  }

  actions.push(
    { icon: 'truck', label: 'Log delivery', desc: 'Record stock received', href: href('deliveries') },
    { icon: 'arrow-left-right', label: 'Log transfer', desc: 'Move stock between bars', href: href('transfers') },
    { icon: 'trash', label: 'Log wastage', desc: 'Record write-offs', href: href('wastage') },
    { icon: 'share-2', label: 'Update count', desc: 'Enter stock at each bar', href: href('counts') },
    { icon: 'pound-sterling', label: 'Financial recon', desc: 'Post-event supplier close', href: href('recon') },
    { icon: 'plus', label: 'Add products', desc: 'Build event catalogue', href: href('products') },
    { icon: 'settings', label: 'Event setup', desc: 'Bars, dates, recipients', href: href('setup') },
  );

  const seen = new Set();
  return actions.filter((a) => {
    if (seen.has(a.href + a.label)) return false;
    seen.add(a.href + a.label);
    return true;
  }).slice(0, 8);
}

function renderStackedBar(segments, total) {
  if (!total) {
    return '<div class="dash-stack-track dash-stack-track--empty muted">No stocked mapped products yet</div>';
  }
  const bars = segments
    .filter((s) => s.count > 0)
    .map((s) => `<div class="dash-stack-seg dash-stack-seg--${s.tone}" style="width:${(s.count / total) * 100}%" title="${escapeHtml(s.label)}: ${s.count}"></div>`)
    .join('');
  return `<div class="dash-stack-track">${bars}</div>`;
}

export function renderDashboardCharts(ctx, insights) {
  const stockSegments = [
    { tone: 'ok', label: 'Lasts', count: insights.stockOutlook.lasts },
    { tone: 'warn', label: 'Tight', count: insights.stockOutlook.tight },
    { tone: 'danger', label: 'Runs out', count: insights.stockOutlook.runsOut },
    { tone: 'muted', label: 'Other', count: insights.stockOutlook.other },
  ];

  const atRiskBars = insights.atRisk.length
    ? insights.atRisk.map((row) => {
      const w = Math.max(4, Math.min(100, row.pct));
      return `
        <div class="dash-bar-row">
          <span class="dash-bar-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
          <div class="dash-bar-track">
            <div class="dash-bar-fill dash-bar-fill--${row.tone}" style="width:${w}%"></div>
          </div>
          <span class="dash-bar-pct dash-pct--${row.tone}">${Math.round(row.pct)}%</span>
        </div>`;
    }).join('')
    : '<div class="dash-chart-empty muted">Map sales and set a target to see at-risk products.</div>';

  return `
    <div class="dash-charts">
      <div class="dash-chart-card admin-surface">
        <h3 class="dash-chart-title">Stock outlook</h3>
        ${renderStackedBar(stockSegments, insights.stockTotal)}
        <div class="dash-legend dash-legend--inline">
          ${stockSegments.filter((s) => s.count > 0).map((s) => `
            <div class="dash-legend-item">
              <span class="dash-legend-swatch dash-legend-swatch--${s.tone}"></span>
              <span class="dash-legend-label">${escapeHtml(s.label)}</span>
              <span class="dash-legend-value">${s.count}</span>
            </div>`).join('') || '<span class="muted">No projection data</span>'}
        </div>
        <h4 class="dash-chart-subtitle">Earliest run-out</h4>
        <div class="dash-bars">${atRiskBars}</div>
      </div>
    </div>`;
}

export function renderQuickActions(actions, iconFn) {
  if (!actions.length) return '';
  return `
    <section class="dash-actions admin-surface">
      <div class="dash-section-head">
        <h2 class="dash-section-title">Quick actions</h2>
        <p class="dash-section-desc muted">Common tasks for this event.</p>
      </div>
      <div class="dash-action-grid">
        ${actions.map((a) => `
          <a class="dash-action${a.primary ? ' dash-action--primary' : ''}" href="${escapeHtml(a.href)}">
            <span class="dash-action-icon">${iconFn(a.icon, { size: 18 })}</span>
            <span class="dash-action-text">
              <span class="dash-action-label">${escapeHtml(a.label)}</span>
              <span class="dash-action-desc muted">${escapeHtml(a.desc)}</span>
            </span>
          </a>`).join('')}
      </div>
    </section>`;
}
