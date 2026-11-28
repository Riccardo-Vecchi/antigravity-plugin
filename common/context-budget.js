/* Visual Context Budget indicator and /compact recommendation. */
(() => {
  'use strict';
  const VERSION = '1.3.15';
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

  let stopped = false, timer = null, jumpTimer = null, jumpAbortCleanup = null, compactRetryTimer = null, hasCompactionMarkers = false;
  let lastObservedConvKey = '', lastRequestedResponseCount = 0, lastReqConvKey = '', lastReqAt = 0, lastCompactRetryKey = '';
  let activeStats = null, popup = null, popupButton = null, popupMode = null;
  let hoverTimer = null, hoverCloseTimer = null;

  function cancelJump() {
    if (jumpTimer) {
      clearTimeout(jumpTimer);
      jumpTimer = null;
    }
    if (jumpAbortCleanup) {
      jumpAbortCleanup();
      jumpAbortCleanup = null;
    }
  }

  function cancelCompactRetry() {
    if (compactRetryTimer) {
      clearTimeout(compactRetryTimer);
      compactRetryTimer = null;
    }
  }

  function formatTokenCount(value) {
    if (value === null) return t('Unavailable');
    if (value < 1000) return String(Math.round(value));
    const unit = value >= 1000000 ? 1000000 : 1000;
    return '~' + Number((value / unit).toFixed(1)) + (unit === 1000 ? 'k' : 'M');
  }

  function compactionLabel(c) {
    if (c?.preTokens > 0 && c?.postTokens > 0) {
      return t('Compacted during this response ({pre} → {post})', {
        pre: formatTokenCount(c.preTokens),
        post: formatTokenCount(c.postTokens)
      });
    }
    return t('Compacted during this response');
  }

  function createCompactionIcon() {
    if (typeof document.createElementNS === 'function') {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('width', '13');
      svg.setAttribute('height', '13');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.6');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M2 5h12M2 11h12M8 1.5v3M6 3l2 2 2-2M8 14.5v-3M6 13l2-2 2 2');
      svg.append(path);
      return svg;
    }
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '⊟';
    return span;
  }

  function getViewportRoot(doc = document) {
    return doc.querySelector?.('[data-testid=autoscroll-viewport]') ||
      doc.querySelector?.('[data-testid=conversation-view]') || null;
  }

  function collectResponseBars(vp) {
    if (!vp) return [];
    let buttons = vp.querySelectorAll?.('button[aria-label="Good response"]') || [];
    let fallbackMode = false;
    if (!buttons.length) {
      buttons = vp.querySelectorAll?.('button[aria-label*="good" i], button[title*="Good response" i], button[data-testid*="good-response"], button[data-testid*="thumbs-up"]') || [];
    }
    if (!buttons.length) {
      buttons = vp.querySelectorAll?.('button[aria-label="Copy"], button[title="Copy"], button[aria-label*="copy" i]') || [];
      fallbackMode = true;
    }
    const bars = [];
    const seen = new Set();
    for (const btn of buttons) {
      if (fallbackMode) {
        if (btn.closest?.('pre, code, [data-agpa-context-ui]')) continue;
        const p = btn.parentElement;
        if (!p || (p.querySelectorAll?.('button')?.length || 0) < 2) continue;
      }
      const bar = btn.parentElement;
      if (bar && !seen.has(bar)) {
        seen.add(bar);
        bars.push(bar);
      }
    }
    if (bars.length) return bars;

    // Last-resort structural fallback: small footer bars with 2-4 icon buttons near a relative timestamp (e.g. "1mo ago")
    const allButtons = vp.querySelectorAll?.('button') || [];
    for (const btn of allButtons) {
      if (btn.closest?.('pre, code, [data-agpa-context-ui], [data-testid=user-input-step]')) continue;
      const bar = btn.parentElement;
      if (!bar || seen.has(bar)) continue;
      const rowBtns = bar.querySelectorAll?.(':scope > button') || [];
      if (rowBtns.length >= 2 && rowBtns.length <= 5) {
        const txt = bar.parentElement?.textContent || bar.textContent || '';
        if (/\b(?:\d+\s*(?:s|m|h|d|w|mo|y)\s+ago|just now)\b/i.test(txt)) {
          seen.add(bar);
          bars.push(bar);
        }
      }
    }
    return bars;
  }

  function normalizeMatchText(str) {
    return String(str || '').replace(/<[^>]+>/g, ' ').replace(/[*`#_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  const TURN_ITEM_SELECTOR = '[data-testid=user-input-step], [data-testid=user-message-bubble], [class*="group/user-input"], button[aria-label="Good response"], button[aria-label="Copy"]';

  function collectTurnItems(list) {
    if (!list || !list.children?.length) return [];
    return Array.from(list.children).filter(el =>
      !el.classList?.contains('sr-only') &&
      Boolean(
        el.querySelector?.(TURN_ITEM_SELECTOR) ||
        el.querySelector?.('button[aria-label="Good response"]') ||
        el.querySelector?.('button[aria-label="Copy"]')
      )
    );
  }

  function matchPromptText(domKey, transcriptKey) {
    const d = normalizeMatchText(domKey).replace(/^\/+/, '');
    const t = normalizeMatchText(transcriptKey).replace(/^\/+/, '');
    if (!d || !t) return false;
    if (d === t) return true;
    const dClean = d.replace(/\s*(?:\d+\s*(?:s|m|h|d|w|mo|y)\s+ago|just now)$/i, '').trim();
    if (dClean && dClean === t) return true;
    return d.length >= 25 && t.length >= 25 && d.slice(0, 25) === t.slice(0, 25);
  }

  function findCompactionTargets(stats, doc = document, precollectedBars = null) {
    const compactions = Array.isArray(stats?.compactions) ? stats.compactions : [];
    const targets = new Map();
    if (!compactions.length) return targets;
    const vp = getViewportRoot(doc);
    if (!vp) return targets;
    const bars = Array.isArray(precollectedBars) ? precollectedBars : collectResponseBars(vp);
    if (!bars.length) return targets;

    const totalTurns = Number(stats?.turns) || 0;
    if (totalTurns > 0 && bars.length === totalTurns) {
      for (const c of compactions) {
        if (c.turn >= 1 && c.turn <= bars.length) {
          targets.set(c.turn, bars[c.turn - 1]);
        }
      }
      return targets;
    }

    // Virtualized list path: match via direct turn containers and propagate turn numbers
    const list = vp.querySelector?.('.relative.flex.flex-col.gap-y-3');
    if (list && list.children?.length) {
      const turnItems = collectTurnItems(list);
      if (turnItems.length > 0) {
        let anchorIdx = -1;
        let anchorTurn = -1;
        for (let i = 0; i < turnItems.length && anchorIdx === -1; i++) {
          const step = turnItems[i].querySelector?.('[data-testid=user-input-step], [data-testid=user-message-bubble], [class*="group/user-input"]');
          if (!step) continue;
          const domKey = normalizeMatchText(step.textContent).slice(0, 40);
          if (!domKey) continue;
          for (const c of compactions) {
            if (matchPromptText(domKey, c.promptKey)) {
              anchorIdx = i;
              anchorTurn = c.turn;
              break;
            }
            if (c.nextPromptKey && matchPromptText(domKey, c.nextPromptKey)) {
              anchorIdx = i;
              anchorTurn = c.turn + 1;
              break;
            }
          }
        }
        if (anchorIdx === -1) {
          for (let i = 0; i < turnItems.length && anchorIdx === -1; i++) {
            const itemBars = collectResponseBars(turnItems[i]);
            if (!itemBars.length) continue;
            const rawTail = normalizeMatchText((turnItems[i].textContent || '').slice(-400));
            if (!rawTail) continue;
            for (const c of compactions) {
              const tailProbe = c.responseTail?.slice(-28);
              if (tailProbe && tailProbe.length >= 10 && rawTail.includes(tailProbe)) {
                anchorIdx = i;
                anchorTurn = c.turn;
                break;
              }
            }
          }
        }
        if (anchorIdx !== -1) {
          const startTurn = anchorTurn - anchorIdx;
          for (const c of compactions) {
            const idx = c.turn - startTurn;
            if (idx >= 0 && idx < turnItems.length) {
              const itemBars = collectResponseBars(turnItems[idx]);
              if (itemBars.length) targets.set(c.turn, itemBars[itemBars.length - 1]);
            }
          }
          if (targets.size > 0) return targets;
        }
      }
    }

    const userSteps = Array.from(vp.querySelectorAll?.('[data-testid=user-input-step], [data-testid=user-message-bubble], [class*="group/user-input"]') || []);
    if (userSteps.length > 0 && typeof userSteps[0]?.compareDocumentPosition === 'function') {
      const matchedSteps = new Map();
      if (totalTurns > 0 && userSteps.length === totalTurns) {
        for (const c of compactions) {
          if (c.turn >= 1 && c.turn <= userSteps.length) {
            matchedSteps.set(c.turn, c.turn - 1);
          }
        }
      } else {
        for (let i = 0; i < userSteps.length; i++) {
          const key = normalizeMatchText(userSteps[i].textContent).slice(0, 40);
          if (!key) continue;
          for (const c of compactions) {
            if (!matchedSteps.has(c.turn) && !targets.has(c.turn) && matchPromptText(key, c.promptKey)) {
              matchedSteps.set(c.turn, i);
            }
            if (!matchedSteps.has(c.turn) && !targets.has(c.turn) && c.nextPromptKey && matchPromptText(key, c.nextPromptKey)) {
              const nextStep = userSteps[i];
              for (let b = bars.length - 1; b >= 0; b--) {
                if ((bars[b].compareDocumentPosition(nextStep) & 4) !== 0) {
                  targets.set(c.turn, bars[b]);
                  break;
                }
              }
            }
          }
        }
      }
      for (const [turn, stepIdx] of matchedSteps.entries()) {
        const step = userSteps[stepIdx];
        const nextStep = stepIdx + 1 < userSteps.length ? userSteps[stepIdx + 1] : null;
        let matchedBar = null;
        for (const bar of bars) {
          if ((step.compareDocumentPosition(bar) & 4) === 0) continue;
          if (nextStep && (bar.compareDocumentPosition(nextStep) & 4) === 0) break;
          matchedBar = bar;
        }
        if (matchedBar) targets.set(turn, matchedBar);
      }
    }

    // Last-resort tail matching on mounted bars if no userSteps anchored the compacted turn
    for (const c of compactions) {
      if (targets.has(c.turn)) continue;
      const tailProbe = c.responseTail?.slice(-28);
      if (tailProbe && tailProbe.length >= 10) {
        for (const bar of bars) {
          const card = bar.closest?.('.flex.items-start') || bar.parentElement?.parentElement;
          const tail = normalizeMatchText((card?.textContent || '').slice(-400));
          if (tail.includes(tailProbe)) {
            targets.set(c.turn, bar);
            break;
          }
        }
      }
    }

    if (!userSteps.length && (totalTurns === 0 || bars.length >= totalTurns)) {
      for (const c of compactions) {
        if (targets.has(c.turn)) continue;
        if (c.turn >= 1 && c.turn <= bars.length) {
          targets.set(c.turn, bars[c.turn - 1]);
        } else if (c.turn === 0 && totalTurns === 0 && bars.length >= 1) {
          targets.set(c.turn, bars[0]);
        }
      }
    }
    return targets;
  }

  function getTurnAnchorInViewport(stats, doc = document) {
    const vp = getViewportRoot(doc);
    const list = vp?.querySelector?.('.relative.flex.flex-col.gap-y-3');
    if (!list || !list.children?.length) return null;
    const compactions = Array.isArray(stats?.compactions) ? stats.compactions : [];
    const turnItems = collectTurnItems(list);
    for (let i = 0; i < turnItems.length; i++) {
      const step = turnItems[i].querySelector?.('[data-testid=user-input-step], [data-testid=user-message-bubble], [class*="group/user-input"]');
      if (!step) continue;
      const domKey = normalizeMatchText(step.textContent).slice(0, 40);
      if (!domKey) continue;
      for (const c of compactions) {
        if (matchPromptText(domKey, c.promptKey)) return { startTurn: c.turn - i, currentTurn: c.turn, itemCount: turnItems.length };
        if (c.nextPromptKey && matchPromptText(domKey, c.nextPromptKey)) return { startTurn: (c.turn + 1) - i, currentTurn: c.turn + 1, itemCount: turnItems.length };
      }
      if (typeof rules.resolveTurnNumberForPrompt === 'function') {
        const resolved = rules.resolveTurnNumberForPrompt(domKey, doc);
        if (typeof resolved === 'number' && resolved > 0) {
          return { startTurn: resolved - i, currentTurn: resolved, itemCount: turnItems.length };
        }
      }
    }
    return null;
  }

  function flashCompactionTarget(target) {
    if (!target || target.isConnected === false) return;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const marker = target.querySelector?.('[data-agpa-compaction-marker]') || target;
    if (marker?.classList) {
      marker.classList.add('agpa-compaction-flash');
      setTimeout(() => marker.classList?.remove('agpa-compaction-flash'), 1600);
    }
  }

  function jumpToCompactionTurn(stats, turnNum) {
    cancelJump();
    const startConvKey = conversationKey();
    const targets = findCompactionTargets(stats, document);
    const direct = targets.get(turnNum);
    if (direct && direct.isConnected !== false) {
      flashCompactionTarget(direct);
      return;
    }

    const vp = getViewportRoot(document);
    const navDot = turnNum >= 1
      ? (document.querySelector?.(`[data-testid=conversation-navigator-turn][data-turn-index="${turnNum - 1}"]`) ||
        document.querySelector?.(`[data-testid=conversation-navigator-turn][aria-label^="Turn ${turnNum} "]`))
      : null;

    if (navDot && typeof navDot.click === 'function') {
      navDot.click();
    } else if (vp && typeof vp.scrollTo === 'function' && vp.scrollHeight > vp.clientHeight) {
      const total = Math.max(turnNum, Number(stats?.turns) || turnNum);
      const targetTop = Math.max(0, Math.round(((turnNum - 0.5) / total) * vp.scrollHeight) - Math.round(vp.clientHeight / 2));
      vp.scrollTo({ top: targetTop, behavior: 'auto' });
    }

    const attachAbort = () => {
      if (stopped || !jumpTimer) return;
      const onUserCancel = e => {
        if (e.type === 'keydown' && !['Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
          return;
        }
        if (vp && vp.isConnected !== false && typeof vp.scrollTo === 'function') {
          vp.scrollTo({ top: vp.scrollTop, behavior: 'auto' });
        }
        cancelJump();
      };
      document.addEventListener?.('pointerdown', onUserCancel, true);
      document.addEventListener?.('wheel', onUserCancel, { capture: true, passive: true });
      document.addEventListener?.('touchstart', onUserCancel, { capture: true, passive: true });
      document.addEventListener?.('keydown', onUserCancel, true);
      jumpAbortCleanup = () => {
        document.removeEventListener?.('pointerdown', onUserCancel, true);
        document.removeEventListener?.('wheel', onUserCancel, true);
        document.removeEventListener?.('touchstart', onUserCancel, true);
        document.removeEventListener?.('keydown', onUserCancel, true);
      };
    };

    let attempts = 0;
    let lastAnchor = null;
    const stepRefine = () => {
      jumpTimer = null;
      if (stopped || conversationKey() !== startConvKey || findNativeContext()) {
        cancelJump();
        return;
      }
      const freshStats = activeStats || stats;
      syncCompactionMarkers(freshStats);
      const found = findCompactionTargets(freshStats, document).get(turnNum);
      if (found && found.isConnected !== false) {
        cancelJump();
        flashCompactionTarget(found);
        return;
      }
      attempts++;
      if (attempts >= 24 || !vp || vp.isConnected === false) {
        cancelJump();
        return;
      }
      if (vp.scrollHeight > vp.clientHeight) {
        const anchor = getTurnAnchorInViewport(freshStats, document);
        if (anchor) {
          const midTurn = anchor.startTurn + Math.floor(anchor.itemCount / 2);
          const deltaTurns = turnNum - midTurn;
          const absDelta = Math.abs(deltaTurns);
          // Re-click navDot once if the virtualizer shifted after initial jump and we are still far away
          if (attempts === 1 && absDelta > 4 && navDot && typeof navDot.click === 'function' && lastAnchor === null) {
            lastAnchor = midTurn;
            navDot.click();
            jumpTimer = setTimeout(stepRefine, 220);
            return;
          }
          lastAnchor = midTurn;
          if (deltaTurns === 0) {
            cancelJump();
            return;
          }
          const stepPx = absDelta > 8
            ? Math.min(Math.max(vp.clientHeight * 1.4, 900), absDelta * 260)
            : Math.max(260, Math.round(vp.clientHeight * 0.75));
          const maxTop = Math.max(0, vp.scrollHeight - vp.clientHeight);
          const nextTop = deltaTurns > 0
            ? Math.min(maxTop, vp.scrollTop + stepPx)
            : Math.max(0, vp.scrollTop - stepPx);
          if (nextTop === vp.scrollTop) {
            cancelJump();
            return;
          }
          vp.scrollTop = nextTop;
        } else {
          if (vp.scrollTop <= 0) {
            cancelJump();
            return;
          }
          const stepPx = Math.max(300, Math.round(vp.clientHeight * 0.9));
          vp.scrollTop = Math.max(0, vp.scrollTop - stepPx);
        }
      } else {
        cancelJump();
        return;
      }
      jumpTimer = setTimeout(stepRefine, 140);
    };
    jumpTimer = setTimeout(stepRefine, 180);
    if (typeof queueMicrotask === 'function') queueMicrotask(attachAbort);
    else attachAbort();
  }

  function syncCompactionMarkers(stats, precollectedBars = null) {
    const compactions = Array.isArray(stats?.compactions) ? stats.compactions : [];
    if (!compactions.length) {
      if (hasCompactionMarkers) {
        document.querySelectorAll('[data-agpa-compaction-marker]').forEach(n => n.remove());
        hasCompactionMarkers = false;
      }
      return;
    }

    const targets = findCompactionTargets(stats, document, precollectedBars);
    const desiredByBar = new Map();
    for (const c of compactions) {
      const bar = targets.get(c.turn);
      if (bar) desiredByBar.set(bar, c);
    }

    if (hasCompactionMarkers) {
      document.querySelectorAll('[data-agpa-compaction-marker]').forEach(node => {
        const bar = node.parentElement;
        const c = desiredByBar.get(bar);
        const sig = c ? `${c.turn}:${c.preTokens || 0}:${c.postTokens || 0}:${c.count || 1}` : '';
        if (!c || node.getAttribute('data-agpa-compaction-sig') !== sig) {
          node.remove();
        } else {
          const label = compactionLabel(c);
          if (node.getAttribute('title') !== label) node.setAttribute('title', label);
          if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
        }
      });
    }

    let placed = 0;
    for (const [bar, c] of desiredByBar.entries()) {
      const sig = `${c.turn}:${c.preTokens || 0}:${c.postTokens || 0}:${c.count || 1}`;
      const label = compactionLabel(c);
      const existing = bar.querySelector?.(`[data-agpa-compaction-marker][data-agpa-compaction-sig="${sig}"]`);
      if (existing) {
        if (existing.getAttribute('title') !== label) existing.setAttribute('title', label);
        if (existing.getAttribute('aria-label') !== label) existing.setAttribute('aria-label', label);
        placed++;
        continue;
      }
      const marker = element('span', {
        class: 'agpa-compaction-marker',
        'data-agpa-compaction-marker': '',
        'data-agpa-compaction-turn': String(c.turn),
        'data-agpa-compaction-sig': sig,
        role: 'img',
        'aria-label': label,
        title: label
      });
      marker.append(createCompactionIcon());
      const copyBtn = bar.querySelector?.('button[aria-label="Copy"], button[title="Copy"], button[aria-label*="copy" i]');
      if (copyBtn) bar.insertBefore(marker, copyBtn);
      else bar.append(marker);
      placed++;
    }
    hasCompactionMarkers = placed > 0 || document.querySelectorAll('[data-agpa-compaction-marker]').length > 0;
  }

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
    clearTimeout(hoverTimer);clearTimeout(hoverCloseTimer);
    hoverTimer = hoverCloseTimer = null;
    popupButton?.removeAttribute('aria-describedby');
    popupMode = null;
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

  function openDetails(button, stats, preview = false) {
    closePopup();
    if (stopped) return;
    popupButton = button;
    popupMode = preview ? 'preview' : 'details';
    if (preview) button.setAttribute('aria-describedby','agpa-context-hover');
    else button.setAttribute('aria-expanded', 'true');
    popup = element('div', {
      class: 'agpa-context-popup' + (preview ? ' agpa-context-hover' : ''), role: preview ? 'tooltip' : 'dialog',
      'aria-label': t('Context window'), 'data-level': stats.budget.level
    });
    if (preview) popup.id = 'agpa-context-hover';
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
    const format = formatTokenCount;
    const compaction = totals.compaction;
    const meterLimit = compaction?.threshold ?? totals.capacity;
    const meterPercentage = compaction?.percentage ?? totals.percentage;
    const percent = meterPercentage === null ? '—' : Math.round(meterPercentage) + '%';
    const headlineText = compaction ? t('{percent} of compaction threshold', {percent}) : t('{percent} full', {percent});
    const usageText = compaction
      ? t('{used} of {threshold} tokens before compaction', {used:format(totals.used),threshold:format(compaction.threshold)})
      : t('{used} of {capacity} tokens used', {used:format(totals.used),capacity:format(totals.capacity)});
    if (!preview) header.append(closeBtn);
    const hero = element('div', {class:'agpa-context-hero'});
    const donut = element('div', {class:'agpa-context-donut', 'aria-hidden':'true'});
    donut.style.setProperty('--context-percent', (meterPercentage || 0) + '%');
    donut.append(element('strong', {class:'agpa-context-percent', text:percent}));
    const headline = element('div', {class:'agpa-context-headline'});
    headline.append(element('div', {class:'agpa-context-full', text:headlineText}), element('div', {
      class:'agpa-context-used', text:usageText
    }));
    hero.append(donut,headline);popup.append(hero);
    if (preview) {
      popup.addEventListener('pointerenter',()=>{clearTimeout(hoverCloseTimer);hoverCloseTimer=null;});
      popup.addEventListener('pointerleave',schedulePreviewClose);
      placePopup(button);
      return;
    }

    const meter = element('div', {
      class: 'agpa-context-meter', role: 'progressbar',
      'aria-label': t(compaction ? 'Compaction threshold' : 'Context window'), 'aria-valuemin': '0', 'aria-valuemax': '100'
    });
    if (meterPercentage !== null) meter.setAttribute('aria-valuenow', String(Math.round(meterPercentage)));
    meter.setAttribute('aria-valuetext', percent);
    const instructionsSegment = element('span', {class:'agpa-context-meter-instructions'});
    const conversationSegment = element('span', {class:'agpa-context-meter-used'});
    const instructionsPercent = meterLimit ? Math.min(meterPercentage || 0, (totals.instructions || 0) / meterLimit * 100) : 0;
    instructionsSegment.style.width = instructionsPercent + '%';
    conversationSegment.style.width = Math.max(0, (meterPercentage || 0) - instructionsPercent) + '%';
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
      row(t('Conversation'), format(totals.conversation), '☷', 'agpa-context-conversation'));
    if (compaction) {
      popup.append(row(t('Remaining before compaction'), format(compaction.remaining), '○', 'agpa-context-free'),
        row(t('Model capacity'), format(totals.capacity), '▤'));
    } else {
      popup.append(row(t('Free'), format(totals.free), '○', 'agpa-context-free'));
    }
    const compactions = Array.isArray(stats.compactions) ? stats.compactions : [];
    if (compactions.length > 0) {
      const compRow = element('div', { class: 'agpa-context-row agpa-context-compactions' });
      const chipList = element('div', {
        class: 'agpa-context-compactions-array',
        role: 'group',
        'aria-label': t('Compacted turns')
      });
      for (const c of compactions) {
        const chipText = c.count > 1 ? `#${c.turn} ×${c.count}` : `#${c.turn}`;
        const chip = element('button', {
          type: 'button',
          class: 'agpa-context-compaction-chip',
          text: chipText,
          title: compactionLabel(c),
          'aria-label': t('Jump to turn #{turn}', { turn: String(c.turn) })
        });
        chip.addEventListener('click', () => {
          jumpToCompactionTurn(stats, c.turn);
          closePopup();
        });
        chipList.append(chip);
      }
      const labelSpan = element('span', { class: 'agpa-context-row-label', text: t('Compacted turns') });
      const iconSpan = element('span', { class: 'agpa-context-row-icon', 'aria-hidden': 'true' });
      iconSpan.append(createCompactionIcon());
      compRow.append(iconSpan, labelSpan, chipList);
      popup.append(compRow);
    }
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

  function schedulePreviewClose() {
    clearTimeout(hoverTimer);hoverTimer=null;
    if (popupMode !== 'preview') return;
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer=setTimeout(()=>{hoverCloseTimer=null;if(popupMode==='preview')closePopup();},180);
  }
  function findNativeContext() {
    return document.querySelector('[data-testid=context-usage-indicator]');
  }

  function conversationKey() {
    return rules.getConversationKey ? rules.getConversationKey(document) : 'default';
  }

  function schedulePreview(button) {
    clearTimeout(hoverCloseTimer);hoverCloseTimer=null;
    if (popupMode === 'details' || (popupMode === 'preview' && popupButton === button)) return;
    clearTimeout(hoverTimer);
    hoverTimer=setTimeout(()=>{
      hoverTimer=null;
      if(stopped || !button.isConnected || findNativeContext()) return;
      const stats=activeStats || rules.extractConversationStats(document);
      if(!isPending(stats))openDetails(button,stats,true);
    },180);
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
      if (findNativeContext()) return;
      if (popup && popupMode === 'details') closePopup();
      else openDetails(pill, activeStats || rules.extractConversationStats(document));
    });
    pill.addEventListener('pointerenter',()=>schedulePreview(pill));
    pill.addEventListener('pointerleave',schedulePreviewClose);
    pill.append(element('span', {class:'agpa-context-ring', 'aria-hidden':'true'}));
    return pill;
  }

  function updatePill(pill, stats) {
    if (isPending(stats)) {
      const label = t('Context window');
      pill.setAttribute('data-level', 'pending');
      pill.style.setProperty('--agpa-context-fill','0%');
      pill.removeAttribute('title');
      pill.setAttribute('aria-label', label);
      return;
    }
    if (pill.getAttribute('data-level') !== stats.budget.level) {
      pill.setAttribute('data-level', stats.budget.level);
    }
    pill.style.setProperty('--budget-color', stats.budget.color);

    pill.removeAttribute('title');
    pill.style.setProperty('--agpa-context-fill', Math.max(0, Math.min(100, stats.budget.percentage)) + '%');
    const ariaText = stats.compactionThreshold
      ? t('{used} of {threshold} tokens before compaction', {
        used: stats.formatted, threshold: rules.formatTokens(stats.compactionThreshold)
      })
      : t('Context budget: {tokens} tokens ({turns} turns)', {
        tokens: stats.formatted, turns: String(stats.turns)
      });
    if (pill.getAttribute('aria-label') !== ariaText) pill.setAttribute('aria-label', ariaText);
  }

  function apply() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (stopped) return;

    // Native controls own their values, popup, and events. Our global estimate
    // is only a fallback while the official feature is unavailable in the rollout.
    const nativeContext = findNativeContext();
    if (nativeContext) {
      activeStats = null;
      cancelJump();
      cancelCompactRetry();
      closePopup();
      syncCompactionMarkers({ compactions: [] });
      document.querySelectorAll('[data-agpa-context-budget]').forEach(node => node.remove());
      const footer = nativeContext.closest('[data-agpa-composer-footer], .agy-composer-footer');
      footer?.querySelector('[data-testid=model-selector-trigger]')?.setAttribute('data-agpa-context-adjacent','');
      return;
    }

    const stats = rules.extractConversationStats(document);
    if (popup && activeStats?.modelName !== stats.modelName) closePopup();
    activeStats = stats;

    const convKey = conversationKey();
    if (convKey !== lastObservedConvKey) {
      lastObservedConvKey = convKey;
      lastRequestedResponseCount = 0;
      lastCompactRetryKey = '';
      cancelJump();
      cancelCompactRetry();
      closePopup();
    }
    const vp = getViewportRoot(document);
    let precollectedBars = null;
    if (convKey && convKey !== 'default') {
      const stored = rules.loadConversationState ? rules.loadConversationState(convKey) : null;
      const navTurns = rules.countTurns ? rules.countTurns(document) : 0;
      precollectedBars = vp ? collectResponseBars(vp) : [];
      const responseBarCount = precollectedBars.length;
      const responseCompleted = responseBarCount > lastRequestedResponseCount;
      const mtimePending = Boolean(stored?.mtime && stored?.updatedAt && stored.mtime > stored.updatedAt);
      const missingCompactionHydration = Boolean(
        stored && (!stored.compactionHydrated || (Array.isArray(stored.compactions) && stored.compactions.some(c => c.responseTail === undefined)))
      );
      const needsReq = !stored || !stored.apiTokens || missingCompactionHydration || (navTurns > 0 && navTurns > (stored.maxTurns || 0)) || mtimePending || responseCompleted;
      if (needsReq && typeof globalThis.__agpaTranscriptRequest === 'function') {
        const now = Date.now();
        const throttleMs = responseCompleted ? 500 : 1500;
        const allowReq = lastReqConvKey !== convKey || (now - lastReqAt > throttleMs);
        if (allowReq) {
          if (responseCompleted) lastRequestedResponseCount = responseBarCount;
          lastReqConvKey = convKey;
          lastReqAt = now;
          globalThis.__agpaTranscriptRequest(JSON.stringify({ convKey }));
        }
      }
      const hasDomCompact = Boolean(vp && vp.querySelector?.('[data-testid*="compact"], [data-testid*="compaction"]'));
      if (hasDomCompact && !stats.compactions?.length && lastCompactRetryKey !== convKey && typeof globalThis.__agpaTranscriptRequest === 'function') {
        lastCompactRetryKey = convKey;
        cancelCompactRetry();
        compactRetryTimer = setTimeout(() => {
          compactRetryTimer = null;
          if (!stopped && conversationKey() === convKey && !findNativeContext()) {
            globalThis.__agpaTranscriptRequest?.(JSON.stringify({ convKey }));
          }
        }, 1200);
      }
    }

    if (isPending(stats)) {
      cancelJump();
      cancelCompactRetry();
      closePopup();
      syncCompactionMarkers({ compactions: [] });
      document.querySelectorAll('[data-agpa-context-budget]').forEach(node => node.remove());
      document.querySelectorAll('[data-agpa-context-adjacent]').forEach(node => node.removeAttribute('data-agpa-context-adjacent'));
      return;
    }

    syncCompactionMarkers(stats, precollectedBars);

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
    .agpa-context-hover .agpa-context-hero {margin-bottom:0}
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
    .agpa-context-compactions {align-items:flex-start;margin-top:4px;padding-top:6px;border-top:1px solid var(--border,#333)}
    .agpa-context-compactions .agpa-context-row-icon {color:#a78bfa;padding-top:3px;display:inline-flex;align-items:center;justify-content:center}
    .agpa-context-compactions .agpa-context-row-label {padding-top:2px}
    .agpa-context-compactions-array {display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;max-width:170px}
    .agpa-context-compaction-chip {
      border:1px solid color-mix(in srgb,#a78bfa 35%,transparent);
      background:color-mix(in srgb,#a78bfa 14%,transparent);
      color:#c4b5fd;border-radius:999px;padding:1px 7px;
      font:600 11px/1.45 system-ui,sans-serif;cursor:pointer;
      transition:background 120ms ease,border-color 120ms ease;
    }
    .agpa-context-compaction-chip:hover {
      background:color-mix(in srgb,#a78bfa 26%,transparent);
      border-color:color-mix(in srgb,#a78bfa 60%,transparent);
    }
    .agpa-context-compaction-chip:focus-visible {outline:2px solid #6ba9ff;outline-offset:2px}
    .agpa-compaction-marker {
      display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
      width:22px;height:22px;border-radius:6px;margin-inline:2px;
      color:#c4b5fd;background:color-mix(in srgb,#a78bfa 14%,transparent);
      border:1px solid color-mix(in srgb,#a78bfa 28%,transparent);
      vertical-align:middle;cursor:default;
      transition:background 140ms ease,color 140ms ease,box-shadow 180ms ease;
    }
    .agpa-compaction-marker:hover {
      color:#ddd6fe;background:color-mix(in srgb,#a78bfa 24%,transparent);
    }
    .agpa-compaction-flash {
      box-shadow:0 0 0 2px #a78bfa,0 0 10px color-mix(in srgb,#a78bfa 55%,transparent);
    }
  `;
  document.head.append(style);

  const isOwnUiNode = n => n?.nodeType === 1 && (
    n.hasAttribute?.('data-agpa-context-ui') ||
    n.hasAttribute?.('data-agpa-context-budget') ||
    Boolean(n.closest?.('[data-agpa-context-ui], [data-agpa-context-budget], .agpa-context-popup'))
  );

  const observer = new MutationObserver(records => {
    let relevant = false;
    for (const r of records) {
      const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!target) continue;
      if (target.closest?.('[data-agpa-context-ui], [data-agpa-context-budget], .agpa-context-popup')) continue;
      if (r.type === 'childList') {
        const added = Array.from(r.addedNodes || []);
        const removed = Array.from(r.removedNodes || []);
        if ((added.length > 0 || removed.length > 0) && added.every(isOwnUiNode) && removed.every(isOwnUiNode)) {
          continue;
        }
      }
      relevant = true;
      break;
    }
    if (relevant) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

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
    status: () => ({ stats: activeStats, open: !!popup, mode: popupMode }),
    getActiveKey: () => findNativeContext() ? null : conversationKey(),
    needsTranscript: (key, optionsOrMtime) => {
      if (findNativeContext()) return false;
      const k = (typeof key === 'string' ? key : key?.convKey) || conversationKey();
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
      if (!findNativeContext() && rules.hydrateFromTranscript) {
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
      cancelJump();
      cancelCompactRetry();
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
