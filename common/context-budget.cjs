'use strict';

const conversationCache = new Map();

function estimateImageTokens(width, height) {
  let w = Math.max(0, Number(width) || 0);
  let h = Math.max(0, Number(height) || 0);
  if (w === 0 || h === 0) return 0;
  if (w <= 40 && h <= 40) return 0;

  if (w <= 512 && h <= 512) return 255;

  if (w > 2048 || h > 2048) {
    const scale = 2048 / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const minSide = Math.min(w, h);
  if (minSide > 768) {
    const scale = 768 / minSide;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const tilesX = Math.ceil(w / 512);
  const tilesY = Math.ceil(h / 512);
  return 85 + (tilesX * tilesY * 170);
}

function detectActiveModel(doc = document) {
  if (!doc) return { name: '', ceiling: 1000000 };
  const trigger = doc.querySelector?.('[data-testid=model-selector-trigger], [data-agpa-footer-model]');
  const rawName = trigger?.querySelector?.(':scope > span:not([data-agpa-model-ui])')?.textContent ||
    trigger?.textContent || '';
  const cleanName = rawName.trim().replace(/\s+/g, ' ');
  const lower = cleanName.toLowerCase();

  // 1. OpenAI: GPT-OSS 120B (128k)
  if (lower.includes('gpt-oss') || lower.includes('120b') || (lower.includes('gpt') && lower.includes('oss'))) {
    return { name: cleanName || 'GPT-OSS 120B', ceiling: 128000 };
  }

  // 2. Claude: Sonnet 4.6 & Opus 4.6 (1M context window)
  if (lower.includes('sonnet') || lower.includes('opus') || lower.includes('claude')) {
    return { name: cleanName || 'Claude 4.6', ceiling: 1000000 };
  }

  // 3. Google Gemini: Gemini 4 Carbon, Gemini 4 Argon, Gemini 3.8 Flash (all Gemini >= 3 have 1M)
  if (lower.includes('gemini') || lower.includes('carbon') || lower.includes('argon')) {
    return { name: cleanName || 'Gemini', ceiling: 1000000 };
  }

  // Default to 1M (standard context window for current Antigravity models)
  return { name: cleanName, ceiling: 1000000 };
}

function estimateTokens(chars, turns, imageTokens = 0) {
  const textTokens = Math.round((Number(chars) || 0) / 4);
  const turnOverhead = (Number(turns) || 0) * 120;
  const imgTokens = Math.max(0, Number(imageTokens) || 0);
  return Math.max(0, textTokens + turnOverhead + imgTokens);
}

function budgetLevelFor(tokens, ceiling = 1000000) {
  const count = Number(tokens) || 0;
  const max = Math.max(1000, Number(ceiling) || 1000000);
  const healthyThreshold = Math.round(max * 0.175);
  const moderateThreshold = Math.round(max * 0.425);
  const elevatedThreshold = Math.round(max * 0.80);

  const percentage = Math.min(100, Math.round((count / max) * 100));

  if (count < healthyThreshold) {
    return { level: 'healthy', color: '#6ba9ff', label: 'Healthy', percentage, ceiling: max };
  }
  if (count < moderateThreshold) {
    return { level: 'moderate', color: '#41c878', label: 'Moderate', percentage, ceiling: max };
  }
  if (count < elevatedThreshold) {
    return { level: 'elevated', color: '#ffd647', label: 'Elevated', percentage, ceiling: max };
  }
  return { level: 'saturated', color: '#ff666a', label: 'Saturated', percentage, ceiling: max };
}

function formatTokens(tokens) {
  const count = Number(tokens) || 0;
  if (count < 1000) return String(count);
  const k = Math.round(count / 1000);
  if (k >= 1000) {
    const m = (count / 1000000).toFixed(k % 1000 === 0 ? 0 : 1);
    return `~${m}M`;
  }
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

function collectImages(doc) {
  const images = [];
  if (!doc) return images;
  const vp = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]');
  if (!vp) return images;

  const imgElements = vp.querySelectorAll?.('img') || [];
  for (const img of imgElements) {
    if (img.closest?.('[data-agpa-context-ui], [data-agpa-team-ui], [data-testid*="avatar"], .avatar')) {
      continue;
    }
    const src = img.currentSrc || img.src || img.getAttribute?.('src') || '';
    const alt = img.getAttribute?.('alt') || '';
    if (!src && !alt) continue;

    const w = img.naturalWidth || img.width || parseInt(img.getAttribute?.('width'), 10) || 0;
    const h = img.naturalHeight || img.height || parseInt(img.getAttribute?.('height'), 10) || 0;

    if (w > 0 && h > 0 && w <= 40 && h <= 40) continue;

    const key = src ? (src.length > 120 ? src.slice(0, 80) + ':' + src.length : src) : 'alt:' + alt;
    const tokens = (w > 0 && h > 0) ? estimateImageTokens(w, h) : 258;
    images.push({ key, tokens, width: w, height: h });
  }
  return images;
}

function extractConversationStats(doc = document) {
  if (!doc) return { chars: 0, turns: 0, imageTokens: 0, imageCount: 0, tokens: 0, ceiling: 1000000, modelName: '', budget: budgetLevelFor(0, 1000000), formatted: '0' };
  const convKey = getConversationKey(doc);

  let entry = conversationCache.get(convKey);
  if (!entry) {
    if (conversationCache.size > 100) {
      const oldest = conversationCache.keys().next().value;
      conversationCache.delete(oldest);
    }
    entry = { blocks: new Map(), images: new Map(), maxChars: 0, maxTurns: 0, maxImageTokens: 0 };
    conversationCache.set(convKey, entry);
  }
  if (!entry.images) entry.images = new Map();
  if (typeof entry.maxImageTokens !== 'number') entry.maxImageTokens = 0;

  const viewport = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]');

  // Check if conversation was compacted (without traversing doc.body.textContent)
  const isCompacted = Boolean(
    doc.querySelector?.('[data-testid*="compact"], [data-testid*="compaction"]') ||
    viewport?.querySelector?.('[class*="compact"], [data-testid*="step"]')?.textContent?.includes('Conversation compacted')
  );
  if (isCompacted && entry.compacted !== true) {
    entry.blocks.clear();
    entry.images.clear();
    entry.maxChars = 0;
    entry.maxTurns = 0;
    entry.maxImageTokens = 0;
    entry.compacted = true;
  }

  // Discover newly mounted turn blocks in viewport
  const currentBlocks = collectTurnBlocks(doc);
  for (const b of currentBlocks) {
    entry.blocks.set(b.key, b.length);
  }

  // Discover newly mounted images in viewport
  const currentImages = collectImages(doc);
  for (const img of currentImages) {
    entry.images.set(img.key, img.tokens);
  }

  let blockSum = 0;
  for (const len of entry.blocks.values()) blockSum += len;

  let imageSum = 0;
  for (const t of entry.images.values()) imageSum += t;
  const imageTokens = Math.max(imageSum, entry.maxImageTokens);
  entry.maxImageTokens = imageTokens;
  const imageCount = entry.images.size;

  let currentChars = 0;
  if (viewport) {
    currentChars = viewport.textContent?.length || 0;
    if (!doc.querySelector?.('[data-testid=autoscroll-viewport]')) {
      const composer = viewport.querySelector?.('.surface-composer, [data-testid=agent-input-box]');
      if (composer) currentChars = Math.max(0, currentChars - (composer.textContent?.length || 0));
    }
  }

  const chars = Math.max(blockSum, currentChars, entry.maxChars);
  entry.maxChars = chars;

  const navTurns = countTurns(doc);
  const turns = Math.max(entry.blocks.size, navTurns, entry.maxTurns);
  entry.maxTurns = turns;

  const activeModel = detectActiveModel(doc);
  const ceiling = activeModel.ceiling;

  const estimateFn = typeof estimateTokens === 'function' ? estimateTokens : (this?.estimateTokens || estimateTokens);
  const budgetFn = typeof budgetLevelFor === 'function' ? budgetLevelFor : (this?.budgetLevelFor || budgetLevelFor);
  const formatFn = typeof formatTokens === 'function' ? formatTokens : (this?.formatTokens || formatTokens);

  const tokens = estimateFn(chars, turns, imageTokens);
  const budget = budgetFn(tokens, ceiling);
  return {
    chars,
    turns,
    imageTokens,
    imageCount,
    tokens,
    ceiling,
    modelName: activeModel.name,
    budget,
    formatted: formatFn(tokens)
  };
}

function clearCache(key) {
  if (key) conversationCache.delete(key);
  else conversationCache.clear();
}

module.exports = {
  estimateTokens,
  estimateImageTokens,
  detectActiveModel,
  budgetLevelFor,
  formatTokens,
  countTurns,
  getConversationKey,
  collectTurnBlocks,
  collectImages,
  extractConversationStats,
  clearCache
};
