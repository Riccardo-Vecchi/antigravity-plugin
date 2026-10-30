/* Visual Context Budget indicator and /compact recommendation. */
(() => {
  'use strict';
  const VERSION = '1.0.3';
  if (globalThis.__AGContextBudget?.version === VERSION) return;
  globalThis.__AGContextBudget?.destroy();

  const rules = globalThis.__AGPA_CONTEXT_BUDGET__ || require('./context-budget.cjs');
  const i18n = globalThis.__AGPAI18n;
  const t = (key, values) => (i18n ? i18n.t(key, values) : key);

  let stopped = false, timer = null;
  let activeStats = null, popup = null;

  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    node.setAttribute('data-agpa-context-ui', '');
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function closePopup() {
    if (popup) {
      popup.remove();
      popup = null;
    }
  }

  function insertCompact(button) {
    const editor = button?.closest('.surface-composer')?.querySelector('[contenteditable=true][role=combobox]') ||
      document.querySelector('.surface-composer [contenteditable=true][role=combobox]');
    if (!editor || editor.getAttribute('aria-disabled') === 'true') return false;
    editor.focus({ preventScroll: true });

    if (editor.textContent.includes('/compact')) {
      closePopup();
      return true;
    }

    const data = new DataTransfer();
    data.setData('text/plain', '/compact ');
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    closePopup();
    return true;
  }

  function openDetails(button, stats) {
    closePopup();
    if (stopped) return;
    popup = element('div', {
      class: 'agpa-context-popup',
      role: 'dialog',
      'aria-label': t('Context: {tokens}', { tokens: stats.formatted })
    });

    const header = element('div', { class: 'agpa-context-header' });
    const title = element('strong', { text: t('Context: {tokens}', { tokens: stats.formatted }) });
    const closeBtn = element('button', {
      type: 'button',
      class: 'agpa-context-close',
      'aria-label': t('Close'),
      text: '×'
    });
    closeBtn.addEventListener('click', closePopup);
    header.append(title, closeBtn);

    const desc = element('p', {
      class: 'agpa-context-desc',
      text: t('Context budget: {tokens} tokens ({turns} turns)', {
        tokens: stats.formatted,
        turns: String(stats.turns)
      })
    });

    const statusNote = element('div', {
      class: 'agpa-context-status',
      'data-level': stats.budget.level,
      text:
        stats.budget.level === 'healthy' || stats.budget.level === 'moderate'
          ? t('Context budget is healthy')
          : stats.budget.level === 'elevated'
          ? t('Context budget is elevated. Consider using /compact.')
          : t('Context budget is saturated. /compact recommended.')
    });

    popup.append(header, desc, statusNote);

    if (stats.budget.level === 'elevated' || stats.budget.level === 'saturated') {
      const action = element('button', {
        type: 'button',
        class: 'agpa-context-compact-btn',
        text: t('Insert /compact')
      });
      action.addEventListener('click', () => insertCompact(button));
      popup.append(action);
    }

    document.body.append(popup);
    const rect = button.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.right - 220, window.innerWidth - 230)) + 'px';
    popup.style.top = Math.max(8, rect.top - popup.offsetHeight - 8) + 'px';
    if (rect.top < popup.offsetHeight + 16) {
      popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - popup.offsetHeight - 8) + 'px';
    }
  }

  function createPill() {
    const pill = element('button', {
      type: 'button',
      class: 'agpa-context-pill',
      'data-agpa-context-budget': '',
      'aria-haspopup': 'dialog'
    });
    pill.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (popup) closePopup();
      else openDetails(pill, activeStats || rules.extractConversationStats(document));
    });
    return pill;
  }

  function updatePill(pill, stats) {
    if (pill.getAttribute('data-level') !== stats.budget.level) {
      pill.setAttribute('data-level', stats.budget.level);
    }
    pill.style.setProperty('--budget-color', stats.budget.color);

    const tokenLabel = stats.formatted.endsWith('k') ? `${stats.formatted} tok` : `${stats.formatted} tok`;
    const labelText = stats.budget.level === 'saturated' ? `⚠️ ${tokenLabel} · /compact` : tokenLabel;

    if (pill.textContent !== labelText) pill.textContent = labelText;
    const titleText = t('Context: {tokens}', { tokens: tokenLabel });
    if (pill.getAttribute('title') !== titleText) pill.setAttribute('title', titleText);
    const ariaText = t('Context budget: {tokens} tokens ({turns} turns)', {
      tokens: stats.formatted,
      turns: String(stats.turns)
    });
    if (pill.getAttribute('aria-label') !== ariaText) pill.setAttribute('aria-label', ariaText);
  }

  function apply() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (stopped) return;

    const stats = rules.extractConversationStats(document);
    activeStats = stats;

    const triggers = document.querySelectorAll('[data-testid=model-selector-trigger]');
    if (!triggers.length) {
      const footers = document.querySelectorAll('[data-agpa-composer-footer], [class*="input-footer"]');
      for (const footer of footers) {
        let pill = footer.querySelector('[data-agpa-context-budget]');
        if (stats.turns === 0 && stats.chars < 100) {
          closePopup();
          if (pill) pill.remove();
          continue;
        }
        if (!pill) {
          pill = createPill();
          footer.append(pill);
        }
        updatePill(pill, stats);
      }
      return;
    }

    for (const trigger of triggers) {
      const parent = trigger.parentElement;
      let pill = parent?.querySelector('[data-agpa-context-budget]') || document.querySelector('[data-agpa-context-budget]');
      if (stats.turns === 0 && stats.chars < 100) {
        closePopup();
        if (pill) pill.remove();
        continue;
      }

      const effort = parent?.querySelector('.agpa-effort-trigger');
      const anchor = effort || trigger;

      if (!pill) {
        pill = createPill();
        anchor.after(pill);
      } else if (pill.previousElementSibling !== anchor) {
        anchor.after(pill);
      }

      updatePill(pill, stats);
    }
  }

  function schedule(immediate = false) {
    if (stopped) return;
    if (immediate) {
      if (timer) clearTimeout(timer);
      timer = null;
      apply();
      return;
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) apply();
    }, 200);
  }

  const style = element('style');
  style.id = 'agpa-context-budget-styles';
  style.textContent = `
    .agpa-context-pill {
      order: 22;
      height: 24px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      padding: 0 8px;
      margin-left: 2px;
      border: 1px solid var(--border, #444);
      border-radius: 999px;
      background: var(--card, #252525);
      color: var(--secondary-foreground, #aaa);
      font: 500 11px system-ui, sans-serif;
      cursor: pointer;
      white-space: nowrap;
      transition: all 180ms ease-out;
    }
    .agpa-context-pill:hover {
      background: var(--secondary, #333);
      color: var(--foreground, #eee);
      border-color: var(--budget-color, #6ba9ff);
    }
    .agpa-context-pill[data-level="healthy"] {
      border-color: #6ba9ff40;
      color: #8ab4f8;
    }
    .agpa-context-pill[data-level="moderate"] {
      border-color: #41c87840;
      color: #6ee7b7;
    }
    .agpa-context-pill[data-level="elevated"] {
      border-color: #ffd64770;
      color: #fde047;
      background: #ffd64715;
    }
    .agpa-context-pill[data-level="saturated"] {
      border-color: #ff666a;
      color: #fca5a5;
      background: #ff666a25;
      font-weight: 600;
      animation: agpa-pulse 2s infinite ease-in-out;
    }
    @keyframes agpa-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,102,106,0.4); }
      50% { box-shadow: 0 0 0 4px rgba(255,102,106,0); }
    }
    .agpa-context-popup {
      position: fixed;
      z-index: 2147483640;
      width: 240px;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid var(--border, #444);
      border-radius: 14px;
      background: var(--card, #252525);
      color: var(--foreground, #eee);
      font: 12px/1.4 system-ui, sans-serif;
      box-shadow: 0 10px 30px #0006;
    }
    .agpa-context-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .agpa-context-close {
      border: 0;
      background: transparent;
      color: var(--secondary-foreground, #aaa);
      font: 16px/1 system-ui;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .agpa-context-close:hover {
      color: var(--foreground, #eee);
    }
    .agpa-context-desc {
      margin: 0 0 8px;
      font-size: 11px;
      color: var(--muted-foreground, #aaa);
    }
    .agpa-context-status {
      font-size: 11px;
      margin-bottom: 8px;
      padding: 6px 8px;
      border-radius: 8px;
      background: var(--secondary, #303030);
    }
    .agpa-context-status[data-level="saturated"] {
      background: #ff666a20;
      color: #fca5a5;
      border: 1px solid #ff666a40;
    }
    .agpa-context-status[data-level="elevated"] {
      background: #ffd64720;
      color: #fde047;
      border: 1px solid #ffd64740;
    }
    .agpa-context-compact-btn {
      width: 100%;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 8px;
      background: #a464f6;
      color: #fff;
      font: 500 12px system-ui;
      cursor: pointer;
      transition: filter 150ms ease;
    }
    .agpa-context-compact-btn:hover {
      filter: brightness(1.15);
    }
  `;
  document.head.append(style);

  const observer = new MutationObserver(records => {
    let relevant = false;
    for (const r of records) {
      const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!target) continue;
      if (target.closest('[data-agpa-context-ui], [data-agpa-context-budget], .agpa-context-popup')) continue;
      relevant = true;
      break;
    }
    if (relevant) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const onPointerDown = e => {
    if (popup && !popup.contains(e.target) && !e.target.closest('[data-agpa-context-budget]')) {
      closePopup();
    }
  };
  document.addEventListener('pointerdown', onPointerDown, true);

  const unsubscribe = i18n?.subscribe ? i18n.subscribe(() => schedule(true)) : () => {};

  globalThis.__AGContextBudget = {
    version: VERSION,
    status: () => ({ stats: activeStats, open: !!popup }),
    refresh: () => apply(),
    destroy() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      closePopup();
      observer.disconnect();
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerDown, true);
      style.remove();
      document.querySelectorAll('[data-agpa-context-budget], [data-agpa-context-ui]').forEach(n => n.remove());
      delete globalThis.__AGContextBudget;
    }
  };

  schedule(true);
})();
