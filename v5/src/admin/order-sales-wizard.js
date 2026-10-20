/**
 * Map a Square sales file onto this event's menu, then review the mix.
 * Sales from another event often use different product names.
 */

import { escapeHtml } from '../lib/util.js';
import { matchedTakingsTarget, saleMappingStatus, sellingPrice } from '../lib/order-forecast.js';

function money(n) {
  const v = Number(n);
  if (n == null || !Number.isFinite(v)) return '—';
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctText(n) {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  return String(Math.round(Number(n) * 10) / 10);
}

function suggestionFor(suggestions, key) {
  return (suggestions || []).find((row) => row.saleKey === key)
    || { saleKey: key, lineKey: '', confidence: 'none' };
}

function mappedItems(model) {
  return (model.items || []).filter((item) => model.mappings?.[item.key]);
}

function statusOf(model, item) {
  return saleMappingStatus(model.mappings?.[item.key], suggestionFor(model.suggestions, item.key));
}

function visibleItems(model) {
  const q = String(model.query || '').trim().toLowerCase();
  return (model.items || []).filter((item) => {
    if (model.filter === 'todo' && statusOf(model, item).kind !== 'need') return false;
    if (!q) return true;
    return [item.name, item.variation, item.sku, item.category].join(' ').toLowerCase().includes(q);
  });
}

function stepsHtml(model) {
  const mapped = mappedItems(model).length;
  const mapClass = `sq-step${model.step === 'map' ? ' is-active' : ''}${model.step === 'review' ? ' is-done' : ''}`;
  const reviewClass = `sq-step${model.step === 'review' ? ' is-active' : ''}`;
  return `<ol class="sq-steps" aria-label="Import steps">
    <li><button type="button" class="${mapClass}" data-map-goto="map"><span class="sq-step-badge">${model.step === 'review' ? '✓' : '1'}</span><span class="sq-step-title">Map products</span></button></li>
    <li><button type="button" class="${reviewClass}" data-map-goto="review" ${mapped ? '' : 'disabled'}><span class="sq-step-badge">2</span><span class="sq-step-title">Review mix</span></button></li>
  </ol>`;
}

function menuOptionsHtml(lines, selected) {
  const groups = new Map();
  (lines || []).forEach((line) => {
    const category = line.category || 'Uncategorised';
    const list = groups.get(category) || [];
    list.push(line);
    groups.set(category, list);
  });
  const groupsHtml = [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((category) => {
    const options = groups.get(category)
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')
        || String(a.serveLabel || '').localeCompare(String(b.serveLabel || '')))
      .map((line) => {
        const label = line.serveLabel ? `${line.name} · ${line.serveLabel}` : line.name;
        const sel = line.key === selected ? ' selected' : '';
        return `<option value="${escapeHtml(line.key)}"${sel}>${escapeHtml(label)}</option>`;
      }).join('');
    return `<optgroup label="${escapeHtml(category)}">${options}</optgroup>`;
  }).join('');
  return `<option value=""${selected ? '' : ' selected'}>Leave out</option>${groupsHtml}`;
}

function mapRowHtml(item, model) {
  const selected = model.mappings?.[item.key] || '';
  const status = statusOf(model, item);
  const bits = [];
  if (item.variation && item.variation.toLowerCase() !== 'regular') bits.push(item.variation);
  if (item.sku) bits.push(item.sku);
  if (item.category) bits.push(item.category);
  if (item.itemsSold) bits.push(`${Number(item.itemsSold).toLocaleString('en-GB')} sold`);
  const meta = bits.length ? `<span class="ord-map-meta">${escapeHtml(bits.join(' · '))}</span>` : '';
  return `<tr class="ord-map-row ord-map-row--${status.kind}">
    <td>
      <div class="ord-map-item">
        <span class="ord-forecast-name">${escapeHtml(item.name)}</span>
        ${meta}
      </div>
    </td>
    <td class="num">${money(item.amount)}</td>
    <td>
      <select class="admin-select" data-map-sale="${escapeHtml(item.key)}" aria-label="${escapeHtml(`Menu line for ${item.name}`)}">
        ${menuOptionsHtml(model.lines, selected)}
      </select>
    </td>
    <td><span class="ord-map-status ord-map-status--${status.kind}">${escapeHtml(status.label)}</span></td>
  </tr>`;
}

function summaryText(model) {
  const items = model.items || [];
  const mapped = mappedItems(model);
  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const mappedAmount = mapped.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const needs = items.filter((item) => statusOf(model, item).kind === 'need').length;
  const similar = items.filter((item) => statusOf(model, item).kind === 'suggest').length;
  const bits = [`${mapped.length} of ${items.length} mapped`, `${money(mappedAmount)} of ${money(total)}`];
  if (needs) bits.push(needs === 1 ? '1 still needs a choice' : `${needs} still need a choice`);
  if (similar) bits.push(`${similar} similar ${similar === 1 ? 'name' : 'names'} to check`);
  return bits.join(' · ');
}

function mapHtml(model) {
  const items = model.items || [];
  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const needs = items.filter((item) => statusOf(model, item).kind === 'need').length;
  const rows = visibleItems(model);
  const empty = !model.lines?.length
    ? '<p class="ord-forecast-empty muted">Nothing is on this menu yet. Add products in Menu &amp; GP, then import the file again.</p>'
    : (rows.length
      ? ''
      : `<p class="ord-forecast-empty muted">${model.query?.trim()
        ? 'No sales items match that filter.'
        : 'Every item already has a menu line. Switch to All to review them.'}</p>`);
  const table = rows.length
    ? `<table class="ord-map-table">
        <thead><tr>
          <th scope="col">Sales item</th>
          <th scope="col" class="num">Takings</th>
          <th scope="col">Menu line</th>
          <th scope="col">Status</th>
        </tr></thead>
        <tbody>${rows.map((item) => mapRowHtml(item, model)).join('')}</tbody>
      </table>`
    : empty;
  const similarNote = model.filter === 'todo' && items.some((item) => statusOf(model, item).kind === 'suggest')
    ? '<p class="ord-map-hint muted">Similar names are already filled in. Switch to All to check them.</p>'
    : '';
  return `<div class="ord-map">
    ${stepsHtml(model)}
    <p class="ord-mix-note"><strong>${escapeHtml(model.fileName || 'Sales file')}</strong> — ${items.length} item${items.length === 1 ? '' : 's'}, ${money(total)}. Match each one to a line on this menu. Leave out anything this event does not sell.</p>
    <p class="ord-map-summary" aria-live="polite">${escapeHtml(summaryText(model))}</p>
    <div class="ord-map-tools">
      <div class="sq-seg" role="group" aria-label="Which sales items to show">
        <button type="button" data-map-filter="todo" aria-pressed="${model.filter === 'todo'}">Needs a choice (${needs})</button>
        <button type="button" data-map-filter="all" aria-pressed="${model.filter === 'all'}">All (${items.length})</button>
      </div>
      <input type="search" class="admin-input" data-map-query value="${escapeHtml(model.query || '')}" placeholder="Filter sales items" aria-label="Filter sales items" autocomplete="off">
    </div>
    ${similarNote}
    <div class="ord-map-list" data-map-list>${table}</div>
  </div>`;
}

function itemLabel(row) {
  const variation = row.variation && row.variation.toLowerCase() !== 'regular' ? ` (${row.variation})` : '';
  return `${row.name}${variation}`;
}

function listOf(rows) {
  const shown = rows.slice(0, 8).map(itemLabel).join(', ');
  const more = rows.length > 8 ? ` and ${rows.length - 8} more` : '';
  return `${shown}${more}`;
}

function reviewHtml(model) {
  const mix = model.mix || { lines: [], unmatched: [], categories: [], total: 0, matchedPct: 0 };
  const byKey = new Map((model.lines || []).map((line) => [line.key, line]));
  const needsPrice = (mix.lines || []).filter((row) => !sellingPrice(byKey.get(row.key) || {}).price);
  const cats = mix.categories?.length
    ? `<ul class="ord-gen-list">${mix.categories.map((row) => `<li><strong>${escapeHtml(row.category)}</strong> — ${escapeHtml(pctText(row.pct))}% · ${money(row.amount)}</li>`).join('')}</ul>`
    : '';
  const matched = mix.lines?.length
    ? `<table class="ord-lines"><thead><tr><th>Line</th><th>Category</th><th class="num">Sales</th><th class="num">Mix</th></tr></thead><tbody>
        ${mix.lines.map((row) => `<tr><td>${escapeHtml(row.name)}${row.serveLabel ? ` · ${escapeHtml(row.serveLabel)}` : ''}</td><td>${escapeHtml(row.category)}</td><td class="num">${money(row.amount)}</td><td class="num">${escapeHtml(pctText(row.pct))}%</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="muted">Nothing in this file is mapped to the menu.</p>';
  const skipped = (mix.unmatched || []).filter((row) => row.reason === 'skipped' || row.reason === 'unknown');
  const skippedNote = skipped.length
    ? `<p class="ord-mix-note muted">${escapeHtml(pctText(skipped.reduce((sum, row) => sum + row.pct, 0)))}% of the file is left out: ${escapeHtml(listOf(skipped))}.</p>`
    : '';
  const priceNote = needsPrice.length
    ? `<p class="ord-mix-note">${escapeHtml(needsPrice.map((row) => row.name).join(', '))} ${needsPrice.length === 1 ? 'is' : 'are'} mapped but ${needsPrice.length === 1 ? 'has' : 'have'} no price, so ${needsPrice.length === 1 ? 'it' : 'they'} will be skipped.</p>`
    : '';
  const fileTarget = matchedTakingsTarget(mix);
  const targetNote = model.hasTarget
    ? `This mix will be scaled to the current target of ${money(model.target)}.`
    : (fileTarget
      ? `No target yet. Applying sets the target to ${money(fileTarget)} — the takings mapped onto this menu.`
      : 'Nothing in this file is mapped to the menu, so there is no take to apply.');
  const untouched = (model.suggestions || []).length > 0
    && model.suggestions.every((row) => row.confidence === 'auto' && (model.mappings?.[row.saleKey] || '') === row.lineKey);
  const matchedNote = untouched ? ' Every item matched a line on this menu.' : '';
  return `<div class="ord-map">
    ${stepsHtml(model)}
    <p class="ord-mix-note"><strong>${escapeHtml(model.fileName || 'Sales file')}</strong> — ${escapeHtml(pctText(mix.matchedPct))}% of ${money(mix.total)} is mapped to the menu.${escapeHtml(matchedNote)} Applying sets projected serves from that mix and clears planned-case overrides on those products.</p>
    <p class="ord-mix-note">${escapeHtml(targetNote)}</p>
    ${cats}
    <div class="ord-mix-preview">${matched}</div>
    ${skippedNote}
    ${priceNote}
  </div>`;
}

export function salesWizardBody(model) {
  return model.step === 'review' ? reviewHtml(model) : mapHtml(model);
}

export function salesWizardFoot(model) {
  if (model.step === 'review') {
    return `<div class="admin-modal-confirm-foot">
      <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-back>Back</button>
      <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok ${model.canApply ? '' : 'disabled'}>${escapeHtml(model.applyLabel || 'Apply mix')}</button>
    </div>`;
  }
  const mapped = mappedItems(model).length;
  return `<div class="admin-modal-confirm-foot">
    <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
    <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-next ${mapped ? '' : 'disabled'}>Review mix</button>
  </div>`;
}
