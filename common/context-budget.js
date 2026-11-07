/* Visual Context Budget indicator and /compact recommendation. */
(() => {
  'use strict';
  const VERSION = '1.2.0';
  if (globalThis.__AGContextBudget?.version === VERSION) return;
  globalThis.__AGContextBudget?.destroy();

  const rules = globalThis.__AGPA_CONTEXT_BUDGET__ || (typeof require !== 'undefined' ? require('./context-budget.cjs') : null);
  const i18n = globalThis.__AGPAI18n;
  const t = (key, values) => {
    if (i18n && typeof i18n.t === 'function') return i18n.t(key, values);
    if (!values) return key;
    let res = key;
    for (const [k, v] of Object.entries(values)) {
      res = res.split('{' + k + '}').join(v);
    }
    return res;
  };

  let stopped = false, timer = null;
  let activeStats = null, popup = null, popupButton = null;

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
    popupButton?.setAttribute('aria-expanded', 'false');
    popupButton = null;
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

  function isPending(stats) {
    return stats.turns === 0 && stats.chars < 100 && !(stats.apiTokens > 0);
  }

  function placePopup(button) {
    if (popup.parentElement !== document.body) document.body.append(popup);
    const rect = button.getBoundingClientRect();
    const width = popup.getBoundingClientRect().width;
    const height = Math.min(popup.offsetHeight, window.innerHeight - 16);
    popup.style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + 'px';
    const above = rect.top - height - 8;
    popup.style.top = Math.max(8, above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 8)) + 'px';
  }

  function openDetails(button, stats) {
    closePopup();
    if (stopped) return;
    popupButton = button;
    button.setAttribute('aria-expanded', 'true');
    popup = element('div', {
      class: 'agpa-context-popup', role: 'dialog',
      'aria-label': t('Context window'), 'data-level': stats.budget.level
    });
    popup.style.setProperty('--context-color', stats.budget.level === 'saturated' ? '#f08080' : stats.budget.level === 'elevated' ? '#e8b75b' : '#a78bfa');
    const header = element('div', { class: 'agpa-context-header' });
    header.append(element('strong', { class: 'agpa-context-title', text: t('Context window') }));
    const closeBtn = element('button', {
      type: 'button', class: 'agpa-context-close', 'aria-label': t('Close'), text: '×'
    });
    closeBtn.addEventListener('click', closePopup);
    popup.append(header);
    if (isPending(stats)) {
      header.append(closeBtn);
      popup.append(element('p', {
        class: 'agpa-context-desc', text: t('Context estimates appear after the conversation starts.')
      }));
      placePopup(button);
      return;
    }

    const totals = rules.contextWindowBreakdown(stats);
    const format = value => {
      if (value === null) return t('Unavailable');
      if (value < 1000) return String(Math.round(value));
      const unit = value >= 1000000 ? 1000000 : 1000;
      return '~' + Number((value / unit).toFixed(1)) + (unit === 1000 ? 'k' : 'M');
    };
    const percent = totals.percentage === null ? '—' : Math.round(totals.percentage) + '%';
    header.append(closeBtn);
    const hero = element('div', {class:'agpa-context-hero'});
    const donut = element('div', {class:'agpa-context-donut', 'aria-hidden':'true'});
    donut.style.setProperty('--context-percent', (totals.percentage || 0) + '%');
    donut.append(element('strong', {class:'agpa-context-percent', text:percent}));
    const headline = element('div', {class:'agpa-context-headline'});
    headline.append(element('div', {class:'agpa-context-full', text:t('{percent} full', {percent})}), element('div', {
      class:'agpa-context-used',
      text:t('{used} of {capacity} tokens used', {used:format(totals.used),capacity:format(totals.capacity)})
    }));
    hero.append(donut,headline);popup.append(hero);

    const meter = element('div', {
      class: 'agpa-context-meter', role: 'progressbar',
      'aria-label': t('Context window'), 'aria-valuemin': '0', 'aria-valuemax': '100'
    });
    if (totals.percentage !== null) meter.setAttribute('aria-valuenow', String(Math.round(totals.percentage)));
    meter.setAttribute('aria-valuetext', percent);
    const instructionsSegment = element('span', {class:'agpa-context-meter-instructions'});
    const conversationSegment = element('span', {class:'agpa-context-meter-used'});
    const instructionsPercent = totals.capacity ? Math.min(totals.percentage || 0, (totals.instructions || 0) / totals.capacity * 100) : 0;
    instructionsSegment.style.width = instructionsPercent + '%';
    conversationSegment.style.width = Math.max(0, (totals.percentage || 0) - instructionsPercent) + '%';
    meter.append(instructionsSegment,conversationSegment);
    popup.append(meter);

    function row(label, value, icon, className = '') {
      const item = element('div', { class: 'agpa-context-row ' + className });
      item.append(element('span', { class: 'agpa-context-row-icon', text: icon, 'aria-hidden': 'true' }),
        element('span', { class: 'agpa-context-row-label', text: label }),
        element('span', { class: 'agpa-context-row-value', text: value }));
      return item;
    }
    popup.append(row(t('Instructions and tools'), format(totals.instructions), '⚙︎', 'agpa-context-instructions'),
      row(t('Conversation'), format(totals.conversation), '☷', 'agpa-context-conversation'),
      row(t('Free'), format(totals.free), '○', 'agpa-context-free'));
    popup.append(element('p', {
      class: 'agpa-context-desc agpa-context-estimate',
      text: t('Estimated from available data; the actual context may differ.')
    }));
    popup.append(element('p', {
      class: 'agpa-context-desc', text: t('Older turns can be summarized to make room as the window fills.')
    }));

    const details = element('details', { class: 'agpa-context-details' });
    details.addEventListener('toggle', () => {
      if (popup && details.isConnected) placePopup(button);
    });
    details.append(element('summary', { text: t('Usage details') }));
    if (stats.modelName) details.append(element('div', { class: 'agpa-context-model-note', text: stats.modelName }));
    const breakdown = element('div', { class: 'agpa-context-breakdown' });
    const tokenRow = (label, value, icon) => row(t(label) + ':', format(value) + ' tok', icon);
    if (stats.cacheReadTokens > 0 || stats.inputTokens > 0 || stats.outputTokens > 0) {
      breakdown.append(tokenRow('Cached', stats.cacheReadTokens || 0, '⚡'),
        tokenRow('Active prompt', stats.inputTokens || 0, '↳'),
        tokenRow('Output', stats.outputTokens || 0, '↗'));
    }
    if (stats.imageCount > 0) breakdown.append(tokenRow('Vision', stats.imageTokens || 0, '▧'));
    if (stats.docCount > 0) breakdown.append(tokenRow('Documents', stats.docTokens || 0, '▤'));
    const baseline = stats.systemBaseline?.tokens > 0 && Math.abs(stats.systemBaseline.tokens - totals.instructions) < 1 ? stats.systemBaseline : null;
    // A local baseline is an estimate, never a measured server-side system prompt.
    for (const [key, field, symbol] of [['System prompt','baseTokens','⚙︎'],['Tools','toolTokens','⌘'],['Rules','ruleTokens','▤']]) {
      breakdown.append(row(t(key)+':', format(baseline && totals.instructions !== null ? Math.min(totals.instructions, baseline[field] || 0) : null), symbol));
    }
    details.append(breakdown);
    popup.append(details);
    if (stats.budget.level === 'elevated' || stats.budget.level === 'saturated') {
      const action = element('button', {
        type: 'button', class: 'agpa-context-compact-btn', text: t('Insert /compact')
      });
      action.addEventListener('click', () => insertCompact(button));
      popup.append(action);
    }
    placePopup(button);
  }

  function createPill() {
    const pill = element('button', {
      type: 'button',
      class: 'agpa-context-pill',
      'data-agpa-context-budget': '',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false'
    });
    pill.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (popup) closePopup();
      else openDetails(pill, activeStats || rules.extractConversationStats(document));
    });
    pill.append(element('span', {class:'agpa-context-ring', 'aria-hidden':'true'}));
    return pill;
  }

  function updatePill(pill, stats) {
    if (isPending(stats)) {
      const label = t('Context window');
      pill.setAttribute('data-level', 'pending');
      pill.style.setProperty('--agpa-context-fill','0%');
      pill.setAttribute('title', t('Context estimates appear after the conversation starts.'));
      pill.setAttribute('aria-label', label);
      return;
    }
    if (pill.getAttribute('data-level') !== stats.budget.level) {
      pill.setAttribute('data-level', stats.budget.level);
    }
    pill.style.setProperty('--budget-color', stats.budget.color);

    const tokenLabel = `${stats.formatted} tok`;
    pill.style.setProperty('--agpa-context-fill', Math.max(0, Math.min(100, stats.budget.percentage)) + '%');
    const ceilingFormatted = rules.formatTokens ? rules.formatTokens(stats.ceiling || 200000) : '~200k';
    const titleText = stats.modelName
      ? (t('Context: {tokens}', { tokens: tokenLabel }) + ' / ' + ceilingFormatted + ' (' + stats.budget.percentage + '%) · ' + stats.modelName)
      : (t('Context: {tokens}', { tokens: tokenLabel }) + ' / ' + ceilingFormatted + ' (' + stats.budget.percentage + '%)');
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

    const convKey = rules.getConversationKey ? rules.getConversationKey(document) : 'default';
    if (convKey && convKey !== 'default') {
      const stored = rules.loadConversationState ? rules.loadConversationState(convKey) : null;
      const navTurns = rules.countTurns ? rules.countTurns(document) : 0;
      const mtimePending = Boolean(stored?.mtime && stored?.updatedAt && stored.mtime > stored.updatedAt);
      if (!stored || !stored.apiTokens || (navTurns > 0 && navTurns > (stored.maxTurns || 0)) || mtimePending) {
        if (typeof globalThis.__agpaTranscriptRequest === 'function') {
          globalThis.__agpaTranscriptRequest(JSON.stringify({ convKey }));
        }
      }
    }

    // Native controls own their values, popup, and events. Our global estimate
    // is only a fallback while the official feature is unavailable in the rollout.
    const nativeContext = document.querySelector('[data-testid=context-usage-indicator]');
    if (nativeContext) {
      closePopup();
      document.querySelectorAll('[data-agpa-context-budget]').forEach(node => node.remove());
      const footer = nativeContext.closest('[data-agpa-composer-footer], .agy-composer-footer');
      footer?.querySelector('[data-testid=model-selector-trigger]')?.setAttribute('data-agpa-context-adjacent','');
      return;
    }

    if (isPending(stats)) {
      closePopup();
      document.querySelectorAll('[data-agpa-context-budget]').forEach(node => node.remove());
      document.querySelectorAll('[data-agpa-context-adjacent]').forEach(node => node.removeAttribute('data-agpa-context-adjacent'));
      return;
    }

    const triggers = document.querySelectorAll('[data-testid=model-selector-trigger]');
    if (!triggers.length) {
      const footers = document.querySelectorAll(
        '[data-agpa-composer-footer], [class*="input-footer"], [class*="composer-actions"], [class*="surface-composer"], [data-testid*="remote-control"]'
      );
      for (const footer of footers) {
        let pill = footer.querySelector('[data-agpa-context-budget]');
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

      if (!pill) pill = createPill();
      if (pill.nextElementSibling !== trigger) parent.insertBefore(pill,trigger);
      trigger.setAttribute('data-agpa-context-adjacent','');

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
      order:19;width:26px;height:28px;display:inline-flex;align-items:center;justify-content:center;
      flex-shrink:0;padding:0;margin-inline-start:auto;margin-inline-end:2px;border:0;border-radius:50%;
      background:transparent;color:var(--muted-foreground,#aaa);cursor:pointer;
    }
    .agpa-context-ring {display:block;width:14px;height:14px;border-radius:50%;
      background:conic-gradient(currentColor var(--agpa-context-fill,0%),color-mix(in srgb,currentColor 25%,transparent) 0);
      mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 0)}
    .agpa-context-pill:hover {background:var(--secondary,#303030);color:var(--foreground,#eee)}
    .agpa-context-pill:focus-visible {outline:2px solid #6ba9ff;outline-offset:2px}
    .agpa-context-pill[data-level="elevated"] {color:#ffd647}
    .agpa-context-pill[data-level="saturated"] {color:#f08080}
    [data-testid=context-usage-indicator] {order:19;margin-inline-start:auto}
    [data-agpa-context-adjacent] {margin-inline-start:0!important}
    .agpa-context-popup {
      position: fixed;
      z-index: 2147483640;
      width: min(340px, calc(100vw - 16px));
      max-height: calc(100vh - 16px);
      overflow: auto;
      box-sizing: border-box;
      padding: 16px;
      border: 1px solid var(--border, #333);
      border-radius: 14px;
      background: var(--card, #1b1b1e);
      color: var(--foreground, #eee);
      font: 12px/1.5 system-ui, sans-serif;
      box-shadow: 0 8px 28px #0006;
      font-variant-numeric: tabular-nums;
    }
    .agpa-context-header {display:flex;align-items:center;gap:8px;margin-bottom:9px}
    .agpa-context-title {text-transform:uppercase;letter-spacing:.055em;font-size:10px;font-weight:600;color:var(--muted-foreground,#999);margin-right:auto}
    .agpa-context-percent {font-size:13px;font-weight:600;color:var(--foreground,#eee);position:relative}
    .agpa-context-hero {display:flex;align-items:center;gap:14px;margin:10px 0 16px}
    .agpa-context-donut {width:56px;height:56px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;position:relative;isolation:isolate}
    .agpa-context-donut::before {content:'';position:absolute;inset:0;border-radius:inherit;background:conic-gradient(var(--context-color,#a78bfa) var(--context-percent,0%),var(--secondary,#303034) 0);mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#000 0)}
    .agpa-context-headline {min-width:0}
    .agpa-context-full {font-size:13px;font-weight:600;color:var(--context-color,#a78bfa);margin-bottom:3px}
    .agpa-context-close {border:0;background:transparent;color:var(--muted-foreground,#999);font:16px/1 system-ui;cursor:pointer;padding:1px 3px;border-radius:4px}
    .agpa-context-close:hover {color:var(--foreground,#eee)}
    .agpa-context-close:focus-visible,.agpa-context-details summary:focus-visible {outline:2px solid #6ba9ff;outline-offset:3px}
    .agpa-context-used {font-size:12px;font-weight:500;color:var(--secondary-foreground,#bbb)}
    .agpa-context-meter {display:flex;height:6px;border-radius:4px;overflow:hidden;background:var(--secondary,#2d2d31);margin-bottom:12px}
    .agpa-context-meter-used {display:block;height:100%;border-radius:inherit;background:#a78bfa}
    .agpa-context-meter-instructions {display:block;height:100%;background:#6ba9ff}
    .agpa-context-popup[data-level="elevated"] .agpa-context-meter-used {background:#ffd647}
    .agpa-context-popup[data-level="saturated"] .agpa-context-meter-used {background:#f08080}
    .agpa-context-row {display:flex;align-items:center;gap:8px;min-height:25px;font-size:12px}
    .agpa-context-row-icon {width:15px;flex-shrink:0;text-align:center;color:var(--muted-foreground,#999);font-size:13px}
    .agpa-context-row-label {flex:1;min-width:0}
    .agpa-context-row-value {text-align:right;white-space:nowrap;font-weight:500}
    .agpa-context-instructions .agpa-context-row-icon {color:#6ba9ff}
    .agpa-context-conversation .agpa-context-row-icon {color:#a78bfa}
    .agpa-context-free {color:var(--muted-foreground,#999)}
    .agpa-context-desc {margin:8px 0 0;font-size:11px;line-height:1.5;color:var(--muted-foreground,#999)}
    .agpa-context-estimate {margin-top:12px}
    .agpa-context-details {border-top:1px solid var(--border,#333);margin-top:12px;padding-top:9px}
    .agpa-context-details summary {cursor:pointer;color:var(--muted-foreground,#aaa);font-size:11px}
    .agpa-context-model-note {font-size:11px;color:var(--muted-foreground,#aaa);margin-top:9px}
    .agpa-context-breakdown {margin-top:6px}
    .agpa-context-breakdown .agpa-context-row {font-size:11px;min-height:23px}
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
  const onKeyDown = e => {
    if (e.key === 'Escape' && popup) {
      const button = popupButton;
      closePopup();
      button?.focus({ preventScroll: true });
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  const onStorage = e => {
    if (e && e.key && e.key.startsWith('agpa_context_budget_')) schedule();
  };
  window.addEventListener?.('storage', onStorage);

  const unsubscribe = i18n?.subscribe ? i18n.subscribe(() => schedule(true)) : () => {};

  globalThis.__AGContextBudget = {
    version: VERSION,
    status: () => ({ stats: activeStats, open: !!popup }),
    getActiveKey: () => (rules.getConversationKey ? rules.getConversationKey(document) : 'default'),
    needsTranscript: (key, optionsOrMtime) => {
      const k = (typeof key === 'string' ? key : key?.convKey) || (rules.getConversationKey ? rules.getConversationKey(document) : 'default');
      if (!k || k === 'default') return false;
      const store = typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
      const stored = rules.loadConversationState ? rules.loadConversationState(k, store) : null;
      if (!stored || !stored.maxChars || !stored.apiTokens) return true;
      const navTurns = rules.countTurns ? rules.countTurns(document) : 0;
      if (navTurns > 0 && navTurns > (stored.maxTurns || stored.blocks?.length || 0)) return true;
      const fileMtime = typeof optionsOrMtime === 'number' ? optionsOrMtime : (optionsOrMtime?.mtime || stored.mtime);
      if (fileMtime && stored.updatedAt && fileMtime > stored.updatedAt) return true;
      if (stored.mtime && stored.updatedAt && stored.mtime > stored.updatedAt) return true;
      return false;
    },
    hydrateFromTranscript: (convKey, data) => {
      if (rules.hydrateFromTranscript) {
        rules.hydrateFromTranscript(convKey, data);
        apply();
      }
    },
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
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener?.('storage', onStorage);
      style.remove();
      document.querySelectorAll('[data-agpa-context-adjacent]').forEach(node=>node.removeAttribute('data-agpa-context-adjacent'));
      document.querySelectorAll('[data-agpa-context-budget], [data-agpa-context-ui], .agpa-turn-token-badge, .agpa-turn-tooltip').forEach(n => n.remove());
      delete globalThis.__AGContextBudget;
    }
  };

  schedule(true);
})();
