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
  if (convKey === 'default') {
    try {
      const store = storage !== undefined ? storage : getStorage();
      store?.removeItem?.('agpa_context_budget_default');
    } catch {}
    return null;
  }
  try {
    const store = storage !== undefined ? storage : getStorage();
    if (store && typeof store.getItem === 'function') {
      const key = 'agpa_context_budget_' + convKey;
      const raw = store.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.apiTokens && parsed.transcriptTurns && parsed.maxTurns > parsed.transcriptTurns) {
            parsed.maxTurns = parsed.transcriptTurns + (parsed.pendingTurns || 0);
          }
          if (parsed.apiTokens && parsed.transcriptChars && parsed.maxChars > parsed.transcriptChars * 1.1) {
            parsed.maxChars = parsed.transcriptChars + (parsed.pendingChars || 0);
          }
          if (parsed.apiTokens && Array.isArray(parsed.images)) {
            const hasFileImages = parsed.images.some(([k]) => typeof k === 'string' && !k.startsWith('data:') && !k.startsWith('blob:'));
            if (hasFileImages) {
              parsed.images = parsed.images.filter(([k]) => typeof k === 'string' && !k.startsWith('data:') && !k.startsWith('blob:'));
              let sum = 0;
              for (const [, tok] of parsed.images) sum += (typeof tok === 'number' ? tok : 0);
              parsed.maxImageTokens = sum;
            }
          }
        }
        return parsed;
      }
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
      apiTokens: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      mtime: 0,
      pendingChars: 0,
      pendingCodeChars: 0,
      pendingTurns: 0,
      transcriptChars: 0,
    };
    conversationCache.set(convKey, entry);
  }

  if (Array.isArray(data.blocks)) {
    entry.blocks.clear();
    for (const [k, v] of data.blocks) {
      entry.blocks.set(k, typeof v === 'number' ? { length: v, codeChars: 0 } : v);
    }
  }

  if (Array.isArray(data.images)) {
    entry.images.clear();
    for (const [k, tokens] of data.images) {
      entry.images.set(k, tokens);
    }
  }

  entry.maxChars = data.maxChars || entry.maxChars || 0;
  entry.maxCodeChars = data.maxCodeChars || entry.maxCodeChars || 0;
  entry.maxTurns = data.maxTurns || entry.maxTurns || 0;
  entry.maxImageTokens = data.maxImageTokens || 0;
  if (data.apiTokens && typeof data.apiTokens === 'number') {
    entry.apiTokens = data.apiTokens;
  }
  entry.inputTokens = typeof data.inputTokens === 'number' ? data.inputTokens : (entry.inputTokens || 0);
  entry.cacheReadTokens = typeof data.cacheReadTokens === 'number' ? data.cacheReadTokens : (entry.cacheReadTokens || 0);
  entry.outputTokens = typeof data.outputTokens === 'number' ? data.outputTokens : (entry.outputTokens || 0);
  entry.mtime = typeof data.mtime === 'number' ? data.mtime : (entry.mtime || 0);
  entry.pendingChars = data.pendingChars || 0;
  entry.pendingCodeChars = data.pendingCodeChars || 0;
  entry.pendingTurns = data.pendingTurns || 0;
  entry.transcriptChars = data.maxChars || entry.maxChars || 0;
  entry.transcriptTurns = data.maxTurns || entry.maxTurns || 0;
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
    inputTokens: entry.inputTokens || 0,
    cacheReadTokens: entry.cacheReadTokens || 0,
    outputTokens: entry.outputTokens || 0,
    mtime: entry.mtime || 0,
    pendingChars: entry.pendingChars || 0,
    pendingCodeChars: entry.pendingCodeChars || 0,
    pendingTurns: entry.pendingTurns || 0,
    transcriptChars: entry.transcriptChars || 0,
    transcriptTurns: entry.transcriptTurns || 0,
    ceiling: entry.ceiling,
    modelName: entry.modelName,
    updatedAt: entry.updatedAt
  }, store);

  return true;
}

function estimateImageTokens(width, height, modelFamilyOrName = '') {
  let w = Math.max(0, Number(width) || 0);
  let h = Math.max(0, Number(height) || 0);
  if (w === 0 || h === 0) return 0;
  if (w <= 40 && h <= 40) return 0;

  const model = String(modelFamilyOrName || '').toLowerCase();
  // 1. Google Gemini (Flash, Carbon, Argon, Pro): 258 tokens per image/tile
  if (model.includes('gemini') || model.includes('carbon') || model.includes('argon')) {
    return 258;
  }

  // 2. Anthropic Claude: (width * height) / 750 (with max 1568px bounding constraint)
  if (model.includes('claude') || model.includes('sonnet') || model.includes('opus')) {
    let cw = w;
    let ch = h;
    const maxSide = Math.max(cw, ch);
    if (maxSide > 1568) {
      const scale = 1568 / maxSide;
      cw = Math.round(cw * scale);
      ch = Math.round(ch * scale);
    }
    const claudeTokens = Math.round((cw * ch) / 750);
    return Math.max(258, claudeTokens);
  }

  // 3. OpenAI / Default (Tile based 512x512)
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

  // Dynamic context ceiling check from label (e.g. "Claude 3.5 (200k)", "Gemini 1.5 Pro (2M)", "GPT-4o (128k)")
  const labelMatch = cleanName.match(/(?:^|\s|\(|\[)(\d+(?:\.\d+)?)\s*(k|m)\b/i);
  if (labelMatch) {
    const num = parseFloat(labelMatch[1]);
    const unit = labelMatch[2].toLowerCase();
    const dynamicCeiling = unit === 'm' ? Math.round(num * 1000000) : Math.round(num * 1000);
    if (dynamicCeiling >= 10000) {
      return { name: cleanName, ceiling: dynamicCeiling };
    }
  }

  // 1. OpenAI: GPT-OSS 120B (128k), GPT-4o (128k)
  if (lower.includes('gpt-oss') || lower.includes('120b') || (lower.includes('gpt') && lower.includes('oss')) || lower.includes('gpt-4')) {
    return { name: cleanName || 'GPT-OSS 120B', ceiling: 128000 };
  }

  // 2. Claude: Sonnet 5.5 & Opus 5.5 (1M context window)
  if (lower.includes('sonnet') || lower.includes('opus') || lower.includes('claude')) {
    return { name: cleanName || 'Claude 5.5', ceiling: 1000000 };
  }

  // 3. Google Gemini: Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro (all Gemini >= 3 have 1M)
  if (lower.includes('gemini') || lower.includes('carbon') || lower.includes('argon')) {
    return { name: cleanName || 'Gemini', ceiling: 1000000 };
  }

  // Default to 1M (standard context window for current Antigravity models)
  return { name: cleanName, ceiling: 1000000 };
}

// Antigravity's observed automatic compaction budget. Keep this scoped to
// known model generations and separate from the model's context capacity.
// Evidence and version scope are recorded in docs/CONTEXT_BUDGET.md.
function compactionThresholdFor(modelName, capacity) {
  const threshold = 256000;
  if (typeof modelName !== 'string' || !(capacity > threshold)) return null;
  const name = modelName.replace(/\s+(?:\((?:thinking|low|medium|high|extra|xhigh)\)|thinking|low|medium|high|extra|xhigh|[([]?\d+(?:\.\d+)?\s*[km][)\]]?)$/gi, '');
  const supported = /^(?:gemini 4 (?:argon|carbon|hydrogen)|claude (?:opus|sonnet) 5\.5|orchestrator \((?:argon|carbon)\))$/i;
  return supported.test(name) ? threshold : null;
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

function estimateTokensPrecise(text, modelFamilyOrName = 'gemini') {
  if (!text || typeof text !== 'string') return 0;
  const len = text.length;
  if (len === 0) return 0;

  const model = String(modelFamilyOrName || '').toLowerCase();
  const isClaude = /claude|sonnet|opus/i.test(model);
  const isGemini = /gemini|carbon|argon/i.test(model);

  // Model-specific calibrated token ratios
  const proseR = isClaude ? 3.6 : (isGemini ? 4.2 : 4.1);
  const codeR  = isClaude ? 2.6 : (isGemini ? 2.9 : 3.0);
  const jsonR  = isClaude ? 2.0 : (isGemini ? 2.2 : 2.3);
  const cjkR   = isClaude ? 0.8 : (isGemini ? 1.3 : 1.4);

  let tokenCount = 0;

  // 1. Fenced Code Blocks (```...```) with delimiter envelope (+3 tokens)
  let prose = text.replace(/```[\s\S]*?```/g, match => {
    const inner = match.slice(3, -3);
    tokenCount += Math.ceil(inner.length / codeR) + 3;
    return ' ';
  });

  // 2. Inline Code Spans (`...`) with envelope (+1 token)
  prose = prose.replace(/`[^`\n]+`/g, match => {
    tokenCount += Math.ceil((match.length - 2) / codeR) + 1;
    return ' ';
  });

  // 3. Structured JSON Payloads
  const trimmed = prose.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return tokenCount + Math.ceil(trimmed.length / jsonR);
    } catch {}
  }

  // 4. Multilingual & CJK Ideographs (Hanzi, Kana, Hangul, CJK punctuation & fullwidth forms)
  const cjkMatches = prose.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u3000-\u303f\uff00-\uffef]/g);
  if (cjkMatches) {
    tokenCount += Math.ceil(cjkMatches.length / cjkR);
    prose = prose.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u3000-\u303f\uff00-\uffef]/g, ' ');
  }

  // 5. Non-Latin Alphabets (Cyrillic, Greek, Arabic, Hebrew, Devanagari)
  // eslint-disable-next-line no-misleading-character-class
  const nonLatin = prose.match(/[\u0400-\u04ff\u0370-\u03ff\u0600-\u06ff\u0590-\u05ff\u0900-\u097f]/g);
  if (nonLatin) {
    tokenCount += Math.ceil(nonLatin.length / 2.2);
    // eslint-disable-next-line no-misleading-character-class
    prose = prose.replace(/[\u0400-\u04ff\u0370-\u03ff\u0600-\u06ff\u0590-\u05ff\u0900-\u097f]/g, ' ');
  }

  // 6. Number Sequences (3-digit grouping)
  const numbers = prose.match(/\b\d+\b/g);
  if (numbers) {
    for (const num of numbers) {
      tokenCount += Math.ceil(num.length / 3);
    }
    prose = prose.replace(/\b\d+\b/g, ' ');
  }

  // 7. Punctuation & Syntax Operators
  const punctRuns = prose.match(/[.,!?;:()[\]{}<>"'`~@#$%^&*+=|\\/-]+/g);
  if (punctRuns) {
    for (const pr of punctRuns) {
      tokenCount += pr.length === 1 ? 1 : Math.ceil(pr.length / 2);
    }
    prose = prose.replace(/[.,!?;:()[\]{}<>"'`~@#$%^&*+=|\\/-]+/g, ' ');
  }

  // 8. Indentation & Structural Whitespace
  const newlines = (text.match(/\n/g) || []).length;
  const indentMatches = text.match(/\n[ ]{2,}/g);
  let indentTokens = 0;
  if (indentMatches) {
    for (const ind of indentMatches) {
      indentTokens += Math.floor((ind.length - 1) / 4);
    }
  }
  tokenCount += Math.ceil(newlines * 0.75) + indentTokens;

  // 9. Standard Prose Words
  const words = prose.trim().split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w.length <= 4) {
      tokenCount += 1;
    } else if (w.length <= 8 && /^[a-z]+$/i.test(w)) {
      tokenCount += 1;
    } else {
      tokenCount += Math.ceil(w.length / proseR);
    }
  }

  return Math.max(1, tokenCount);
}

function calculateEffectiveTokens(entry, composerText = '', modelName = '') {
  if (!entry) return 0;
  const chars = entry.maxChars || 0;
  const turns = entry.maxTurns || 0;
  const codeChars = entry.maxCodeChars || 0;
  const imageTokens = entry.maxImageTokens || 0;
  const docTokens = entry.maxDocTokens || 0;
  const systemTokens = entry.systemTokens || 0;

  if (entry.apiTokens && entry.apiTokens > 0) {
    const baseline = entry.systemBaseline?.tokens || 0;
    const histChars = entry.transcriptChars || chars;
    const histCode = entry.maxCodeChars || 0;
    const histProse = Math.max(0, histChars - histCode);
    const histEstimate = Math.round(histProse / 4) + Math.round(histCode / 2.8) + (entry.maxImageTokens || 0) + (entry.maxDocTokens || 0);

    let kappa = 1.0;
    if (histEstimate > 0 && entry.apiTokens > baseline) {
      const netActual = baseline > 0 ? (entry.apiTokens - baseline) : entry.apiTokens;
      const rawKappa = netActual / histEstimate;
      if (rawKappa >= 0.5 && rawKappa <= 2.0) {
        kappa = Math.max(0.7, Math.min(1.5, rawKappa));
      }
    }

    const pendingChars = entry.pendingChars || 0;
    const pendingCode = entry.pendingCodeChars || 0;
    const pendingTurns = entry.pendingTurns || 0;
    let delta = 0;
    if (pendingChars > 0 || pendingTurns > 0) {
      const rawDelta = estimateTokens(pendingChars, pendingTurns, 0, pendingCode, 0, 0);
      delta += Math.round(rawDelta * kappa);
    }
    if (composerText) {
      const composerTokens = estimateTokensPrecise(composerText, modelName);
      delta += Math.round(composerTokens * kappa);
    }
    return entry.apiTokens + delta;
  }

  let total = estimateTokens(chars, turns, imageTokens, codeChars, docTokens, systemTokens);
  if (composerText) {
    total += estimateTokensPrecise(composerText, modelName);
  }
  return total;
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

// Presentation totals are a partition, not a sum of API cache/input/output counters.
// Missing instruction telemetry stays unknown rather than being presented as zero.
function contextWindowBreakdown(stats = {}) {
  const count = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const used = count(stats.tokens);
  const capacity = count(stats.ceiling) || null;
  const compactionThreshold = count(stats.compactionThreshold);
  const instructions = count(stats.systemTokens) > 0
    ? Math.min(used, count(stats.systemTokens)) : null;
  return {
    used,
    capacity,
    ...(compactionThreshold > 0 && capacity > compactionThreshold ? {
      compaction: {
        threshold: compactionThreshold,
        remaining: Math.max(0, compactionThreshold - used),
        percentage: Math.min(100, used / compactionThreshold * 100),
      },
    } : {}),
    instructions,
    conversation: instructions === null ? null : used - instructions,
    free: capacity === null ? null : Math.max(0, capacity - used),
    percentage: capacity === null ? null : Math.min(100, used / capacity * 100),
  };
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
  const href = loc?.href || '';
  const matchHref = href.match(/\/c\/([a-zA-Z0-9_-]+)/);
  if (matchHref) return '/c/' + matchHref[1];

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
    const rowId = selectedRow.getAttribute('data-conversation-id') || selectedRow.getAttribute('data-id') || selectedRow.getAttribute('data-sidebar-row-id') || selectedRow.getAttribute('data-cascade-id');
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
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!list?.children?.length && item.parentElement?.closest?.('.flex.items-start')) continue;
    const userStep = item.querySelector?.('[data-testid=user-input-step]');
    const prompt = userStep ? userStep.textContent?.slice(0, 80)?.trim() : '';
    const text = item.textContent || '';
    if (prompt || text.length > 50) {
      const stepIdx = item.getAttribute?.('data-step-index') || item.getAttribute?.('data-index') || idx;
      const key = prompt ? `p:${stepIdx}:${prompt}` : `t:${stepIdx}:${text.slice(0, 60)}`;

      let codeChars = 0;
      const codeNodes = item.querySelectorAll?.('pre, [data-testid*="code-block"], [class*="code-block"], [data-testid*="terminal"], [class*="command-output"], [class*="terminal-output"]') || [];
      for (const node of codeNodes) {
        if (node.parentElement?.closest?.('pre, [data-testid*="code-block"], [class*="code-block"], [data-testid*="terminal"], [class*="command-output"], [class*="terminal-output"]')) {
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

function collectImages(doc, modelName = '') {
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
    const tokens = (w > 0 && h > 0) ? estimateImageTokens(w, h, modelName) : 258;
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
        maxTurns: stored.transcriptTurns ? (stored.transcriptTurns + (stored.pendingTurns || 0)) : (stored.maxTurns || 0),
        maxImageTokens: stored.maxImageTokens || 0,
        maxDocTokens: stored.maxDocTokens || 0,
        systemTokens: stored.systemTokens || 0,
        systemBaseline: stored.systemBaseline || null,
        apiTokens: stored.apiTokens || 0,
        inputTokens: stored.inputTokens || 0,
        cacheReadTokens: stored.cacheReadTokens || 0,
        outputTokens: stored.outputTokens || 0,
        mtime: stored.mtime || 0,
        pendingChars: stored.pendingChars || 0,
        pendingCodeChars: stored.pendingCodeChars || 0,
        pendingTurns: stored.pendingTurns || 0,
        transcriptChars: stored.transcriptChars || 0,
        transcriptTurns: stored.transcriptTurns || 0,
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
    entry = { blocks: new Map(), images: new Map(), documents: new Map(), maxChars: 0, maxCodeChars: 0, maxTurns: 0, maxImageTokens: 0, maxDocTokens: 0, systemTokens: 0, systemBaseline: null, apiTokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, mtime: 0, pendingChars: 0, pendingCodeChars: 0, pendingTurns: 0, transcriptChars: 0, transcriptTurns: 0 };
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
    entry.apiTokens = 0;
    entry.inputTokens = 0;
    entry.cacheReadTokens = 0;
    entry.outputTokens = 0;
    entry.mtime = 0;
    entry.pendingChars = 0;
    entry.pendingCodeChars = 0;
    entry.pendingTurns = 0;
    entry.transcriptChars = 0;
    entry.compacted = true;
    clearConversationState(convKey, store);
  }

  const activeModel = detectActiveModel(doc);
  const ceiling = activeModel.name ? activeModel.ceiling : (entry.ceiling || activeModel.ceiling);
  const modelName = activeModel.name || entry.modelName || '';
  const compactionThreshold = compactionThresholdFor(modelName, ceiling);
  entry.ceiling = ceiling;
  entry.modelName = modelName;

  // Discover newly mounted turn blocks in viewport (only when unhydrated)
  if (!entry.apiTokens) {
    const currentBlocks = collectTurnBlocks(doc);
    for (const b of currentBlocks) {
      entry.blocks.set(b.key, { length: b.length, codeChars: b.codeChars || 0 });
    }
  }

  // Discover newly mounted images in viewport (only when unhydrated)
  if (!entry.apiTokens) {
    const currentImages = collectImages(doc, modelName);
    for (const img of currentImages) {
      entry.images.set(img.key, img.tokens);
    }
  }

  // Discover newly mounted documents in viewport/chat (only when unhydrated)
  if (!entry.apiTokens) {
    const currentDocs = collectAttachments(doc);
    for (const d of currentDocs) {
      entry.documents.set(d.key, d.tokens);
    }
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

  if (convKey === 'default' && entry.apiTokens > 0) {
    entry.apiTokens = 0;
    entry.inputTokens = 0;
    entry.cacheReadTokens = 0;
    entry.outputTokens = 0;
    entry.maxChars = 0;
    entry.maxTurns = 0;
    entry.blocks.clear();
    entry.images.clear();
    entry.documents.clear();
  }

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

  const composer = doc.querySelector?.('.surface-composer [contenteditable=true], [data-testid=agent-input-box]');
  const composerText = (composer?.textContent || '').trim();

  const navTurns = countTurns(doc);
  const turns = entry.apiTokens
    ? Math.max(navTurns, (entry.transcriptTurns || 0) + (entry.pendingTurns || 0))
    : Math.max(navTurns, entry.maxTurns || 0);
  entry.maxTurns = turns;

  let chars, codeChars;
  if (entry.apiTokens && entry.apiTokens > 0) {
    const transcriptChars = entry.transcriptChars || entry.maxChars || 0;
    const unrecordedTurns = Math.max(0, navTurns - (entry.transcriptTurns || 0));
    const unrecordedChars = unrecordedTurns > 0 ? Math.max(0, currentChars - transcriptChars) : 0;
    const pendingChars = Math.max(entry.pendingChars || 0, unrecordedChars) + composerText.length;
    chars = transcriptChars + pendingChars;
    codeChars = (entry.maxCodeChars || 0) + (entry.pendingCodeChars || 0);
  } else {
    chars = Math.max(blockSum, currentChars, entry.maxChars);
    codeChars = Math.max(codeSum, entry.maxCodeChars || 0);

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
  }

  entry.maxChars = chars;
  entry.maxCodeChars = codeChars;

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
      apiTokens: entry.apiTokens || null,
      inputTokens: entry.inputTokens || 0,
      cacheReadTokens: entry.cacheReadTokens || 0,
      outputTokens: entry.outputTokens || 0,
      mtime: entry.mtime || 0,
      pendingChars: entry.pendingChars || 0,
      pendingCodeChars: entry.pendingCodeChars || 0,
      pendingTurns: entry.pendingTurns || 0,
      transcriptChars: entry.transcriptChars || 0,
      transcriptTurns: entry.transcriptTurns || 0,
      ceiling,
      modelName,
      updatedAt: Date.now()
    }, store);
  }

  const estimateFn = typeof estimateTokens === 'function' ? estimateTokens : (this?.estimateTokens || estimateTokens);
  const budgetFn = typeof budgetLevelFor === 'function' ? budgetLevelFor : (this?.budgetLevelFor || budgetLevelFor);
  const formatFn = typeof formatTokens === 'function' ? formatTokens : (this?.formatTokens || formatTokens);

  let tokens;
  if (entry.apiTokens && entry.apiTokens > 0) {
    const unrecordedTurns = Math.max(0, navTurns - (entry.transcriptTurns || 0));
    const unrecordedChars = unrecordedTurns > 0 ? Math.max(0, currentChars - (entry.transcriptChars || entry.maxChars || 0)) : 0;
    const pendingChars = Math.max(entry.pendingChars || 0, unrecordedChars);
    const pendingCode = (entry.pendingCodeChars || 0);
    const pendingTurns = Math.max(entry.pendingTurns || 0, unrecordedTurns);

    const baseline = entry.systemBaseline?.tokens || 0;
    const histChars = entry.transcriptChars || entry.maxChars || 0;
    const histCode = entry.maxCodeChars || 0;
    const histProse = Math.max(0, histChars - histCode);
    const histEstimate = Math.round(histProse / 4) + Math.round(histCode / 2.8) + (entry.maxImageTokens || 0) + (entry.maxDocTokens || 0);

    let kappa = 1.0;
    if (histEstimate > 0 && entry.apiTokens > baseline) {
      const netActual = baseline > 0 ? (entry.apiTokens - baseline) : entry.apiTokens;
      const rawKappa = netActual / histEstimate;
      if (rawKappa >= 0.5 && rawKappa <= 2.0) {
        kappa = Math.max(0.7, Math.min(1.5, rawKappa));
      }
    }

    let deltaTokens = 0;
    if (pendingChars > 0 || pendingTurns > 0) {
      const rawDelta = estimateFn(pendingChars, pendingTurns, 0, pendingCode, 0, 0);
      deltaTokens += Math.round(rawDelta * kappa);
    }
    if (composerText) {
      const compTokens = estimateTokensPrecise(composerText, modelName);
      deltaTokens += Math.round(compTokens * kappa);
    }
    tokens = entry.apiTokens + deltaTokens;
  } else {
    tokens = estimateFn(chars, turns, imageTokens, codeChars, docTokens, systemTokens);
    if (composerText) {
      tokens += estimateTokensPrecise(composerText, modelName);
    }
  }
  const budget = budgetFn(tokens, compactionThreshold || ceiling);
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
    apiTokens: entry.apiTokens || 0,
    inputTokens: entry.inputTokens || 0,
    cacheReadTokens: entry.cacheReadTokens || 0,
    outputTokens: entry.outputTokens || 0,
    mtime: entry.mtime || 0,
    tokens,
    ceiling,
    compactionThreshold,
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
  contextWindowBreakdown,
  estimateTokens,
  estimateTokensPrecise,
  calculateEffectiveTokens,
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
