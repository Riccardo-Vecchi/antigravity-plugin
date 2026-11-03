/* Visual Context Budget indicator and /compact recommendation. */
(() => {
  'use strict';
  const VERSION = '1.0.28';
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

  let activeTurnTooltip = null;

  function closeTurnTooltip() {
    if (activeTurnTooltip) {
      activeTurnTooltip.remove();
      activeTurnTooltip = null;
    }
  }

  function formatFootprint(tokens) {
    if (!tokens || tokens <= 0) return '~0 tok';
    if (tokens >= 1000) {
      const k = tokens / 1000;
      return '~' + (k >= 10 ? Math.round(k) : k.toFixed(1)) + 'k tok';
    }
    return '~' + tokens + ' tok';
  }

  function formatNum(n) {
    if (!n) return '0';
    if (n >= 1000) {
      const k = n / 1000;
      return (k >= 10 ? Math.round(k) : k.toFixed(1)) + 'k';
    }
    return String(n);
  }

  function showTurnTooltip(badge, initialData) {
    closeTurnTooltip();
    if (stopped) return;

    const turnData = badge?._turnData || initialData;
    if (!turnData) return;

    const tip = element('div', { class: 'agpa-turn-tooltip', role: 'tooltip' });
    const footprintVal = turnData.footprint || turnData.deltaTokens || 0;
    const footprintStr = formatFootprint(footprintVal);

    const titleRow = element('div', { class: 'agpa-turn-tooltip-title' });
    titleRow.innerHTML = `<span>${t('Turn #{index}', { index: turnData.turnIndex })}</span><span class="agpa-turn-impact">${footprintStr}</span>`;
    tip.append(titleRow);

    const body = element('div', { class: 'agpa-turn-tooltip-body' });
    const addRow = (label, val, className = '') => {
      const r = element('div', { class: 'agpa-turn-tooltip-row' + (className ? ' ' + className : '') });
      r.innerHTML = `<span>${label}</span><span>${val}</span>`;
      body.append(r);
    };

    if (turnData.hasCompaction) {
      const cRow = element('div', { class: 'agpa-turn-tooltip-row agpa-turn-compact-row' });
      const preTok = turnData.preCompactionTokens || turnData.peakTokens || 0;
      const postTok = turnData.postCompactionTokens || 0;
      let compactDetail = t('Condensed history');
      if (preTok > 0 && postTok > 0) {
        compactDetail = `~${formatNum(preTok)} ➔ ~${formatNum(postTok)}`;
      } else if (preTok > 0) {
        compactDetail = t('peak ~{tokens}', { tokens: formatNum(preTok) });
      }
      cRow.innerHTML = `<span style="color:#f87171; font-weight:600">🗜 ${t('Compacting')}</span><span style="color:#fca5a5; font-weight:500">${compactDetail}</span>`;
      body.append(cRow);

      if (preTok > 0) {
        const peakRow = element('div', { class: 'agpa-turn-tooltip-row agpa-turn-peak-row' });
        peakRow.innerHTML = `<span style="color:#fca5a5">🔺 ${t('Pre-compaction peak')}</span><span style="color:#fca5a5; font-weight:600">~${formatNum(preTok)} tok</span>`;
        body.append(peakRow);
      }
    }

    const outTokens = turnData.finalOutputTokens || turnData.outputTokens || 0;
    addRow('📤 ' + t('Response output'), `${formatNum(outTokens)} tok`);
    addRow('📥 ' + t('Active prompt'), `${formatNum(turnData.inputTokens)} tok`);

    if (turnData.cacheReadTokens > 0) {
      addRow('⚡ ' + t('Cached'), `${formatNum(turnData.cacheReadTokens)} tok`);
    } else {
      addRow('⚡ ' + t('Cached'), t('0 tok (miss / recalculation)'));
    }

    if (turnData.toolCallsCount > 0) {
      addRow('🛠 ' + t('Tool calls'), `${turnData.toolCallsCount} ${turnData.toolCallsCount === 1 ? 'call' : 'calls'}`);
    }
    if (turnData.imageTokens > 0) {
      addRow('🖼 ' + t('Vision'), `${formatNum(turnData.imageTokens)} tok`);
    }

    const div = element('div', { class: 'agpa-turn-tooltip-divider' });
    body.append(div);

    const realDelta = typeof turnData.realDelta === 'number' ? turnData.realDelta : turnData.deltaTokens;
    if (realDelta < 0) {
      addRow('📉 ' + t('Net delta'), `-${formatNum(Math.abs(realDelta))} tok (${t('optimized')})`, 'agpa-turn-delta-neg');
    } else if (realDelta > 0) {
      addRow('📈 ' + t('Net delta'), `+${formatNum(realDelta)} tok`, 'agpa-turn-delta-pos');
    } else {
      addRow('± ' + t('Net delta'), '0 tok');
    }

    if (turnData.totalTokens > 0) {
      const totRow = element('div', { class: 'agpa-turn-tooltip-row agpa-turn-total' });
      totRow.innerHTML = `<span>📊 ${t('Total window')}</span><span>~${formatNum(turnData.totalTokens)} tok</span>`;
      body.append(totRow);
    }

    tip.append(body);
    document.body.append(tip);
    activeTurnTooltip = tip;

    const rect = badge.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(rect.left - 40, window.innerWidth - 240)) + 'px';
    tip.style.top = Math.max(8, rect.top - tip.offsetHeight - 6) + 'px';
    if (rect.top < tip.offsetHeight + 12) {
      tip.style.top = Math.min(rect.bottom + 6, window.innerHeight - tip.offsetHeight - 8) + 'px';
    }
  }

  function hasClass(node, cls) {
    if (node?.classList && typeof node.classList.contains === 'function') return node.classList.contains(cls);
    return (node?.className || '').split(' ').includes(cls);
  }

  function removeClass(node, cls) {
    if (node?.classList && typeof node.classList.remove === 'function') {
      node.classList.remove(cls);
    } else if (node) {
      node.className = (node.className || '').split(' ').filter(c => c && c !== cls).join(' ');
    }
  }


  function updateTurnBadges(doc = document, stats) {
    const vp = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]');
    if (!vp) return;
    const list = vp.querySelector?.('.relative.flex.flex-col.gap-y-3') || vp.querySelector?.('.flex.flex-col');
    if (!list) return;

    const allContainers = Array.from(list.querySelectorAll(':scope > div.flex.items-start'));
    if (!allContainers.length) return;

    const responseContainers = allContainers.filter(c => c.querySelector('button[aria-label="Good response"]'));
    if (!responseContainers.length) return;

    const turnsList = Array.isArray(stats?.turnsList) ? stats.turnsList : [];

    // Pass 1: Direct matches by promptKey or responseKey
    const matches = new Array(responseContainers.length).fill(null);
    responseContainers.forEach((container, idx) => {
      const prev = container.previousElementSibling;
      const userStep = container.querySelector('[data-testid="user-input-step"]') ||
                       prev?.querySelector?.('[data-testid="user-input-step"]') ||
                       (prev?.getAttribute?.('data-testid') === 'user-input-step' ? prev : null);

      const rawPrompt = userStep?.textContent?.trim() || '';
      const promptKey = rawPrompt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);

      if (promptKey) {
        const found = turnsList.find(t => t.promptKey && (t.promptKey.startsWith(promptKey.slice(0, 25)) || promptKey.startsWith(t.promptKey.slice(0, 25))));
        if (found) {
          matches[idx] = found;
          return;
        }
      }

      const respText = (container.textContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (respText.length > 20) {
        const found = turnsList.find(t => {
          const rk = t.responseKey || t.finalResponseKey;
          return rk && rk.length > 10 && respText.includes(rk.slice(0, 25));
        });
        if (found) {
          matches[idx] = found;
          return;
        }
      }
    });

    // Pass 2: Iterative neighbor propagation across consecutive response bubbles
    let changed = true;
    while (changed) {
      changed = false;
      // Forward propagation
      for (let i = 0; i < matches.length - 1; i++) {
        if (matches[i] && !matches[i + 1]) {
          const nextIndex = matches[i].turnIndex + 1;
          const found = turnsList.find(t => t.turnIndex === nextIndex);
          if (found) {
            matches[i + 1] = found;
            changed = true;
          }
        }
      }
      // Backward propagation
      for (let i = matches.length - 1; i > 0; i--) {
        if (matches[i] && !matches[i - 1]) {
          const prevIndex = matches[i].turnIndex - 1;
          const found = turnsList.find(t => t.turnIndex === prevIndex);
          if (found) {
            matches[i - 1] = found;
            changed = true;
          }
        }
      }
    }

    // Pass 3: Fallback for unanchored turns if turnsList length matches
    if (matches.every(m => !m) && responseContainers.length <= turnsList.length) {
      responseContainers.forEach((_, idx) => {
        matches[idx] = turnsList[idx];
      });
    }

    // Render badges
    responseContainers.forEach((container, idx) => {
      const goodBtn = container.querySelector('button[aria-label="Good response"]');
      if (!goodBtn) return;
      const bar = goodBtn.parentElement;
      if (!bar) return;
      const copyBtn = bar.querySelector('button[aria-label="Copy"]');

      const turnData = matches[idx];
      let badge = bar.querySelector('.agpa-turn-token-badge');

      if (!turnData) {
        // Response finished but transcript data not yet loaded: show loading pill with micro-spinner
        if (!badge) {
          badge = element('div', {
            class: 'agpa-turn-token-badge agpa-turn-loading',
            'data-agpa-turn-badge': '',
            role: 'status',
            title: t('Calculating turn footprint...')
          });
          const spinner = element('span', { class: 'agpa-turn-spinner' });
          badge.append(spinner);
          if (copyBtn) bar.insertBefore(badge, copyBtn);
          else bar.prepend(badge);
        } else if (hasClass(badge, 'agpa-turn-loading') && (!badge.children || !badge.children.length)) {
          const spinner = element('span', { class: 'agpa-turn-spinner' });
          badge.append(spinner);
        }
        return;
      }

      const footprintVal = turnData.footprint || turnData.deltaTokens || 0;
      const formattedFootprint = formatFootprint(footprintVal);

      if (!badge) {
        badge = element('div', {
          class: 'agpa-turn-token-badge',
          'data-agpa-turn-badge': '',
          'data-turn-index': String(turnData.turnIndex),
          'data-footprint': String(footprintVal),
          role: 'button',
          tabindex: '0'
        });

        if (copyBtn) bar.insertBefore(badge, copyBtn);
        else bar.prepend(badge);
      } else if (hasClass(badge, 'agpa-turn-loading')) {
        removeClass(badge, 'agpa-turn-loading');
        badge.innerHTML = '';
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
      }

      if (!badge._listenersAttached) {
        badge.addEventListener('mouseenter', () => showTurnTooltip(badge, badge._turnData || turnData));
        badge.addEventListener('mouseleave', closeTurnTooltip);
        badge._listenersAttached = true;
      }

      badge._turnData = turnData;

      if (badge.textContent !== formattedFootprint) badge.textContent = formattedFootprint;
      if (badge.getAttribute('data-turn-index') !== String(turnData.turnIndex)) {
        badge.setAttribute('data-turn-index', String(turnData.turnIndex));
      }
      if (badge.getAttribute('data-footprint') !== String(footprintVal)) {
        badge.setAttribute('data-footprint', String(footprintVal));
      }

      if (badge.classList && badge.classList.toggle) {
        badge.classList.toggle('agpa-turn-compacted', !!turnData.hasCompaction);
      } else {
        const cls = (badge.className || '').split(' ').filter(c => c && c !== 'agpa-turn-compacted');
        if (turnData.hasCompaction) cls.push('agpa-turn-compacted');
        badge.className = cls.join(' ');
      }
      if (turnData.hasCompaction) {
        badge.setAttribute('data-compacted', 'true');
      } else if (badge.removeAttribute) {
        badge.removeAttribute('data-compacted');
      }

      const realDelta = typeof turnData.realDelta === 'number' ? turnData.realDelta : turnData.deltaTokens;
      const deltaSign = realDelta > 0 ? `+${formatNum(realDelta)}` : (realDelta < 0 ? `-${formatNum(Math.abs(realDelta))} (${t('optimized')})` : '0');
      const pre = turnData.preCompactionTokens || turnData.peakTokens;
      const post = turnData.postCompactionTokens;
      const compStr = turnData.hasCompaction
        ? (pre && post ? ` (${t('Compacting')}: ~${formatNum(pre)} ➔ ~${formatNum(post)})` : ` (${t('Compacting')}: ${t('peak ~{tokens}', { tokens: formatNum(pre || 0) })})`)
        : '';
      const tipLines = [
        `${t('Turn #{index}', { index: turnData.turnIndex })} · ${t('{tokens} turn footprint', { tokens: formattedFootprint })}${compStr}`,
        `• ${t('Response output')}: ${formatNum(turnData.finalOutputTokens || turnData.outputTokens)} tok`,
        `• ${t('Active prompt')}: ${formatNum(turnData.inputTokens)} tok`,
        turnData.cacheReadTokens > 0 ? `• ${t('Cached')}: ${formatNum(turnData.cacheReadTokens)} tok` : `• ${t('Cached')}: ${t('0 tok (miss / recalculation)')}`,
        `• ${t('Net delta')}: ${deltaSign} tok`
      ];
      if (turnData.toolCallsCount > 0) tipLines.push(`• ${t('Tool calls')}: ${turnData.toolCallsCount}`);
      if (turnData.imageTokens > 0) tipLines.push(`• ${t('Vision')}: ${formatNum(turnData.imageTokens)} tok`);
      if (turnData.totalTokens > 0) tipLines.push(`• ${t('Total window')}: ~${formatNum(turnData.totalTokens)} tok`);
      badge.title = tipLines.join('\n');
    });
  }

    function closePopup() {
    closeTurnTooltip();
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
    document.body.append(popup);
    const rect = button.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.right - 220, window.innerWidth - 230)) + 'px';
    popup.style.top = Math.max(8, rect.top - popup.offsetHeight - 8) + 'px';
    if (rect.top < popup.offsetHeight + 16) {
      popup.style.top = Math.min(rect.bottom + 8, window.innerHeight - popup.offsetHeight - 8) + 'px';
    }
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
    if (isPending(stats)) {
      title.textContent = t('Context window');
      popup.setAttribute('aria-label', t('Context window'));
      popup.append(header, element('p', {
        class: 'agpa-context-desc',
        text: t('Context estimates appear after the conversation starts.')
      }));
      placePopup(button);
      return;
    }


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

    const ceilingFmt = rules.formatTokens ? rules.formatTokens(stats.ceiling || 200000) : '~200k';
    const modelNote = element('div', {
      class: 'agpa-context-model-note',
      text: stats.modelName
        ? `${stats.modelName} · ${stats.budget.percentage}% (${ceilingFmt} max)`
        : `${stats.budget.percentage}% (${ceilingFmt} max)`
    });

    const parts = [];
    if (stats.imageCount > 0) {
      parts.push(`${stats.imageCount} ${stats.imageCount === 1 ? 'image' : 'images'} (~${rules.formatTokens ? rules.formatTokens(stats.imageTokens) : stats.imageTokens})`);
    }
    if (stats.docCount > 0) {
      parts.push(`${stats.docCount} ${stats.docCount === 1 ? 'doc' : 'docs'} (~${rules.formatTokens ? rules.formatTokens(stats.docTokens) : stats.docTokens})`);
    }

    popup.append(header, desc, modelNote);

    if (stats.cacheReadTokens > 0 || stats.inputTokens > 0 || stats.outputTokens > 0) {
      const cacheFmt = rules.formatTokens ? rules.formatTokens(stats.cacheReadTokens) : String(stats.cacheReadTokens || 0);
      const inputFmt = rules.formatTokens ? rules.formatTokens(stats.inputTokens) : String(stats.inputTokens || 0);
      const outFmt = rules.formatTokens ? rules.formatTokens(stats.outputTokens) : String(stats.outputTokens || 0);
      const breakdown = element('div', {
        class: 'agpa-context-breakdown',
        text: `⚡ Cached: ${cacheFmt} · Active prompt: ${inputFmt} · Output: ${outFmt}`
      });
      popup.append(breakdown);
    }

    if (stats.systemTokens > 0) {
      const sysFmt = rules.formatTokens ? rules.formatTokens(stats.systemTokens) : `${stats.systemTokens}`;
      const sysDetails = [];
      if (stats.systemBaseline?.toolsCount > 0) {
        sysDetails.push(`${stats.systemBaseline.toolsCount} ${stats.systemBaseline.toolsCount === 1 ? 'tool' : 'tools'}`);
      } else if (stats.systemBaseline?.mcpCount > 0) {
        sysDetails.push(`${stats.systemBaseline.mcpCount} MCP`);
      }
      if (stats.systemBaseline?.rulesCount > 0) {
        sysDetails.push(`${stats.systemBaseline.rulesCount} ${stats.systemBaseline.rulesCount === 1 ? 'rule' : 'rules'}`);
      }
      const label = sysDetails.length > 0 ? `⚙️ System & tools: ${sysFmt} (${sysDetails.join(', ')})` : `⚙️ System overhead: ${sysFmt}`;
      const sysNode = element('div', {
        class: 'agpa-context-system-note',
        text: label
      });
      popup.append(sysNode);
    }

    if (parts.length > 0) {
      const attachmentsNote = element('div', {
        class: 'agpa-context-attachments-note',
        text: `📎 ${parts.join(' · ')}`
      });
      popup.append(attachmentsNote);
    }
    popup.append(statusNote);

    if (stats.budget.level === 'elevated' || stats.budget.level === 'saturated') {
      const action = element('button', {
        type: 'button',
        class: 'agpa-context-compact-btn',
        text: t('Insert /compact')
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
    if (isPending(stats)) {
      const label = t('Context window');
      pill.setAttribute('data-level', 'pending');
      pill.textContent = '— tok';
      pill.setAttribute('title', t('Context estimates appear after the conversation starts.'));
      pill.setAttribute('aria-label', label);
      return;
    }
    if (pill.getAttribute('data-level') !== stats.budget.level) {
      pill.setAttribute('data-level', stats.budget.level);
    }
    pill.style.setProperty('--budget-color', stats.budget.color);

    const tokenLabel = stats.formatted.endsWith('k') ? `${stats.formatted} tok` : `${stats.formatted} tok`;
    const labelText = stats.budget.level === 'saturated' ? `⚠️ ${tokenLabel} · /compact` : tokenLabel;

    if (pill.textContent !== labelText) pill.textContent = labelText;
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

  const hydratedKeys = new Set();
  let hydrating = false;
  let hydrateTimer = null;

  function tryAutoHydrate(doc = document) {
    if (stopped || hydrating) return;
    const convKey = rules.getConversationKey ? rules.getConversationKey(doc) : 'default';
    if (!convKey || convKey === 'default' || hydratedKeys.has(convKey)) return;

    const active = doc.activeElement;
    const isInput = active && (active.getAttribute?.('contenteditable') === 'true' || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
    if (isInput) {
      const text = (active.textContent || active.value || '').trim();
      if (text.length > 0) return;
    }

    const viewport = doc.querySelector?.('[data-testid=autoscroll-viewport]');
    if (!viewport) return;

    const originalTop = viewport.scrollTop;
    if (originalTop <= 50 || viewport.scrollHeight <= viewport.clientHeight * 1.15) {
      hydratedKeys.add(convKey);
      return;
    }

    hydratedKeys.add(convKey);
    hydrating = true;

    const clientHeight = viewport.clientHeight || 800;
    const scrollStep = Math.max(400, Math.round(clientHeight * 0.75));
    let currentTop = originalTop;

    const cleanup = () => {
      window.removeEventListener?.('keydown', onUserCancel, true);
      window.removeEventListener?.('wheel', onUserCancel, true);
    };

    const onUserCancel = () => {
      if (!hydrating) return;
      if (hydrateTimer) {
        clearInterval(hydrateTimer);
        hydrateTimer = null;
      }
      hydrating = false;
      viewport.scrollTop = originalTop;
      cleanup();
    };

    window.addEventListener?.('keydown', onUserCancel, true);
    window.addEventListener?.('wheel', onUserCancel, true);

    hydrateTimer = setInterval(() => {
      if (stopped) {
        onUserCancel();
        return;
      }
      currentTop = Math.max(0, currentTop - scrollStep);
      viewport.scrollTop = currentTop;

      if (currentTop <= 0) {
        clearInterval(hydrateTimer);
        hydrateTimer = null;
        setTimeout(() => {
          if (!stopped) {
            viewport.scrollTop = originalTop;
            hydrating = false;
            cleanup();
            schedule(true);
          }
        }, 30);
      }
    }, 16);
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
      const missingTurns = Boolean(stored && (!Array.isArray(stored.turnsList) || stored.turnsList.length === 0));
      if (!stored || !stored.apiTokens || missingTurns || (navTurns > 0 && navTurns > (stored.maxTurns || 0)) || mtimePending) {
        if (typeof globalThis.__agpaTranscriptRequest === 'function') {
          globalThis.__agpaTranscriptRequest(JSON.stringify({ convKey }));
        }
      }
    }

    tryAutoHydrate(document);
    updateTurnBadges(document, stats);

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
    .agpa-context-model-note {
      font-size: 11px;
      color: var(--secondary-foreground, #aaa);
      margin: 2px 0 8px 0;
    }
    .agpa-context-breakdown {
      font-size: 11px;
      color: var(--secondary-foreground, #bbb);
      margin: 2px 0 8px 0;
      padding: 4px 6px;
      background: var(--secondary, rgba(255, 255, 255, 0.05));
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
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
    .agpa-turn-token-badge {
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      font-weight: 500;
      padding: 1px 7px;
      margin-right: 6px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.07);
      color: var(--secondary-foreground, rgba(255, 255, 255, 0.75));
      border: 1px solid rgba(255, 255, 255, 0.12);
      cursor: pointer;
      user-select: none;
      line-height: 18px;
      white-space: nowrap;
      transition: all 0.15s ease-in-out;
    }
    .agpa-turn-token-badge:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.25);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    .agpa-turn-token-badge.agpa-turn-loading {
      min-width: 22px;
      justify-content: center;
      padding: 1px 7px;
      cursor: wait;
      opacity: 0.8;
    }
    .agpa-turn-spinner {
      display: inline-block;
      width: 9px;
      height: 9px;
      box-sizing: border-box;
      border: 1.5px solid rgba(255, 255, 255, 0.22);
      border-top-color: #8ab4f8;
      border-radius: 50%;
      animation: agpa-spin 0.75s linear infinite;
    }
    @keyframes agpa-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .agpa-turn-tooltip {
      position: fixed;
      z-index: 2147483645;
      min-width: 190px;
      max-width: 270px;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--border, #444);
      border-radius: 10px;
      background: var(--card, #222);
      color: var(--foreground, #eee);
      font: 11px/1.4 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      animation: agpa-fade-in 0.12s ease-out;
    }
    @keyframes agpa-fade-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .agpa-turn-tooltip-title {
      font-weight: 600;
      font-size: 11px;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
        .agpa-turn-delta-neg {
      color: #8ab4f8 !important;
      font-weight: 500;
    }
    .agpa-turn-delta-pos {
      color: #6ee7b7 !important;
      font-weight: 500;
    }
.agpa-turn-impact {
      color: #6ee7b7;
      font-weight: 600;
    }
    .agpa-turn-token-badge.agpa-turn-compacted {
      background: rgba(239, 68, 68, 0.16) !important;
      color: #fca5a5 !important;
      border-color: rgba(239, 68, 68, 0.38) !important;
    }
    .agpa-turn-token-badge.agpa-turn-compacted:hover {
      background: rgba(239, 68, 68, 0.28) !important;
      color: #fee2e2 !important;
      border-color: rgba(239, 68, 68, 0.6) !important;
      box-shadow: 0 2px 10px rgba(239, 68, 68, 0.25) !important;
    }
        .agpa-turn-peak-row {
      background: rgba(239, 68, 68, 0.08);
      border-radius: 4px;
      padding: 1.5px 6px !important;
      margin-bottom: 3px;
    }
    .agpa-turn-compact-row {
      background: rgba(239, 68, 68, 0.12);
      border-radius: 4px;
      padding: 2px 6px !important;
      margin-bottom: 4px;
    }
    .agpa-turn-tooltip-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      font-size: 11px;
      color: var(--secondary-foreground, #bbb);
      padding: 1.5px 0;
    }
    .agpa-turn-tooltip-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      margin: 4px 0;
    }
    .agpa-turn-total {
      font-weight: 600;
      color: var(--foreground, #eee);
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
    closeTurnTooltip();
    if (popup && !popup.contains(e.target) && !e.target.closest('[data-agpa-context-budget]')) {
      closePopup();
    }
  };
  document.addEventListener('pointerdown', onPointerDown, true);

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
      if (optionsOrMtime?.requireTurns && (!Array.isArray(stored.turnsList) || stored.turnsList.length === 0)) return true;
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
      window.removeEventListener?.('storage', onStorage);
      style.remove();
      document.querySelectorAll('[data-agpa-context-budget], [data-agpa-context-ui], .agpa-turn-token-badge, .agpa-turn-tooltip').forEach(n => n.remove());
      delete globalThis.__AGContextBudget;
    }
  };

  schedule(true);
})();
