'use strict';

const conversationCache = new Map();

function estimateTokens(chars, turns) {
  const textTokens = Math.round((Number(chars) || 0) / 4);
  const turnOverhead = (Number(turns) || 0) * 120;
  return Math.max(0, textTokens + turnOverhead);
}

function budgetLevelFor(tokens) {
  const count = Number(tokens) || 0;
  if (count < 35000) {
    return { level: 'healthy', color: '#6ba9ff', label: 'Healthy', percentage: Math.min(100, Math.round((count / 200000) * 100)) };
  }
  if (count < 85000) {
    return { level: 'moderate', color: '#41c878', label: 'Moderate', percentage: Math.min(100, Math.round((count / 200000) * 100)) };
  }
  if (count < 160000) {
    return { level: 'elevated', color: '#ffd647', label: 'Elevated', percentage: Math.min(100, Math.round((count / 200000) * 100)) };
  }
  return { level: 'saturated', color: '#ff666a', label: 'Saturated', percentage: Math.min(100, Math.round((count / 200000) * 100)) };
}

function formatTokens(tokens) {
  const count = Number(tokens) || 0;
  if (count < 1000) return String(count);
  const k = Math.round(count / 1000);
  return `~${k}k`;
}

function countTurns(doc) {
  if (!doc) return 0;
  const navTurns = doc.querySelectorAll?.('[data-testid=conversation-navigator-turn]')?.length || 0;
  if (navTurns > 0) return navTurns;
  const steps = doc.querySelectorAll?.('[data-testid=user-input-step]')?.length || 0;
  if (steps > 0) return steps;
  const bubbles = doc.querySelectorAll?.('[data-testid=user-message-bubble]')?.length || 0;
  if (bubbles > 0) return bubbles;
  const userGroups = doc.querySelectorAll?.('[class*="group/user-input"]')?.length || 0;
  if (userGroups > 0) return userGroups;
  return 0;
}

function getConversationKey(doc) {
  const path = doc?.defaultView?.location?.pathname || globalThis?.location?.pathname || doc?.location?.pathname || '';
  if (path.startsWith('/c/')) return path;
  if (path && path !== '/') return path;
  return 'default';
}

function collectTurnBlocks(doc) {
  const blocks = [];
  if (!doc) return blocks;
  const vp = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]');
  if (!vp) return blocks;

  const list = vp.querySelector?.('.relative.flex.flex-col.gap-y-3') || vp.firstElementChild;
  const items = list?.children?.length ? [...list.children] : (vp.querySelectorAll?.('.flex.items-start') || []);
  for (const item of items) {
    if (!list?.children?.length && item.parentElement?.closest?.('.flex.items-start')) continue;
    const userStep = item.querySelector?.('[data-testid=user-input-step]');
    const prompt = userStep ? userStep.textContent?.slice(0, 80)?.trim() : '';
    const text = item.textContent || '';
    if (prompt || text.length > 50) {
      const key = prompt ? 'p:' + prompt : 't:' + text.slice(0, 60);
      blocks.push({ key, length: text.length });
    }
  }
  return blocks;
}

function extractConversationStats(doc = document) {
  if (!doc) return { chars: 0, turns: 0, tokens: 0, budget: budgetLevelFor(0), formatted: '0' };
  const convKey = getConversationKey(doc);

  let entry = conversationCache.get(convKey);
  if (!entry) {
    if (conversationCache.size > 100) {
      const oldest = conversationCache.keys().next().value;
      conversationCache.delete(oldest);
    }
    entry = { blocks: new Map(), maxChars: 0, maxTurns: 0 };
    conversationCache.set(convKey, entry);
  }

  const viewport = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]');

  // Check if conversation was compacted (without traversing doc.body.textContent)
  const isCompacted = Boolean(
    doc.querySelector?.('[data-testid*="compact"], [data-testid*="compaction"]') ||
    viewport?.querySelector?.('[class*="compact"], [data-testid*="step"]')?.textContent?.includes('Conversation compacted')
  );
  if (isCompacted && entry.compacted !== true) {
    entry.blocks.clear();
    entry.maxChars = 0;
    entry.maxTurns = 0;
    entry.compacted = true;
  }

  // Discover newly mounted turn blocks in viewport
  const currentBlocks = collectTurnBlocks(doc);
  for (const b of currentBlocks) {
    entry.blocks.set(b.key, b.length);
  }

  let blockSum = 0;
  for (const len of entry.blocks.values()) blockSum += len;

  let currentChars = 0;
  if (viewport) {
    charsFromVp: {
      currentChars = viewport.textContent?.length || 0;
      if (!doc.querySelector?.('[data-testid=autoscroll-viewport]')) {
        const composer = viewport.querySelector?.('.surface-composer, [data-testid=agent-input-box]');
        if (composer) currentChars = Math.max(0, currentChars - (composer.textContent?.length || 0));
      }
    }
  }

  const chars = Math.max(blockSum, currentChars, entry.maxChars);
  entry.maxChars = chars;

  const navTurns = countTurns(doc);
  const turns = Math.max(entry.blocks.size, navTurns, entry.maxTurns);
  entry.maxTurns = turns;

  const estimateFn = typeof estimateTokens === 'function' ? estimateTokens : (this?.estimateTokens || estimateTokens);
  const budgetFn = typeof budgetLevelFor === 'function' ? budgetLevelFor : (this?.budgetLevelFor || budgetLevelFor);
  const formatFn = typeof formatTokens === 'function' ? formatTokens : (this?.formatTokens || formatTokens);

  const tokens = estimateFn(chars, turns);
  const budget = budgetFn(tokens);
  return { chars, turns, tokens, budget, formatted: formatFn(tokens) };
}

function clearCache(key) {
  if (key) conversationCache.delete(key);
  else conversationCache.clear();
}

module.exports = {
  estimateTokens,
  budgetLevelFor,
  formatTokens,
  countTurns,
  getConversationKey,
  collectTurnBlocks,
  extractConversationStats,
  clearCache
};
