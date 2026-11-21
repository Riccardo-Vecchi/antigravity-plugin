'use strict';

// Only a distinct native effort span proves that a model has adjustable effort.
// Parenthetical model names such as "Thinking" or "Medium" are not capabilities.
function selectionFor(trigger, observedLevels = []) {
  const label = trigger?.querySelector(':scope > span:not([data-agpa-model-ui])');
  const suffix = label?.querySelector(':scope > span:not([data-agpa-effort-ui])');
  const base = label && [...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  if (!base) return null;
  if (base === 'Orchestrator') {
    const masterSummary = suffix?.textContent.trim() || '';
    // The native composer combines these values in one span. Learn new labels
    // from its menus, with the shipped labels covering the first paint.
    const levels = [...observedLevels, 'Extra High', 'Medium', 'Minimal', 'Extra', 'High', 'Low'];
    const effortLabel = levels.filter(level => masterSummary.endsWith(' ' + level))
      .sort((a, b) => b.length - a.length)[0] || '';
    const master = effortLabel ? masterSummary.slice(0, -effortLabel.length).trimEnd() : '';
    return {base, effortLabel, suffix, master, masterSummary};
  }
  return {base, effortLabel: suffix?.textContent.trim().split(/\s+·\s+/)[0] || '', suffix};
}

function optionsFor(menu, testId = 'model-selector-effort-option') {
  const options = [], seen = new Set();
  for (const label of menu.querySelectorAll('[data-testid=' + testId + ']')) {
    const row = label.closest('[role=menuitemradio],[role=menuitem]');
    const value = label.dataset.effort;
    // Context-window submenus retain the native UI; selecting them here could
    // silently reset a context-window choice. Never invent a mapping by name.
    if (!row || row.closest('[role=menu]') !== menu || row.hasAttribute('aria-haspopup') ||
        !/^[a-z][a-z0-9_-]{0,31}$/.test(value || '') || seen.has(value)) return [];
    seen.add(value);
    if (row.getAttribute('aria-disabled') === 'true' || row.hasAttribute('data-disabled')) continue;
    options.push({value, label: label.textContent.trim(), row, selected: row.getAttribute('aria-checked') === 'true'});
  }
  return options.length > 1 ? options : [];
}

function layoutFor(model, permission) {
  let footer = model?.parentElement;
  while (footer && !footer.classList.contains('@container/input-footer')) footer = footer.parentElement;
  if (!footer || !permission || !footer.contains(permission)) return null;
  const flatten = new Set();
  for (const button of [model, permission])
    for (let parent = button.parentElement; parent && parent !== footer; parent = parent.parentElement) flatten.add(parent);
  const tail = [...permission.parentElement.children].filter(n => n !== permission);
  return {footer, flatten: [...flatten], tail};
}

module.exports = {selectionFor, optionsFor, layoutFor};
