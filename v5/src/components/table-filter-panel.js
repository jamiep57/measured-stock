/**
 * Reusable table filter panel — tabbed selector + compact sections.
 * Section types: checkbox, searchable-checkbox, radio, segment, date-range, text.
 */

import { escapeHtml } from '../lib/util.js';
import { icon } from '../lib/icons.js';

const MULTI_TYPES = new Set(['checkbox', 'searchable-checkbox']);

function selectedCount(section, values) {
  const val = values[section.id];
  if (MULTI_TYPES.has(section.type)) return (val || []).length;
  return 0;
}

function sectionLabel(section, values) {
  let count = section.showCount ? selectedCount(section, values) : 0;
  if (section.hideCountWhenFull && MULTI_TYPES.has(section.type)) {
    const val = values[section.id] || [];
    if (val.length === (section.options || []).length) count = 0;
  }
  const suffix = count > 0 ? ` (${count})` : '';
  return `${escapeHtml(section.label)}${suffix}`;
}

function isOptionChecked(section, values, value) {
  const val = values[section.id];
  if (section.type === 'radio' || section.type === 'segment') return val === value;
  return Array.isArray(val) && val.includes(value);
}

function renderOption(section, opt, values) {
  const inputType = (section.type === 'radio' || section.type === 'segment') ? 'radio' : 'checkbox';
  const checked = isOptionChecked(section, values, opt.value) ? ' checked' : '';
  const disabled = opt.disabled ? ' disabled' : '';
  const meta = opt.meta
    ? `<span class="tfp-option-meta">${escapeHtml(opt.meta)}</span>`
    : '';
  const swatch = opt.dot
    ? `<span class="tfp-option-dot tfp-option-dot--${escapeHtml(opt.dot)}" aria-hidden="true"></span>`
    : '';

  return `<label class="tfp-option tfp-option--${inputType}${opt.disabled ? ' is-disabled' : ''}">
    <input type="${inputType}" name="tfp-${escapeHtml(section.id)}" value="${escapeHtml(String(opt.value))}"${checked}${disabled}>
    <span class="tfp-option-control" aria-hidden="true"></span>
    <span class="tfp-option-label">${swatch}${escapeHtml(opt.label)}</span>
    ${meta}
  </label>`;
}

function renderSegmentOption(section, opt, values) {
  const checked = isOptionChecked(section, values, opt.value);
  const disabled = opt.disabled ? ' disabled' : '';
  const swatch = opt.dot
    ? `<span class="tfp-seg-dot tfp-seg-dot--${escapeHtml(opt.dot)}" aria-hidden="true"></span>`
    : '';
  return `<button type="button" class="tfp-seg-btn${checked ? ' is-active' : ''}"
    data-tfp-segment="${escapeHtml(section.id)}" data-value="${escapeHtml(String(opt.value))}"
    role="radio" aria-checked="${checked}"${disabled}>
    ${swatch}<span>${escapeHtml(opt.label)}</span>
  </button>`;
}

function renderSearchableCheckbox(section, values) {
  const scrollClass = section.scroll ? ' tfp-group-body--scroll' : '';
  const q = (section._searchQuery || '').trim().toLowerCase();
  const options = (section.options || []).filter((opt) => {
    if (!q) return true;
    return String(opt.label || '').toLowerCase().includes(q)
      || String(opt.value || '').toLowerCase().includes(q);
  });
  return `<div class="tfp-group" data-section="${escapeHtml(section.id)}" data-type="searchable-checkbox">
    <div class="tfp-group-label">${sectionLabel(section, values)}</div>
    <div class="tfp-search-wrap">
      <input type="search" class="tfp-search" data-tfp-search="${escapeHtml(section.id)}"
        placeholder="${escapeHtml(section.searchPlaceholder || 'Search…')}"
        value="${escapeHtml(section._searchQuery || '')}" autocomplete="off">
    </div>
    <div class="tfp-group-body${scrollClass}">
      ${options.length
    ? options.map((opt) => renderOption({ ...section, type: 'checkbox' }, opt, values)).join('')
    : '<div class="tfp-empty">No matches</div>'}
    </div>
  </div>`;
}

function renderSegmentSection(section, values) {
  return `<div class="tfp-group" data-section="${escapeHtml(section.id)}" data-type="segment">
    <div class="tfp-group-label">${sectionLabel(section, values)}</div>
    <div class="tfp-seg" role="radiogroup" aria-label="${escapeHtml(section.label)}">
      ${(section.options || []).map((opt) => renderSegmentOption(section, opt, values)).join('')}
    </div>
  </div>`;
}

function renderDateRangeSection(section, values) {
  const val = values[section.id] || {};
  return `<div class="tfp-group" data-section="${escapeHtml(section.id)}" data-type="date-range">
    <div class="tfp-group-label">${sectionLabel(section, values)}</div>
    <div class="tfp-date-range">
      <label class="tfp-date-field">
        <span class="tfp-date-label">${escapeHtml(section.fromLabel || 'From')}</span>
        <input type="date" class="tfp-date-input" data-tfp-date="${escapeHtml(section.id)}" data-part="from"
          value="${escapeHtml(val.from || '')}">
      </label>
      <label class="tfp-date-field">
        <span class="tfp-date-label">${escapeHtml(section.toLabel || 'To')}</span>
        <input type="date" class="tfp-date-input" data-tfp-date="${escapeHtml(section.id)}" data-part="to"
          value="${escapeHtml(val.to || '')}">
      </label>
    </div>
  </div>`;
}

function renderTextSection(section, values) {
  const val = values[section.id] ?? '';
  return `<div class="tfp-group" data-section="${escapeHtml(section.id)}" data-type="text">
    <div class="tfp-group-label">${sectionLabel(section, values)}</div>
    <div class="tfp-text-wrap">
      <input type="search" class="tfp-text-input" data-tfp-text="${escapeHtml(section.id)}"
        placeholder="${escapeHtml(section.placeholder || 'Search…')}"
        value="${escapeHtml(val)}" autocomplete="off">
    </div>
  </div>`;
}

function renderCompactSection(section, values) {
  if (section.type === 'searchable-checkbox') return renderSearchableCheckbox(section, values);
  if (section.type === 'segment') return renderSegmentSection(section, values);
  if (section.type === 'date-range') return renderDateRangeSection(section, values);
  if (section.type === 'text') return renderTextSection(section, values);

  const scrollClass = section.scroll ? ' tfp-group-body--scroll' : '';
  const optionType = section.type === 'radio' ? 'radio' : 'checkbox';
  return `<div class="tfp-group" data-section="${escapeHtml(section.id)}" data-type="${escapeHtml(optionType)}">
    <div class="tfp-group-label">${sectionLabel(section, values)}</div>
    <div class="tfp-group-body${scrollClass}">
      ${(section.options || []).map((opt) => renderOption(section, opt, values)).join('')}
    </div>
  </div>`;
}

function renderTabs(tabs, activeTab) {
  return `<div class="tfp-tabs" role="tablist">
    ${tabs.map((tab) => `
      <button type="button" class="tfp-tab${tab.id === activeTab ? ' is-active' : ''}"
        role="tab" aria-selected="${tab.id === activeTab}" data-tab="${escapeHtml(tab.id)}">
        ${tab.icon ? icon(tab.icon, { size: 14 }) : ''}
        <span>${escapeHtml(tab.label)}</span>
      </button>
    `).join('')}
  </div>`;
}

function renderActiveItems(activeItems) {
  if (!activeItems?.length) return '';
  return `<ul class="tfp-active">
    ${activeItems.map((item) => `
      <li class="tfp-active-item">
        <span class="tfp-active-label">${escapeHtml(item.label)}</span>
        <button type="button" class="tfp-active-remove" data-tfp-remove="${escapeHtml(item.id)}"
          aria-label="Remove ${escapeHtml(item.label)}">
          ${icon('x', { size: 12 })}
        </button>
      </li>
    `).join('')}
  </ul>`;
}

export function renderCombinedTableFilterPanel({ tabs, activeTab, activeItems = [] }) {
  const tab = tabs.find((t) => t.id === activeTab) || tabs[0];
  return `
    <div class="tfp-panel">
      ${tabs.length > 1 ? renderTabs(tabs, activeTab) : ''}
      <div class="tfp-body" data-tab-panel="${escapeHtml(tab?.id || '')}">
        <div class="tfp-groups">
          ${(tab?.sections || []).map((s) => renderCompactSection(s, tab.values || {})).join('')}
        </div>
      </div>
      <div class="tfp-foot">
        ${renderActiveItems(activeItems)}
        <button type="button" class="tfp-reset" data-tfp-reset>Reset</button>
      </div>
    </div>`;
}

export function mountCombinedTableFilterPanel(container, options = {}) {
  const {
    tabs = [],
    activeTab: initialTab,
    onTabChange,
    getActiveItems,
    onRemoveActiveItem,
  } = options;
  let activeTab = initialTab || tabs[0]?.id;
  const searchQueries = {};

  container._tfpAbort?.abort();
  const abort = new AbortController();
  container._tfpAbort = abort;
  const { signal } = abort;

  function currentTab() {
    return tabs.find((t) => t.id === activeTab) || tabs[0];
  }

  function decorateTabs() {
    return tabs.map((tab) => ({
      ...tab,
      sections: (tab.sections || []).map((section) => {
        if (section.type !== 'searchable-checkbox') return section;
        return {
          ...section,
          _searchQuery: searchQueries[section.id] || '',
        };
      }),
    }));
  }

  function paint({ preserveSearchFocus = false } = {}) {
    const searchEl = preserveSearchFocus
      ? container.querySelector('.tfp-search:focus, .tfp-text-input:focus')
      : null;
    const focusSection = searchEl?.dataset.tfpSearch || searchEl?.dataset.tfpText || null;
    const focusPos = searchEl ? searchEl.selectionStart : null;

    container.innerHTML = renderCombinedTableFilterPanel({
      tabs: decorateTabs(),
      activeTab,
      activeItems: getActiveItems?.() || [],
    });

    if (focusSection) {
      const next = container.querySelector(
        `[data-tfp-search="${focusSection}"], [data-tfp-text="${focusSection}"]`,
      );
      if (next) {
        next.focus();
        if (typeof focusPos === 'number') {
          try { next.setSelectionRange(focusPos, focusPos); } catch { /* ignore */ }
        }
      }
    }
  }

  function readCheckboxValues(sectionId) {
    return [...container.querySelectorAll(`input[name="tfp-${sectionId}"]:checked`)].map((el) => el.value);
  }

  function readDateRange(sectionId) {
    const from = container.querySelector(`[data-tfp-date="${sectionId}"][data-part="from"]`)?.value || '';
    const to = container.querySelector(`[data-tfp-date="${sectionId}"][data-part="to"]`)?.value || '';
    return { from, to };
  }

  container.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn && tabBtn.closest('.tfp-tabs')) {
      e.stopPropagation();
      const next = tabBtn.dataset.tab;
      if (next && next !== activeTab) {
        activeTab = next;
        onTabChange?.(activeTab);
        paint();
      }
      return;
    }

    const segBtn = e.target.closest('[data-tfp-segment]');
    if (segBtn && !segBtn.disabled) {
      e.stopPropagation();
      const sectionId = segBtn.dataset.tfpSegment;
      const tab = currentTab();
      const section = tab?.sections.find((s) => s.id === sectionId);
      if (!section) return;
      tab.onChange?.(sectionId, segBtn.dataset.value);
      return;
    }

    if (e.target.closest('[data-tfp-reset]')) {
      e.stopPropagation();
      currentTab()?.onReset?.();
      return;
    }
    const removeBtn = e.target.closest('[data-tfp-remove]');
    if (removeBtn) {
      e.stopPropagation();
      onRemoveActiveItem?.(removeBtn.dataset.tfpRemove);
    }
  }, { signal });

  container.addEventListener('change', (e) => {
    const dateInput = e.target.closest('[data-tfp-date]');
    if (dateInput) {
      const sectionId = dateInput.dataset.tfpDate;
      const tab = currentTab();
      tab?.onChange?.(sectionId, readDateRange(sectionId));
      return;
    }

    const input = e.target.closest('input[type="radio"], input[type="checkbox"]');
    if (!input) return;
    const tab = currentTab();
    const sectionId = input.name.replace(/^tfp-/, '');
    const section = tab?.sections.find((s) => s.id === sectionId);
    if (!section) return;

    if (section.type === 'radio' || section.type === 'segment') {
      tab.onChange?.(sectionId, input.value);
      return;
    }
    tab.onChange?.(sectionId, readCheckboxValues(sectionId));
  }, { signal });

  container.addEventListener('input', (e) => {
    const search = e.target.closest('[data-tfp-search]');
    if (search) {
      searchQueries[search.dataset.tfpSearch] = search.value;
      paint({ preserveSearchFocus: true });
      return;
    }
    const text = e.target.closest('[data-tfp-text]');
    if (text) {
      const tab = currentTab();
      tab?.onChange?.(text.dataset.tfpText, text.value);
    }
  }, { signal });

  paint();

  return {
    setActiveTab(id) {
      if (id === activeTab) return;
      activeTab = id;
      onTabChange?.(activeTab);
      paint();
    },
    updateTab(id, nextValues) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) Object.assign(tab.values, nextValues);
      if (id === activeTab) paint();
    },
    repaint() {
      paint();
    },
  };
}

function valuesEqual(section, a, b) {
  if (section.type === 'radio' || section.type === 'segment' || section.type === 'text') {
    return (a ?? '') === (b ?? '');
  }
  if (section.type === 'date-range') {
    const aa = a || {};
    const bb = b || {};
    return (aa.from || '') === (bb.from || '') && (aa.to || '') === (bb.to || '');
  }
  const aa = Array.isArray(a) ? [...a].map(String).sort().join('|') : '';
  const bb = Array.isArray(b) ? [...b].map(String).sort().join('|') : '';
  return aa === bb;
}

export function tableFilterIsActive(values, defaults, sections) {
  return sections.some((section) => !valuesEqual(section, values[section.id], defaults[section.id]));
}

/** Parse structured chip id `sectionId` or `sectionId:value`. */
export function parseActiveItemId(id) {
  const idx = String(id || '').indexOf(':');
  if (idx === -1) return { sectionId: id, value: null };
  return {
    sectionId: id.slice(0, idx),
    value: id.slice(idx + 1),
  };
}

/** @deprecated — use mountCombinedTableFilterPanel */
export function mountTableFilterPanel(container, options = {}) {
  return mountCombinedTableFilterPanel(container, {
    activeTab: 'main',
    tabs: [{
      id: 'main',
      label: options.title || 'Filter',
      sections: options.sections || [],
      values: options.values || {},
      onChange: options.onChange,
      onReset: options.onReset,
    }],
  });
}

export function renderTableFilterPanel(opts) {
  return renderCombinedTableFilterPanel({
    tabs: [{ id: 'main', label: opts.title || 'Filter', sections: opts.sections, values: opts.values }],
    activeTab: 'main',
  });
}
