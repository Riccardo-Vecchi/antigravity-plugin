'use strict';

function scanSubagents(root = document) {
  const subagents = new Map();
  if (!root) return [];

  const scope = root.querySelector?.('[data-testid=autoscroll-viewport]') ||
    root.querySelector?.('[data-testid=conversation-view]') ||
    root;

  // Only query buttons and explicit subagent/step nodes, never all divs/spans
  const candidates = scope.querySelectorAll?.('button, [role="button"], [data-testid*="subagent"], [data-testid*="step"]') || [];

  for (const el of candidates) {
    // Skip if element has nested candidate buttons/steps
    if (el.querySelector?.('button, [role="button"], [data-testid*="subagent"]')) continue;

    const text = el.textContent?.trim() || '';
    if (!text || text.length > 200) continue;

    // 1. Check "Message from <Role> (<TypeName>)"
    if (text.includes('Message from ')) {
      const match = text.match(/Message from ([^(]+)(?:\(([^)]+)\))?/);
      if (match) {
        const role = match[1].trim();
        const typeName = match[2]?.trim() || '';
        const card = el.closest?.('[class*="group"], [class*="step"]') || el;
        const isRunning = !!card.querySelector?.('[data-testid="status-loading-spinner"], [class*="animate-spin"], [data-status="running"]');

        const key = `${role}:${typeName}`;
        const existing = subagents.get(key);
        if (existing) {
          existing.messagesCount++;
          if (isRunning) existing.isRunning = true;
        } else {
          subagents.set(key, {
            role,
            typeName,
            isRunning,
            messagesCount: 1,
            element: el
          });
        }
        continue;
      }
    }

    // 2. Check "Started <Role>"
    if (text.startsWith('Started ') && text.length < 80) {
      const role = text.replace(/^Started\s+/, '').trim();
      if (role) {
        const card = el.closest?.('[class*="group"], [class*="step"]') || el;
        const isRunning = !!card.querySelector?.('[data-testid="status-loading-spinner"], [class*="animate-spin"], [data-status="running"]');
        const key = `${role}:`;
        if (!subagents.has(key)) {
          subagents.set(key, {
            role,
            typeName: '',
            isRunning,
            messagesCount: 1,
            element: el
          });
        }
      }
    }
  }

  return [...subagents.values()];
}

function summaryFor(subagents = [], isTeamworkActive = false) {
  const list = Array.isArray(subagents) ? subagents : [];
  const total = list.length;
  const active = list.filter(s => s.isRunning).length;
  const visible = Boolean(isTeamworkActive || total > 0);
  return {
    total,
    active,
    visible,
    subagents: list
  };
}

module.exports = {
  scanSubagents,
  summaryFor
};
