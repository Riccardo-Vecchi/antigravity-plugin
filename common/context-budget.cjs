'use strict';

const conversationCache = new Map();

function getStorage(doc) {
  try {
    if (doc?.defaultView?.localStorage) return doc.defaultView.localStorage;
  } catch {}
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  } catch {}
  return null;
}

function saveConversationState(convKey, data, storage) {
  if (!convKey || !data) return false;
  try {
    const store = storage !== undefined ? storage : getStorage();
    if (store && typeof store.setItem === 'function') {
      const key = 'agpa_context_budget_' + convKey;
      store.setItem(key, JSON.stringify(data));
      return true;
    }
  } catch {}
  return false;
}

function loadConversationState(convKey, storage) {
  if (!convKey) return null;
  try {
    const store = storage !== undefined ? storage : getStorage();
    if (store && typeof store.getItem === 'function') {
      const key = 'agpa_context_budget_' + convKey;
      const raw = store.getItem(key);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return null;
}

function clearConversationState(convKey, storage) {
  try {
    const store = storage !== undefined ? storage : getStorage();
    if (store && typeof store.removeItem === 'function') {
      if (convKey) {
        store.removeItem('agpa_context_budget_' + convKey);
      } else if (typeof store.length === 'number') {
        const toRemove = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key?.(i);
          if (k && k.startsWith('agpa_context_budget_')) toRemove.push(k);
        }
        for (const k of toRemove) store.removeItem(k);
      }
      return true;
    }
  } catch {}
  return false;
}

function hydrateFromTranscript(convKey, data, storage) {
  if (!convKey || !data) return false;
  const store = storage !== undefined ? storage : getStorage();
  let entry = conversationCache.get(convKey);
  if (!entry) {
    entry = {
      blocks: new Map(),
      images: new Map(),
      documents: new Map(),
      maxChars: 0,
      maxCodeChars: 0,
      maxTurns: 0,
      maxImageTokens: 0,
      maxDocTokens: 0,
      systemTokens: 1500,
      systemBaseline: null,
      apiTokens: 0
    };
    conversationCache.set(convKey, entry);
  }

  if (Array.isArray(data.blocks)) {
    for (const [k, v] of data.blocks) {
      if (!entry.blocks.has(k)) {
        entry.blocks.set(k, typeof v === 'number' ? { length: v, codeChars: 0 } : v);
      }
    }
  }

  if (Array.isArray(data.images)) {
    for (const [k, tokens] of data.images) {
      if (!entry.images.has(k)) {
        entry.images.set(k, tokens);
      }
    }
  }

  entry.maxChars = Math.max(entry.maxChars, data.maxChars || 0);
  entry.maxCodeChars = Math.max(entry.maxCodeChars || 0, data.maxCodeChars || 0);
  entry.maxTurns = Math.max(entry.maxTurns, data.maxTurns || 0);
  entry.maxImageTokens = Math.max(entry.maxImageTokens, data.maxImageTokens || 0);
  if (data.apiTokens && typeof data.apiTokens === 'number') {
    entry.apiTokens = Math.max(entry.apiTokens || 0, data.apiTokens);
  }
  entry.updatedAt = Date.now();

  saveConversationState(convKey, {
    blocks: Array.from(entry.blocks.entries()),
    images: Array.from(entry.images.entries()),
    documents: Array.from(entry.documents.entries()),
    maxChars: entry.maxChars,
    maxCodeChars: entry.maxCodeChars,
    maxTurns: entry.maxTurns,
    maxImageTokens: entry.maxImageTokens,
    maxDocTokens: entry.maxDocTokens,
    systemTokens: entry.systemTokens,
    systemBaseline: entry.systemBaseline,
    apiTokens: entry.apiTokens || null,
    ceiling: entry.ceiling,
    modelName: entry.modelName,
    updatedAt: entry.updatedAt
  }, store);

  return true;
}


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

function estimateAttachmentTokens(meta = {}) {
  const name = String(meta.name || '').toLowerCase();
  const pages = Math.max(0, Number(meta.pages) || 0);
  const sizeKb = Math.max(0, Number(meta.sizeKb) || 0);

  // Ignore image extensions, handled by estimateImageTokens
  if (/\.(png|jpe?g|webp|gif|svg|bmp|ico)\b/i.test(name)) return 0;

  // PDF handling (multimodal vision rate per page: 258 tokens/page)
  if (/\.pdf\b/i.test(name)) {
    if (pages > 0) return pages * 258;
    if (sizeKb > 0) {
      const estimatedPages = Math.min(100, Math.max(1, Math.round(sizeKb / 60)));
      return estimatedPages * 258;
    }
    return 774; // default ~3 pages
  }

  // Text-based documents (CSV, JSON, TXT, LOG, MD, PY, JS, HTML, etc.)
  if (sizeKb > 0) {
    if (/\.(csv|tsv|json|txt|log|md|py|js|ts|html|xml|yaml|yml|sh)\b/i.test(name)) {
      return Math.round((sizeKb * 1024) / 4);
    }
    // Generic documents (DOCX, XLSX, etc.): compressed format
    return Math.min(15000, Math.max(258, Math.round((sizeKb * 1024) / 8)));
  }

  if (pages > 0) return pages * 258;
  return 500;
}

function parseAttachmentInfo(el) {
  if (!el) return null;
  const text = el.textContent || '';
  const attrName = el.getAttribute?.('data-filename') || el.getAttribute?.('title') || el.getAttribute?.('aria-label') || '';
  const nameEl = el.querySelector?.('[data-testid*="name"], [class*="name"], [class*="filename"], [class*="title"]');
  const rawName = (nameEl ? nameEl.textContent : attrName).trim();
  const fileMatch = (rawName || text).match(/\b([\w\-.]+\.[a-zA-Z0-9]{1,8})\b/);
  const name = fileMatch ? fileMatch[1] : (rawName || text.slice(0, 40).trim());

  if (/\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(name)) return null;

  const pageMatch = text.match(/\b(\d+)\s*(?:pages?|pagine?|pag\.|p\.)\b/i);
  const pages = pageMatch ? parseInt(pageMatch[1], 10) : 0;

  const sizeMatch = text.match(/\b([\d.]+)\s*(KB|MB)\b/i);
  let sizeKb = 0;
  if (sizeMatch) {
    const val = parseFloat(sizeMatch[1]);
    sizeKb = sizeMatch[2].toUpperCase() === 'MB' ? val * 1024 : val;
  }

  const tokens = estimateAttachmentTokens({ name, pages, sizeKb });
  const key = `doc:${name}:${pages}p:${sizeKb}kb`;
  return { key, name, pages, sizeKb, tokens };
}

function collectAttachments(doc) {
  const attachments = [];
  if (!doc) return attachments;
  const root = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]') || doc.body || doc;
  if (!root) return attachments;

  const selector = '[data-testid*="attachment"], [data-testid*="file-pill"], [data-testid*="document"], [class*="attachment"], [class*="file-chip"], [class*="file-card"], [class*="document-chip"], a[download]';
  const nodes = (root.querySelectorAll ? root.querySelectorAll(selector) : (doc.querySelectorAll ? doc.querySelectorAll(selector) : [])) || [];

  const seen = new Set();
  for (const node of nodes) {
    if (node.closest?.('[data-agpa-context-ui], [data-agpa-team-ui]')) continue;
    if (node.parentElement?.closest?.('[data-testid*="attachment"], [class*="attachment"], [class*="file-chip"], [class*="document-chip"]')) continue;
    const info = parseAttachmentInfo(node);
    if (info && info.tokens > 0 && !seen.has(info.key)) {
      seen.add(info.key);
      attachments.push(info);
    }
  }
  return attachments;
}

function parseToolCountFromText(text) {
  if (!text) return 0;
  const match = text.match(/\b(\d+)\s*(?:active\s+)?tools?\b/i) || text.match(/\btools?:\s*(\d+)\b/i);
  return match ? parseInt(match[1], 10) : 0;
}

function parseMcpCountFromText(text) {
  if (!text) return 0;
  const match = text.match(/\b(\d+)\s*mcp(?:\s+servers?)?\b/i) || text.match(/\bmcp(?:\s+servers?)?:\s*(\d+)\b/i);
  return match ? parseInt(match[1], 10) : 0;
}

function parseRuleCountFromText(text) {
  if (!text) return 0;
  const match = text.match(/\b(\d+)\s*(?:workspace\s+)?rules?\b/i) ||
                text.match(/\brules?:\s*(\d+)\b/i) ||
                text.match(/\b(\d+)\s*(?:custom\s+)?instructions?\b/i);
  return match ? parseInt(match[1], 10) : 0;
}

function estimateSystemBaseline(doc = document) {
  if (!doc) return { toolsCount: 0, mcpCount: 0, rulesCount: 0, baseTokens: 0, toolTokens: 0, ruleTokens: 0, tokens: 0 };

  const root = doc.body || doc;

  let toolsCount = 0;
  let mcpCount = 0;
  let rulesCount = 0;

  // 1. Scan control containers (composer, footer, toolbars)
  const controlContainers = root.querySelectorAll?.('.surface-composer, [data-testid*="composer"], [data-testid*="footer"], [data-testid*="toolbar"], [class*="toolbar"]') || [];
  for (const c of controlContainers) {
    if (c.closest?.('[data-agpa-context-ui], [data-agpa-team-ui]')) continue;
    const txt = c.textContent || '';
    const tc = parseToolCountFromText(txt);
    if (tc > toolsCount) toolsCount = tc;
    const mc = parseMcpCountFromText(txt);
    if (mc > mcpCount) mcpCount = mc;
    const rc = parseRuleCountFromText(txt);
    if (rc > rulesCount) rulesCount = rc;
  }

  // 2. Scan individual tool nodes
  const toolNodes = root.querySelectorAll?.(
    '[data-testid*="tool-item"], [data-testid*="mcp-tool"], [data-testid*="agent-tool"], [class*="tool-item"], [class*="tool-chip"], [class*="mcp-tool"]'
  ) || [];
  let domToolCount = 0;
  for (const node of toolNodes) {
    if (node.closest?.('[data-agpa-context-ui], [data-agpa-team-ui]')) continue;
    domToolCount++;
  }
  if (domToolCount > toolsCount) toolsCount = domToolCount;

  // 3. Scan MCP servers
  const mcpNodes = root.querySelectorAll?.(
    '[data-testid*="mcp-server"], [data-testid*="mcp-entry"], [class*="mcp-server"], [class*="mcp-entry"]'
  ) || [];
  let domMcpCount = 0;
  for (const node of mcpNodes) {
    if (node.closest?.('[data-agpa-context-ui], [data-agpa-team-ui]')) continue;
    domMcpCount++;
  }
  if (domMcpCount > mcpCount) mcpCount = domMcpCount;

  // 4. Scan rules
  const ruleNodes = root.querySelectorAll?.(
    '[data-testid*="rule-item"], [data-testid*="rule-chip"], [data-testid*="workspace-rule"], [class*="rule-item"], [class*="rule-chip"], [class*="instruction-pill"]'
  ) || [];
  let domRuleCount = 0;
  for (const node of ruleNodes) {
    if (node.closest?.('[data-agpa-context-ui], [data-agpa-team-ui]')) continue;
    domRuleCount++;
  }
  if (domRuleCount > rulesCount) rulesCount = domRuleCount;

  const hasSystemSignal = toolsCount > 0 || mcpCount > 0 || rulesCount > 0 || Boolean(
    root.querySelector?.('[data-testid*="system"], [data-testid*="agent-mode"], [data-testid*="agent-status"]')
  );

  if (!hasSystemSignal) {
    return { toolsCount: 0, mcpCount: 0, rulesCount: 0, baseTokens: 0, toolTokens: 0, ruleTokens: 0, tokens: 0 };
  }

  const baseTokens = 1500;
  const toolTokens = toolsCount > 0 ? (toolsCount * 180) : (mcpCount * 600);
  const ruleTokens = rulesCount * 350;
  const totalTokens = Math.min(25000, baseTokens + toolTokens + ruleTokens);

  return {
    toolsCount,
    mcpCount,
    rulesCount,
    baseTokens,
    toolTokens,
    ruleTokens,
    tokens: totalTokens
  };
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

function estimateTokens(chars, turns, imageTokens = 0, codeChars = 0, docTokens = 0, systemTokens = 0) {
  const totalChars = Math.max(0, Number(chars) || 0);
  const code = Math.min(totalChars, Math.max(0, Number(codeChars) || 0));
  const prose = Math.max(0, totalChars - code);
  const proseTokens = Math.round(prose / 4);
  const codeTokens = Math.round(code / 2.8);
  const turnOverhead = (Number(turns) || 0) * 120;
  const imgTokens = Math.max(0, Number(imageTokens) || 0);
  const dTokens = Math.max(0, Number(docTokens) || 0);
  const sysTokens = Math.max(0, Number(systemTokens) || 0);
  return Math.max(0, proseTokens + codeTokens + turnOverhead + imgTokens + dTokens + sysTokens);
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
  if (!doc) return 'default';

  // 1. Check URL pathname (e.g. /c/01ed90cd-c026-4190-bfd8-5bb6444c0719)
  const loc = doc?.defaultView?.location || globalThis?.location || doc?.location;
  const path = loc?.pathname || '';
  if (path.startsWith('/c/')) return path;
  const matchPath = path.match(/\/c\/[a-zA-Z0-9_-]+/);
  if (matchPath) return matchPath[0];

  // 2. Check URL hash (e.g. #/c/01ed90cd-c026-4190-bfd8-5bb6444c0719)
  const hash = loc?.hash || '';
  if (hash.includes('/c/')) {
    const matchHash = hash.match(/\/c\/[a-zA-Z0-9_-]+/);
    if (matchHash) return matchHash[0];
  }

  // 3. Check URL query parameters (e.g. ?conversation=... or ?c=... or ?id=...)
  const search = loc?.search || '';
  if (search) {
    try {
      const params = new URLSearchParams(search);
      const cId = params.get('c') || params.get('conversation') || params.get('conversationId') || params.get('id');
      if (cId) return '/c/' + cId;
    } catch {}
  }

  // 4. Check selected conversation row in Antigravity's sidebar
  const selectedRow = doc.querySelector?.(
    '[data-testid="conversation-row-sidebar"][data-selected="true"], [data-testid*="conversation-item"][data-selected="true"], [data-testid*="conversation-row"][aria-selected="true"], [class*="conversation-row"][data-selected="true"]'
  );
  if (selectedRow) {
    const rowId = selectedRow.getAttribute('data-conversation-id') || selectedRow.getAttribute('data-id');
    if (rowId) return '/c/' + rowId;
    const rowLink = selectedRow.querySelector?.('a[href*="/c/"]')?.getAttribute('href');
    if (rowLink) {
      const match = rowLink.match(/\/c\/[a-zA-Z0-9_-]+/);
      if (match) return match[0];
    }
    const rowTitle = selectedRow.textContent?.trim()?.slice(0, 60);
    if (rowTitle) return 'conv:' + rowTitle;
  }

  // 5. Check conversation container
  const convView = doc.querySelector?.('[data-testid="conversation-view"], [data-testid="autoscroll-viewport"]');
  const viewId = convView?.getAttribute('data-conversation-id') || convView?.getAttribute('data-id');
  if (viewId) return '/c/' + viewId;

  // 6. Check first user turn prompt
  const firstPrompt = doc.querySelector?.('[data-testid=autoscroll-viewport] [data-testid=user-input-step]')?.textContent?.trim()?.slice(0, 50);
  if (firstPrompt) return 'conv:' + firstPrompt;

  if (path && path !== '/' && !path.endsWith('.html')) return path;
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

      let codeChars = 0;
      const codeNodes = item.querySelectorAll?.('pre, [data-testid*="code-block"], [class*="code-block"]') || [];
      for (const node of codeNodes) {
        if (node.parentElement?.closest?.('pre, [data-testid*="code-block"], [class*="code-block"]')) {
          continue;
        }
        codeChars += node.textContent?.length || 0;
      }
      codeChars = Math.min(text.length, codeChars);

      blocks.push({ key, length: text.length, codeChars });
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

function extractConversationStats(doc = document, storage = undefined) {
  if (!doc) return { chars: 0, codeChars: 0, turns: 0, imageTokens: 0, imageCount: 0, docTokens: 0, docCount: 0, systemTokens: 0, systemBaseline: null, tokens: 0, ceiling: 1000000, modelName: '', budget: budgetLevelFor(0, 1000000), formatted: '0' };
  const convKey = getConversationKey(doc);
  const store = storage !== undefined ? storage : getStorage(doc);

  let entry = conversationCache.get(convKey);
  if (!entry) {
    const stored = loadConversationState(convKey, store);
    if (stored) {
      entry = {
        blocks: new Map(stored.blocks || []),
        images: new Map(stored.images || []),
        documents: new Map(stored.documents || []),
        maxChars: stored.maxChars || 0,
        maxCodeChars: stored.maxCodeChars || 0,
        maxTurns: stored.maxTurns || 0,
        maxImageTokens: stored.maxImageTokens || 0,
        maxDocTokens: stored.maxDocTokens || 0,
        systemTokens: stored.systemTokens || 0,
        systemBaseline: stored.systemBaseline || null,
        apiTokens: stored.apiTokens || 0,
        ceiling: stored.ceiling || 1000000,
        modelName: stored.modelName || '',
        updatedAt: stored.updatedAt || Date.now()
      };
      conversationCache.set(convKey, entry);
    }
  }

  if (!entry) {
    if (conversationCache.size > 100) {
      const oldest = conversationCache.keys().next().value;
      conversationCache.delete(oldest);
    }
    entry = { blocks: new Map(), images: new Map(), documents: new Map(), maxChars: 0, maxCodeChars: 0, maxTurns: 0, maxImageTokens: 0, maxDocTokens: 0, systemTokens: 0, systemBaseline: null };
    conversationCache.set(convKey, entry);
  }
  if (!entry.images) entry.images = new Map();
  if (!entry.documents) entry.documents = new Map();
  if (typeof entry.maxImageTokens !== 'number') entry.maxImageTokens = 0;
  if (typeof entry.maxDocTokens !== 'number') entry.maxDocTokens = 0;
  if (typeof entry.maxCodeChars !== 'number') entry.maxCodeChars = 0;

  const viewport = doc.querySelector?.('[data-testid=autoscroll-viewport]') || doc.querySelector?.('[data-testid=conversation-view]');

  // Check if conversation was compacted (without traversing doc.body.textContent)
  const isCompacted = Boolean(
    doc.querySelector?.('[data-testid*="compact"], [data-testid*="compaction"]') ||
    viewport?.querySelector?.('[class*="compact"], [data-testid*="step"]')?.textContent?.includes('Conversation compacted')
  );
  if (isCompacted && entry.compacted !== true) {
    entry.blocks.clear();
    entry.images.clear();
    entry.documents.clear();
    entry.maxChars = 0;
    entry.maxCodeChars = 0;
    entry.maxTurns = 0;
    entry.maxImageTokens = 0;
    entry.maxDocTokens = 0;
    entry.compacted = true;
    clearConversationState(convKey, store);
  }

  // Discover newly mounted turn blocks in viewport
  const currentBlocks = collectTurnBlocks(doc);
  for (const b of currentBlocks) {
    entry.blocks.set(b.key, { length: b.length, codeChars: b.codeChars || 0 });
  }

  // Discover newly mounted images in viewport
  const currentImages = collectImages(doc);
  for (const img of currentImages) {
    entry.images.set(img.key, img.tokens);
  }

  // Discover newly mounted documents in viewport/chat
  const currentDocs = collectAttachments(doc);
  for (const d of currentDocs) {
    entry.documents.set(d.key, d.tokens);
  }

  let blockSum = 0;
  let codeSum = 0;
  for (const blockVal of entry.blocks.values()) {
    const len = typeof blockVal === 'number' ? blockVal : (blockVal?.length || 0);
    const code = typeof blockVal === 'object' ? (blockVal?.codeChars || 0) : 0;
    blockSum += len;
    codeSum += code;
  }

  let imageSum = 0;
  for (const t of entry.images.values()) imageSum += t;
  const imageTokens = Math.max(imageSum, entry.maxImageTokens);
  entry.maxImageTokens = imageTokens;
  const imageCount = entry.images.size;

  let docSum = 0;
  for (const t of entry.documents.values()) docSum += t;
  const docTokens = Math.max(docSum, entry.maxDocTokens);
  entry.maxDocTokens = docTokens;
  const docCount = entry.documents.size;

  let currentChars = 0;
  if (viewport) {
    currentChars = viewport.textContent?.length || 0;
    if (!doc.querySelector?.('[data-testid=autoscroll-viewport]')) {
      const composer = viewport.querySelector?.('.surface-composer, [data-testid=agent-input-box]');
      if (composer) currentChars = Math.max(0, currentChars - (composer.textContent?.length || 0));
    }
  }

  const navTurns = countTurns(doc);
  const turns = Math.max(entry.blocks.size, navTurns, entry.maxTurns);
  entry.maxTurns = turns;

  let chars = Math.max(blockSum, currentChars, entry.maxChars);
  let codeChars = Math.max(codeSum, entry.maxCodeChars || 0);

  // Proportional projection for unhydrated conversations (navTurns > mountedBlocks)
  const mountedBlocksCount = entry.blocks.size;
  if (navTurns > mountedBlocksCount && mountedBlocksCount > 0 && entry.maxChars <= blockSum) {
    const avgCharsPerBlock = blockSum / mountedBlocksCount;
    const projectedChars = Math.round(avgCharsPerBlock * navTurns);
    if (projectedChars > chars) {
      chars = projectedChars;
      if (codeSum > 0) {
        const avgCodePerBlock = codeSum / mountedBlocksCount;
        codeChars = Math.min(chars, Math.round(avgCodePerBlock * navTurns));
      }
    }
  }

  entry.maxChars = chars;
  entry.maxCodeChars = codeChars;

  const activeModel = detectActiveModel(doc);
  const ceiling = activeModel.name ? activeModel.ceiling : (entry.ceiling || activeModel.ceiling);
  const modelName = activeModel.name || entry.modelName || '';

  const systemBaselineRaw = estimateSystemBaseline(doc);
  const systemBaseline = (systemBaselineRaw && systemBaselineRaw.tokens > 0) ? systemBaselineRaw : (entry.systemBaseline || systemBaselineRaw);
  const systemTokens = Math.max(systemBaselineRaw?.tokens || 0, entry.systemTokens || 0);
  entry.systemTokens = systemTokens;
  entry.systemBaseline = systemBaseline;

  if (chars > 0 || turns > 0 || imageTokens > 0 || docTokens > 0 || systemTokens > 0) {
    saveConversationState(convKey, {
      blocks: [...entry.blocks.entries()],
      images: [...entry.images.entries()],
      documents: [...entry.documents.entries()],
      maxChars: entry.maxChars,
      maxCodeChars: entry.maxCodeChars,
      maxTurns: entry.maxTurns,
      maxImageTokens: entry.maxImageTokens,
      maxDocTokens: entry.maxDocTokens,
      systemTokens,
      systemBaseline,
      ceiling,
      modelName,
      updatedAt: Date.now()
    }, store);
  }

  const estimateFn = typeof estimateTokens === 'function' ? estimateTokens : (this?.estimateTokens || estimateTokens);
  const budgetFn = typeof budgetLevelFor === 'function' ? budgetLevelFor : (this?.budgetLevelFor || budgetLevelFor);
  const formatFn = typeof formatTokens === 'function' ? formatTokens : (this?.formatTokens || formatTokens);

  let tokens = estimateFn(chars, turns, imageTokens, codeChars, docTokens, systemTokens);
  if (entry.apiTokens && entry.apiTokens > tokens) {
    tokens = entry.apiTokens;
  }
  const budget = budgetFn(tokens, ceiling);
  return {
    chars,
    codeChars,
    turns,
    imageTokens,
    imageCount,
    docTokens,
    docCount,
    systemTokens,
    systemBaseline,
    tokens,
    ceiling,
    modelName,
    budget,
    formatted: formatFn(tokens)
  };
}

function clearCache(key, storage) {
  if (key) {
    conversationCache.delete(key);
    clearConversationState(key, storage);
  } else {
    conversationCache.clear();
    clearConversationState(null, storage);
  }
}

module.exports = {
  estimateTokens,
  estimateImageTokens,
  estimateAttachmentTokens,
  estimateSystemBaseline,
  parseToolCountFromText,
  parseMcpCountFromText,
  parseRuleCountFromText,
  parseAttachmentInfo,
  collectAttachments,
  detectActiveModel,
  budgetLevelFor,
  formatTokens,
  countTurns,
  getConversationKey,
  collectTurnBlocks,
  collectImages,
  extractConversationStats,
  saveConversationState,
  hydrateFromTranscript,
  loadConversationState,
  clearConversationState,
  clearCache
};
