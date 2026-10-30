/* Top titlebar badge displaying active and completed subagents in Teamwork mode. */
(() => {
  'use strict';
  const VERSION = '1.0.2';
  if (globalThis.__AGTeamworkBadge?.version === VERSION) return;
  globalThis.__AGTeamworkBadge?.destroy();

  const rules = globalThis.__AGPA_TEAMWORK_BADGE__ || require('./teamwork-badge.cjs');
  const i18n = globalThis.__AGPAI18n;
  const t = (key, values) => (i18n ? i18n.t(key, values) : key);

  let stopped = false, timer = null, lastBadgeSignature = '';
  let badge = null, popover = null, currentSummary = null;

  function element(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    node.setAttribute('data-agpa-team-ui', '');
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function closePopover() {
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function isComposerTeamworkActive() {
    const trigger = document.querySelector('[data-testid=model-selector-trigger]');
    if (trigger?.hasAttribute('data-teamwork')) return true;
    const chip = document.querySelector('[data-uri="slashCommand:teamwork"],[data-uri="slashCommand:/teamwork"]');
    return !!chip;
  }

  function openPopover(anchor, summary) {
    closePopover();
    if (stopped) return;

    popover = element('div', {
      class: 'agpa-team-popover',
      role: 'dialog',
      'aria-label': t('Subagents in this conversation')
    });

    const header = element('div', { class: 'agpa-team-popover-header' });
    const title = element('strong', { text: t('Subagents in this conversation') });
    const closeBtn = element('button', {
      type: 'button',
      class: 'agpa-team-close',
      'aria-label': t('Close'),
      text: '×'
    });
    closeBtn.addEventListener('click', closePopover);
    header.append(title, closeBtn);
    popover.append(header);

    if (!summary.subagents.length) {
      const emptyNote = element('p', {
        class: 'agpa-team-empty',
        text: t('No subagents launched yet')
      });
      popover.append(emptyNote);
    } else {
      const list = element('div', { class: 'agpa-team-list' });
      for (const sa of summary.subagents) {
        const item = element('button', {
          type: 'button',
          class: 'agpa-team-item',
          title: t('Jump to message')
        });

        const statusDot = element('span', {
          class: sa.isRunning ? 'agpa-subagent-dot active' : 'agpa-subagent-dot done'
        });

        const info = element('div', { class: 'agpa-subagent-info' });
        const name = element('span', { class: 'agpa-subagent-name', text: sa.role });
        const meta = element('span', {
          class: 'agpa-subagent-meta',
          text: sa.typeName ? `${sa.typeName} · ${sa.messagesCount} msg` : `${sa.messagesCount} msg`
        });
        info.append(name, meta);

        item.append(statusDot, info);
        item.addEventListener('click', () => {
          if (sa.element && sa.element.isConnected) {
            sa.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            sa.element.classList.add('agpa-subagent-highlight');
            setTimeout(() => sa.element.classList.remove('agpa-subagent-highlight'), 1800);
          }
          closePopover();
        });

        list.append(item);
      }
      popover.append(list);
    }

    document.body.append(popover);
    const rect = anchor.getBoundingClientRect();
    popover.style.left = Math.max(8, Math.min(rect.right - 260, window.innerWidth - 270)) + 'px';
    popover.style.top = Math.max(8, rect.bottom + 8) + 'px';
  }

  function apply() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (stopped) return;

    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    if (!toolbar) return;

    const host = toolbar.querySelector(':scope > .flex.items-center.gap-1') || toolbar;
    const isTeamworkActive = isComposerTeamworkActive();
    const subagents = rules.scanSubagents(document);
    const summary = rules.summaryFor(subagents, isTeamworkActive);
    currentSummary = summary;

    if (!summary.visible) {
      lastBadgeSignature = '';
      if (badge) {
        badge.remove();
        badge = null;
      }
      closePopover();
      return;
    }

    const signature = `${summary.visible}:${summary.active}:${summary.total}:${isTeamworkActive}`;
    if (badge && badge.isConnected && badge.parentElement === host && lastBadgeSignature === signature) {
      return;
    }
    lastBadgeSignature = signature;

    if (!badge || !badge.isConnected) {
      badge = element('button', {
        type: 'button',
        class: 'agpa-teamwork-badge',
        'data-agpa-teamwork-badge': '',
        'aria-haspopup': 'dialog'
      });
      badge.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (popover) closePopover();
        else openPopover(badge, currentSummary || rules.summaryFor(rules.scanSubagents(document), isComposerTeamworkActive()));
      });
      host.append(badge);
    }

    badge.replaceChildren();

    // Icon
    const icon = element('span', { class: 'agpa-team-icon', text: '👥' });
    badge.append(icon);

    if (summary.active > 0) {
      badge.setAttribute('data-active', 'true');
      const pulse = element('span', { class: 'agpa-team-pulse' });
      const label = element('span', {
        text: t('{active} active · {count} subagents', {
          active: String(summary.active),
          count: String(summary.total)
        })
      });
      badge.append(pulse, label);
      badge.setAttribute(
        'title',
        t('{active} active · {count} subagents', {
          active: String(summary.active),
          count: String(summary.total)
        })
      );
    } else if (summary.total > 0) {
      badge.removeAttribute('data-active');
      const countLabel =
        summary.total === 1
          ? t('{count} subagent', { count: String(summary.total) })
          : t('{count} subagents', { count: String(summary.total) });
      const label = element('span', { text: countLabel });
      badge.append(label);
      badge.setAttribute('title', t('All subagents completed'));
    } else {
      badge.removeAttribute('data-active');
      const label = element('span', { text: t('Teamwork active') });
      badge.append(label);
      badge.setAttribute('title', t('Teamwork active'));
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
  style.id = 'agpa-teamwork-badge-styles';
  style.textContent = `
    .agpa-teamwork-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 0 10px;
      border: 1px solid #a464f650;
      border-radius: 999px;
      background: #8f46df22;
      color: #d4b1ff;
      font: 500 12px/1 system-ui, sans-serif;
      cursor: pointer;
      white-space: nowrap;
      transition: all 180ms ease-out;
      flex-shrink: 0;
      box-shadow: inset 0 0 0 1px #9e5bef25;
    }
    .agpa-teamwork-badge:hover {
      background: #8f46df35;
      border-color: #a464f690;
      color: #f1e4ff;
    }
    .agpa-teamwork-badge[data-active="true"] {
      border-color: #ba86ff;
      background: #8f46df38;
      box-shadow: 0 0 12px rgba(164, 100, 246, 0.35);
    }
    .agpa-team-icon {
      font-size: 13px;
      line-height: 1;
    }
    .agpa-team-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #c595ff;
      box-shadow: 0 0 6px #ba86ff;
      animation: agpa-team-glow 1.5s infinite ease-in-out;
    }
    @keyframes agpa-team-glow {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    .agpa-team-popover {
      position: fixed;
      z-index: 2147483640;
      width: 260px;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid #a464f660;
      border-radius: 14px;
      background: var(--card, #252525);
      color: var(--foreground, #eee);
      font: 12px/1.4 system-ui, sans-serif;
      box-shadow: 0 10px 30px #0008, 0 0 16px rgba(164, 100, 246, 0.15);
    }
    .agpa-team-popover-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .agpa-team-popover-header strong {
      font-size: 12px;
      color: #d4afff;
    }
    .agpa-team-close {
      border: 0;
      background: transparent;
      color: var(--secondary-foreground, #aaa);
      font: 16px/1 system-ui;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .agpa-team-close:hover {
      color: #fff;
    }
    .agpa-team-empty {
      margin: 8px 0;
      font-size: 11px;
      color: var(--muted-foreground, #aaa);
    }
    .agpa-team-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 220px;
      overflow-y: auto;
    }
    .agpa-team-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: var(--secondary, #303030);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: all 120ms ease;
    }
    .agpa-team-item:hover {
      background: #8f46df25;
      border-color: #a464f650;
    }
    .agpa-subagent-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .agpa-subagent-dot.active {
      background: #c595ff;
      box-shadow: 0 0 6px #ba86ff;
    }
    .agpa-subagent-dot.done {
      background: #41c878;
    }
    .agpa-subagent-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .agpa-subagent-name {
      font-weight: 500;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .agpa-subagent-meta {
      font-size: 10px;
      color: var(--muted-foreground, #aaa);
    }
    .agpa-subagent-highlight {
      outline: 2px solid #a464f6 !important;
      outline-offset: 2px !important;
      transition: outline 400ms ease;
    }
  `;
  document.head.append(style);

  const observer = new MutationObserver(records => {
    let relevant = false;
    for (const r of records) {
      const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!target) continue;
      if (target.closest('[data-agpa-team-ui], [data-agpa-teamwork-badge], .agpa-team-popover')) continue;
      relevant = true;
      break;
    }
    if (relevant) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const onPointerDown = e => {
    if (popover && !popover.contains(e.target) && !e.target.closest('[data-agpa-teamwork-badge]')) {
      closePopover();
    }
  };
  document.addEventListener('pointerdown', onPointerDown, true);

  const unsubscribe = i18n?.subscribe ? i18n.subscribe(() => schedule(true)) : () => {};

  globalThis.__AGTeamworkBadge = {
    version: VERSION,
    status: () => ({ summary: currentSummary, open: !!popover }),
    refresh: () => apply(),
    destroy() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastBadgeSignature = '';
      closePopover();
      observer.disconnect();
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerDown, true);
      style.remove();
      if (badge) badge.remove();
      badge = null;
      document.querySelectorAll('[data-agpa-teamwork-badge], [data-agpa-team-ui]').forEach(n => n.remove());
      delete globalThis.__AGTeamworkBadge;
    }
  };

  schedule(true);
})();
