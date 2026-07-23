/**
 * Reusable table filter panel — tabbed selector + compact sections.
 */

import { escapeHtml } from '../lib/util.js';
import { icon } from '../lib/icons.js';

function selectedCount(section, values) {
  const val = values[section.id];
  if (section.type === 'checkbox') return (val || []).length;
  return 0;
}

function sectionLabel(section, values) {
  let count = section.showCount ? selectedCount(section, values) : 0;
  if (section.hideCountWhenFull && section.type === 'checkbox') {
    const val = values[section.id] || [];
    if (val.length === (section.options || []).length) count = 0;
  }
  const suffix = count > 0 ? ` (${count})` : '';
  return `${escapeHtml(section.label)}${suffix}`;
}

function isOptionChecked(section, values, value) {
  const val = values[section.id];
  if (section.type === 'radio') return val === value;
  return Array.isArray(val) && val.includes(value);
}

function renderOption(section, opt, values) {
  const inputType = section.type === 'radio' ? 'radio' : 'checkbox';
  const checked = isOptionChecked(section, values, opt.value) ? ' checked' : '';
  const meta = opt.meta
    ? `<span class="tfp-option-meta">${escapeHtml(opt.meta)}</span>`
    : '';

  return `<label class="tfp-option tfp-option--${inputType}">
    <input type="${inputType}" name="tfp-${escapeHtml(section.id)}" value="${escapeHtml(opt.value)}"${checked}>
    <span class="tfp-option-control" aria-hidden="true"></span>
    <span class="tfp-option-label">${escapeHtml(opt.label)}</span>
    ${meta}
  </label>`;
}

function renderCompactSection(section, values) {
  const scrollClass = section.scroll ? ' tfp-group-body--scroll' : '';
  return `<div class="tfp-group" data-section="${escapeHtml(section.id)}">
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
      ${renderTabs(tabs, activeTab)}
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

  container._tfpAbort?.abort();
  const abort = new AbortController();
  container._tfpAbort = abort;
  const { signal } = abort;

  function currentTab() {
    return tabs.find((t) => t.id === activeTab) || tabs[0];
  }

  function paint() {
    container.innerHTML = renderCombinedTableFilterPanel({
      tabs,
      activeTab,
      activeItems: getActiveItems?.() || [],
    });
  }

  function readCheckboxValues(sectionId) {
    return [...container.querySelectorAll(`input[name="tfp-${sectionId}"]:checked`)].map((el) => el.value);
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
    const input = e.target.closest('input[type="radio"], input[type="checkbox"]');
    if (!input) return;
    const tab = currentTab();
    const sectionId = input.name.replace(/^tfp-/, '');
    const section = tab?.sections.find((s) => s.id === sectionId);
    if (!section) return;

    if (section.type === 'radio') {
      tab.onChange?.(sectionId, input.value);
      return;
    }
    tab.onChange?.(sectionId, readCheckboxValues(sectionId));
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

export function tableFilterIsActive(values, defaults, sections) {
  return sections.some((section) => {
    const val = values[section.id];
    const def = defaults[section.id];
    if (section.type === 'radio') return val !== def;
    const a = Array.isArray(val) ? [...val].sort().join('|') : '';
    const b = Array.isArray(def) ? [...def].sort().join('|') : '';
    return a !== b;
  });
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
