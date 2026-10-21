/**
 * Map a Square sales file onto this event's menu, name the import, then review the mix.
 * A later file is averaged with the ones already saved.
 */

import { escapeHtml } from '../lib/util.js';
import { averageImportMixes, importLinesFromMix, saleMappingStatus, sellingPrice } from '../lib/order-forecast.js';

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

function namedImport(model) {
  return String(model.importName || '').trim();
}

function stepButton(id, model, number, title) {
  const order = ['map', 'name', 'review'];
  const current = order.indexOf(model.step);
  const mine = order.indexOf(id);
  const mapped = mappedItems(model).length > 0;
  const enabled = id === 'map' || (id === 'name' && mapped) || (id === 'review' && mapped && namedImport(model));
  const done = mine < current;
  const cls = `sq-step${model.step === id ? ' is-active' : ''}${done ? ' is-done' : ''}`;
  return `<li><button type="button" class="${cls}" data-map-goto="${id}" ${enabled ? '' : 'disabled'}><span class="sq-step-badge">${done ? '✓' : number}</span><span class="sq-step-title">${title}</span></button></li>`;
}

function stepsHtml(model) {
  return `<ol class="sq-steps" aria-label="Import steps">
    ${stepButton('map', model, '1', 'Map products')}
    ${stepButton('name', model, '2', 'Name import')}
    ${stepButton('review', model, '3', 'Review mix')}
  </ol>`;
}

function guessableCount(model) {
  const manual = new Set(model.manual || []);
  return (model.items || []).filter((item) => {
    if (manual.has(item.key) || model.mappings?.[item.key]) return false;
    const suggestion = suggestionFor(model.suggestions, item.key);
    return suggestion.confidence === 'guess' && suggestion.lineKey;
  }).length;
}

function choiceLabel(line) {
  const serve = String(line?.serveLabel || '').trim();
  const size = String(line?.caseSize || '').trim();
  if (serve && serve.toLowerCase() !== size.toLowerCase()) return `${line.name} · ${serve}`;
  return line?.name || 'Product';
}

function pickButtonHtml(item, lines, selected) {
  const chosen = selected ? (lines || []).find((line) => line.key === selected) : null;
  const label = chosen ? choiceLabel(chosen) : 'Leave out';
  const size = chosen?.caseSize ? String(chosen.caseSize).trim() : '';
  return `<button type="button" class="ord-map-pick${chosen ? '' : ' is-empty'}" data-map-sale="${escapeHtml(item.key)}" data-map-line="${escapeHtml(selected || '')}" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(`Menu line for ${item.name}`)}">
    <span class="ord-map-pick-label">${escapeHtml(label)}</span>
    ${size ? `<span class="ord-map-pick-size">${escapeHtml(size)}</span>` : ''}
  </button>`;
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
      ${pickButtonHtml(item, model.lines, selected)}
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
  const suggested = items.filter((item) => statusOf(model, item).kind === 'guess').length;
  const bits = [`${mapped.length} of ${items.length} mapped`, `${money(mappedAmount)} of ${money(total)}`];
  if (needs) bits.push(needs === 1 ? '1 still needs a choice' : `${needs} still need a choice`);
  if (suggested) bits.push(`${suggested} suggested`);
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
  const guesses = guessableCount(model);
  const similarNote = model.filter === 'todo' && items.some((item) => statusOf(model, item).kind === 'suggest')
    ? '<p class="ord-map-hint muted">Similar names are already filled in. Switch to All to check them.</p>'
    : '';
  const guessNote = guesses
    ? `<p class="ord-map-hint muted">Auto map can line up ${guesses} more from the names. Check the suggestions before you continue.</p>`
    : '';
  return `<div class="ord-map">
    ${stepsHtml(model)}
    <p class="ord-mix-note"><strong>${escapeHtml(model.fileName || 'Sales file')}</strong> — ${items.length} item${items.length === 1 ? '' : 's'}, ${money(total)}. Match each one to a line on this menu. Leave out anything this event does not sell.</p>
    <p class="ord-map-summary" aria-live="polite">${escapeHtml(summaryText(model))}</p>
    <div class="ord-map-tools">
      <button type="button" class="ord-map-auto" data-map-auto ${guesses ? '' : 'disabled'}>Auto map</button>
      <div class="sq-seg" role="group" aria-label="Which sales items to show">
        <button type="button" data-map-filter="todo" aria-pressed="${model.filter === 'todo'}">Needs a choice (${needs})</button>
        <button type="button" data-map-filter="all" aria-pressed="${model.filter === 'all'}">All (${items.length})</button>
      </div>
      <input type="search" class="admin-input" data-map-query value="${escapeHtml(model.query || '')}" placeholder="Filter sales items" aria-label="Filter sales items" autocomplete="off">
    </div>
    ${guessNote}
    ${similarNote}
    <div class="ord-map-list" data-map-list>${table}</div>
  </div>`;
}

function nameHtml(model) {
  const others = (model.savedImports || []).map((row) => row.name).filter(Boolean);
  const already = others.length
    ? `<p class="ord-mix-note">Already saved: ${escapeHtml(others.join(', '))}. This import is averaged with ${others.length === 1 ? 'that one' : 'those'}. Each import has an equal weight.</p>`
    : '<p class="ord-mix-note">After this is saved you can import another sales file. The forecast uses the average of every named import.</p>';
  return `<div class="ord-map">
    ${stepsHtml(model)}
    <label class="admin-field ord-import-name">
      <span class="admin-label">Name this import</span>
      <input class="admin-input" data-import-name value="${escapeHtml(model.importName || '')}" placeholder="Fall Festival 2024" maxlength="80" autocomplete="off">
    </label>
    ${already}
  </div>`;
}

function categoriesOf(lines) {
  const map = new Map();
  (lines || []).forEach((line) => {
    const category = line.category || 'Uncategorised';
    const cur = map.get(category) || { category, amount: 0, pct: 0 };
    cur.amount += Number(line.amount) || 0;
    cur.pct += Number(line.pct) || 0;
    map.set(category, cur);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

function reviewLines(model) {
  const current = importLinesFromMix(model.mix);
  const saved = model.savedImports || [];
  if (!current.length || !saved.length) return current;
  return averageImportMixes([...saved, { lines: current }]);
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
  const saved = model.savedImports || [];
  const lines = reviewLines(model);
  const categories = categoriesOf(lines);
  const byKey = new Map((model.lines || []).map((line) => [line.key, line]));
  const needsPrice = lines.filter((row) => !sellingPrice(byKey.get(row.key) || {}).price);
  const cats = categories.length
    ? `<ul class="ord-gen-list">${categories.map((row) => `<li><strong>${escapeHtml(row.category)}</strong> — ${escapeHtml(pctText(row.pct))}% · ${money(row.amount)}</li>`).join('')}</ul>`
    : '';
  const matched = lines.length
    ? `<table class="ord-lines"><thead><tr><th>Line</th><th>Category</th><th class="num">Sales</th><th class="num">Mix</th></tr></thead><tbody>
        ${lines.map((row) => `<tr><td>${escapeHtml(row.name)}${row.serveLabel ? ` · ${escapeHtml(row.serveLabel)}` : ''}</td><td>${escapeHtml(row.category)}</td><td class="num">${money(row.amount)}</td><td class="num">${escapeHtml(pctText(row.pct))}%</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="muted">Nothing in this file is mapped to the menu.</p>';
  const skipped = (mix.unmatched || []).filter((row) => row.reason === 'skipped' || row.reason === 'unknown');
  const skippedNote = skipped.length
    ? `<p class="ord-mix-note muted">${escapeHtml(pctText(skipped.reduce((sum, row) => sum + row.pct, 0)))}% of the file is left out: ${escapeHtml(listOf(skipped))}.</p>`
    : '';
  const priceNote = needsPrice.length
    ? `<p class="ord-mix-note">${escapeHtml(needsPrice.map((row) => row.name).join(', '))} ${needsPrice.length === 1 ? 'is' : 'are'} mapped but ${needsPrice.length === 1 ? 'has' : 'have'} no price, so ${needsPrice.length === 1 ? 'it' : 'they'} will be skipped.</p>`
    : '';
  const fileTarget = Number(model.previewTarget) > 0 ? Number(model.previewTarget) : null;
  const names = saved.map((row) => row.name).filter(Boolean);
  const targetNote = model.hasTarget
    ? `This mix is scaled to the current target of ${money(model.target)}.`
    : (fileTarget
      ? `No target yet. Saving sets the target to ${money(fileTarget)} — ${names.length ? 'the average of the mapped takings.' : 'the takings mapped onto this menu.'}`
      : 'Nothing in this file is mapped to the menu, so there is no take to apply.');
  const averageNote = names.length
    ? ` Saving averages this file with ${names.join(', ')}. Each import has an equal weight.`
    : ' The mix is the share of the mapped takings. You can import another sales file afterwards.';
  const label = names.length ? 'Average mix' : escapeHtml(model.importName || model.fileName || 'Sales file');
  return `<div class="ord-map">
    ${stepsHtml(model)}
    <p class="ord-mix-note"><strong>${names.length ? 'Average mix' : label}</strong> — ${escapeHtml(pctText(mix.matchedPct))}% of ${money(mix.total)} in this file is mapped to the menu.${escapeHtml(averageNote)}</p>
    <p class="ord-mix-note">${escapeHtml(targetNote)}</p>
    ${cats}
    <div class="ord-mix-preview">${matched}</div>
    ${skippedNote}
    ${priceNote}
  </div>`;
}

export function salesWizardBody(model) {
  if (model.step === 'review') return reviewHtml(model);
  if (model.step === 'name') return nameHtml(model);
  return mapHtml(model);
}

let menuEl = null;
let menuCleanup = null;

export function closeMapLineMenu() {
  menuCleanup?.();
  menuCleanup = null;
  menuEl?.remove();
  menuEl = null;
  document.querySelectorAll('.ord-map-pick[aria-expanded="true"]').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function placeMapMenu(anchor) {
  if (!menuEl) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(rect.width, 340);
  menuEl.style.width = `${width}px`;
  const height = menuEl.offsetHeight;
  const below = window.innerHeight - rect.bottom;
  const top = below < height + 8 && rect.top > height + 8
    ? rect.top - height - 4
    : rect.bottom + 4;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  menuEl.style.top = `${Math.max(8, top)}px`;
  menuEl.style.left = `${left}px`;
}

function choiceHay(line) {
  return [line.name, line.serveLabel, line.caseSize, line.category, line.sku].filter(Boolean).join(' ').toLowerCase();
}

/**
 * Custom menu so each product can show its case size. A native select only has one line of text.
 */
export function openMapLineMenu({ anchor, lines = [], selected = '', onPick }) {
  closeMapLineMenu();
  const choices = [...lines].sort((a, b) => (a.category || 'Uncategorised').localeCompare(b.category || 'Uncategorised')
    || (a.name || '').localeCompare(b.name || '')
    || String(a.serveLabel || '').localeCompare(String(b.serveLabel || '')));
  let query = '';
  let active = 0;

  menuEl = document.createElement('div');
  menuEl.className = 'ord-map-menu';
  menuEl.innerHTML = `
    <div class="ord-map-menu-search">
      <input class="admin-input" type="text" placeholder="Find a product" aria-label="Find a product" autocomplete="off" spellcheck="false">
    </div>
    <div class="ord-map-menu-list" role="listbox"></div>`;
  document.body.appendChild(menuEl);
  anchor.setAttribute('aria-expanded', 'true');

  const search = menuEl.querySelector('input');
  const list = menuEl.querySelector('.ord-map-menu-list');

  function shown() {
    const q = query.trim().toLowerCase();
    const rows = [];
    if (!q || 'leave out'.startsWith(q)) {
      rows.push({ key: '', label: 'Leave out', size: '', category: '' });
    }
    choices.forEach((line) => {
      if (q && !choiceHay(line).includes(q)) return;
      rows.push({
        key: line.key,
        label: choiceLabel(line),
        size: String(line.caseSize || '').trim(),
        category: line.category || 'Uncategorised',
      });
    });
    return rows;
  }

  function renderList() {
    const rows = shown();
    if (active > rows.length - 1) active = Math.max(0, rows.length - 1);
    let lastGroup = null;
    const html = [];
    if (!rows.length) {
      list.innerHTML = '<p class="ord-map-menu-empty">No products match</p>';
    } else {
      rows.forEach((row, index) => {
        if (row.category && row.category !== lastGroup) {
          lastGroup = row.category;
          html.push(`<div class="ord-map-menu-group">${escapeHtml(row.category)}</div>`);
        }
        const current = (row.key || '') === (selected || '') ? ' is-current' : '';
        const on = index === active ? ' is-active' : '';
        html.push(`<button type="button" class="ord-map-menu-option${current}${on}" role="option" data-line="${escapeHtml(row.key)}" id="ord-map-opt-${index}">
          <span class="ord-map-menu-name">${escapeHtml(row.label)}</span>
          ${row.size ? `<span class="ord-map-menu-size">${escapeHtml(row.size)}</span>` : ''}
        </button>`);
      });
      list.innerHTML = html.join('');
    }
    const currentBtn = list.querySelector('.is-active');
    if (currentBtn) {
      search.setAttribute('aria-activedescendant', currentBtn.id);
      const listRect = list.getBoundingClientRect();
      const btnRect = currentBtn.getBoundingClientRect();
      if (btnRect.top < listRect.top) list.scrollTop -= listRect.top - btnRect.top;
      else if (btnRect.bottom > listRect.bottom) list.scrollTop += btnRect.bottom - listRect.bottom;
    } else {
      search.removeAttribute('aria-activedescendant');
    }
    placeMapMenu(anchor);
  }

  function pick(lineKey) {
    closeMapLineMenu();
    onPick(anchor.dataset.mapSale || '', lineKey || '');
  }

  function onPointerDown(e) {
    if (menuEl?.contains(e.target) || anchor.contains(e.target)) return;
    closeMapLineMenu();
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeMapLineMenu();
  }
  function onScroll() {
    if (!anchor.isConnected) {
      closeMapLineMenu();
      return;
    }
    placeMapMenu(anchor);
  }
  const listScroller = anchor.closest('.ord-map-list');
  const modalBody = anchor.closest('.admin-modal-body');
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onScroll);
  listScroller?.addEventListener('scroll', onScroll, { passive: true });
  if (modalBody && modalBody !== listScroller) {
    modalBody.addEventListener('scroll', onScroll, { passive: true });
  }
  menuCleanup = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onScroll);
    listScroller?.removeEventListener('scroll', onScroll);
    modalBody?.removeEventListener('scroll', onScroll);
  };

  list.addEventListener('mousemove', (e) => {
    const choice = e.target.closest('[data-line]');
    if (!choice || !menuEl) return;
    const index = [...list.querySelectorAll('.ord-map-menu-option')].indexOf(choice);
    if (index < 0 || index === active) return;
    active = index;
    list.querySelectorAll('.ord-map-menu-option').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === active);
    });
  });
  list.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-line]');
    if (!choice) return;
    pick(choice.dataset.line || '');
  });
  search.addEventListener('input', () => {
    query = search.value;
    active = 0;
    renderList();
  });
  search.addEventListener('keydown', (e) => {
    const rows = shown();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!rows.length) return;
      active = Math.min(rows.length - 1, active + 1);
      renderList();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      active = Math.max(0, active - 1);
      renderList();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (rows.length) pick(rows[active]?.key || '');
  });

  const currentIndex = choices.findIndex((line) => line.key === selected);
  active = currentIndex >= 0 ? currentIndex + 1 : 0;
  renderList();
  search.focus();
}

export function bindMapLinePicks(root, { lines, onPick }) {
  root.querySelectorAll('[data-map-sale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true') {
        closeMapLineMenu();
        return;
      }
      openMapLineMenu({
        anchor: btn,
        lines,
        selected: btn.dataset.mapLine || '',
        onPick,
      });
    });
  });
}

export function salesWizardFoot(model) {
  if (model.step === 'review') {
    return `<div class="admin-modal-confirm-foot">
      <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-back>Back</button>
      <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok ${model.canApply ? '' : 'disabled'}>${escapeHtml(model.applyLabel || 'Save import')}</button>
    </div>`;
  }
  if (model.step === 'name') {
    return `<div class="admin-modal-confirm-foot">
      <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-back>Back</button>
      <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-next ${namedImport(model) ? '' : 'disabled'}>Review mix</button>
    </div>`;
  }
  const mapped = mappedItems(model).length;
  return `<div class="admin-modal-confirm-foot">
    <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
    <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-next ${mapped ? '' : 'disabled'}>Name import</button>
  </div>`;
}
