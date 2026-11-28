'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const rules = require('../common/context-budget.cjs');
const script = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');

test('estimateTokens calculates text tokens and turn overhead accurately', () => {
  assert.equal(rules.estimateTokens(0, 0), 0);
  assert.equal(rules.estimateTokens(400, 1), 100 + 120);
  assert.equal(rules.estimateTokens(4000, 5), 1000 + 600);
  assert.equal(rules.estimateTokens(4000, 5, 1105), 1000 + 600 + 1105);
});

test('estimateTokens factors in higher density for code blocks (2.8 chars per token)', () => {
  // 4000 total chars, 2800 of which are code:
  // prose: 1200 / 4 = 300 tokens
  // code: 2800 / 2.8 = 1000 tokens
  // turns: 2 * 120 = 240 tokens
  // expected: 300 + 1000 + 240 = 1540 tokens
  assert.equal(rules.estimateTokens(4000, 2, 0, 2800), 1540);
});

test('collectTurnBlocks extracts code characters without double counting nested elements', () => {
  const codeText = 'const x = 10; function run() { return x * 2; }';
  const item = {
    textContent: 'Explanation before code: ' + codeText,
    querySelector: sel => sel && sel.includes('user-input-step') ? { textContent: 'Write code' } : null,
    querySelectorAll: sel => {
      if (sel && sel.includes('pre')) {
        const codeNode = { textContent: codeText };
        const preNode = { textContent: codeText };
        codeNode.parentElement = { closest: s => s && s.includes('pre') ? preNode : null };
        return [preNode, codeNode];
      }
      return [];
    }
  };

  const doc = {
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return {
          querySelector: () => null,
          firstElementChild: { children: [item] }
        };
      }
      return null;
    }
  };

  const blocks = rules.collectTurnBlocks(doc);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].codeChars, codeText.length, 'nested code node not double counted');
  assert.ok(blocks[0].length > blocks[0].codeChars, 'total length includes both prose and code');
});

test('estimateImageTokens calculates multimodal vision tokens based on resolution', () => {
  assert.equal(rules.estimateImageTokens(0, 0), 0);
  assert.equal(rules.estimateImageTokens(32, 32), 0, 'avatars and icons under 40px are ignored');
  assert.equal(rules.estimateImageTokens(300, 200), 255, 'small crops under 512x512 use single-tile detail');
  assert.equal(rules.estimateImageTokens(512, 512), 255);
  assert.equal(rules.estimateImageTokens(1920, 1080), 1105, '1080p full HD uses 6 tiles with shortest side scaled to 768');
  assert.equal(rules.estimateImageTokens(3840, 2160), 1105, '4K images scale to bounding box and tile accurately');
});

test('detectActiveModel identifies Antigravity models and sets context ceiling dynamically', () => {
  const makeDoc = name => ({
    querySelector: sel => sel.includes('model-selector-trigger') ? { textContent: name } : null
  });

  // Google Gemini models (Gemini 4 Carbon/Argon, Gemini 3.8 Flash, all >= 3 have 1M)
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 4 Carbon (high)')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 4 Argon (high)')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 3.8 Flash (high)')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 3.8 Flash (medium)')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 3.8 Flash (low)')).ceiling, 1000000);

  // Anthropic Claude (Sonnet 5.5 and Opus 5.5 both have 1M)
  assert.equal(rules.detectActiveModel(makeDoc('Claude Sonnet 5.5 (Thinking)')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Claude Opus 5.5 (Thinking)')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Claude Sonnet 4.6')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Claude Opus 4.6')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 3.1 Pro')).ceiling, 1000000);

  // OpenAI (GPT-OSS 120B has 128k)
  assert.equal(rules.detectActiveModel(makeDoc('GPT-OSS 120B')).ceiling, 128000);

  // Default fallback for current Antigravity models
  assert.equal(rules.detectActiveModel(null).ceiling, 1000000);
});

test('budgetLevelFor categorizes tokens into healthy, moderate, elevated, and saturated on 1M default', () => {
  assert.equal(rules.budgetLevelFor(50000).level, 'healthy');
  assert.equal(rules.budgetLevelFor(250000).level, 'moderate');
  assert.equal(rules.budgetLevelFor(500000).level, 'elevated');
  assert.equal(rules.budgetLevelFor(900000).level, 'saturated');
  assert.equal(rules.budgetLevelFor(900000).color, '#ff666a');
});

test('budgetLevelFor scales thresholds dynamically based on model ceiling', () => {
  // 100k tokens on Gemini 4 / Claude 4.6 (1M max) is healthy (10%)
  assert.equal(rules.budgetLevelFor(100000, 1000000).level, 'healthy');
  assert.equal(rules.budgetLevelFor(100000, 1000000).percentage, 10);

  // 100k tokens on GPT-OSS 120B (128k max) is elevated (78%)
  assert.equal(rules.budgetLevelFor(100000, 128000).level, 'elevated');
  assert.equal(rules.budgetLevelFor(100000, 128000).percentage, 78);
});

test('formatTokens formats token counts cleanly', () => {
  assert.equal(rules.formatTokens(450), '450');
  assert.equal(rules.formatTokens(1240), '~1k');
  assert.equal(rules.formatTokens(45200), '~45k');
  assert.equal(rules.formatTokens(185000), '~185k');
  assert.equal(rules.formatTokens(1000000), '~1M');
});

test('extractConversationStats extracts chars, turns, and budget from document', () => {
  rules.clearCache();
  const doc = {
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return { textContent: 'a'.repeat(40000) };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return [{}, {}, {}];
      }
      return [];
    }
  };
  const stats = rules.extractConversationStats(doc);
  assert.equal(stats.chars, 40000);
  assert.equal(stats.turns, 3);
  assert.equal(stats.tokens, 10000 + 360);
  assert.equal(stats.budget.level, 'healthy');
  assert.equal(stats.formatted, '~10k');
});

test('extractConversationStats retains cumulative token knowledge when scrolling down virtualizes messages', () => {
  rules.clearCache();
  const convPath = '/c/test-virtualization';
  let mountedChars = 10000;
  const navTurns = 6;
  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return { textContent: 'a'.repeat(mountedChars) };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return new Array(navTurns).fill({});
      }
      return [];
    }
  };

  const initial = rules.extractConversationStats(doc);
  assert.equal(initial.chars, 10000);
  assert.equal(initial.turns, 6);

  // User scrolls up: older messages load into DOM
  mountedChars = 60000;
  const atTop = rules.extractConversationStats(doc);
  assert.equal(atTop.chars, 60000);
  assert.equal(atTop.turns, 6);

  // User scrolls back down: earlier messages unmount from DOM
  mountedChars = 10000;
  const backAtBottom = rules.extractConversationStats(doc);
  assert.equal(backAtBottom.chars, 60000, 'chars does not drop when earlier messages are virtualized out');
  assert.equal(backAtBottom.turns, 6);
  assert.equal(backAtBottom.tokens, atTop.tokens, 'tokens remain stable when scrolling back down');

  // Switching conversation resets context
  doc.location.pathname = '/c/another-conversation';
  mountedChars = 15000;
  const other = rules.extractConversationStats(doc);
  assert.equal(other.chars, 15000, 'different conversation uses its own independent measurement');
});

test('extractConversationStats accounts for image resolution and retains images across virtual scroll', () => {
  rules.clearCache();
  const convPath = '/c/test-images-virtualization';
  let mountedImages = [
    { src: 'https://example.com/screenshot.png', naturalWidth: 1920, naturalHeight: 1080 },
    { src: 'https://example.com/crop.png', naturalWidth: 300, naturalHeight: 200 },
    { src: 'https://example.com/avatar.png', naturalWidth: 32, naturalHeight: 32 }
  ];

  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return {
          textContent: 'Image analysis text '.repeat(100),
          querySelectorAll: s => {
            if (s === 'img') return mountedImages;
            return [];
          }
        };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return [{}, {}];
      }
      return [];
    }
  };

  const initial = rules.extractConversationStats(doc);
  assert.equal(initial.imageCount, 2, '2 real images counted (avatar ignored)');
  assert.equal(initial.imageTokens, 1105 + 255, '1080p and crop tokens summed');
  assert.ok(initial.tokens > initial.imageTokens, 'total tokens combines text, turns and images');

  // Images virtualized out as user scrolls
  mountedImages = [];
  const afterScroll = rules.extractConversationStats(doc);
  assert.equal(afterScroll.imageCount, 2, 'image count retained after unmounting');
  assert.equal(afterScroll.imageTokens, 1105 + 255, 'image tokens retained after unmounting');
  assert.equal(afterScroll.tokens, initial.tokens, 'overall token budget remains stable');
});

test('saveConversationState, loadConversationState and clearConversationState persist state reliably', () => {
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const sample = {
    maxChars: 45000,
    maxTurns: 8,
    maxImageTokens: 1105,
    ceiling: 1000000,
    modelName: 'Gemini 4 Carbon (high)'
  };

  assert.equal(rules.saveConversationState('/c/test-persist', sample, mockStorage), true);
  const loaded = rules.loadConversationState('/c/test-persist', mockStorage);
  assert.equal(loaded.maxChars, 45000);
  assert.equal(loaded.maxTurns, 8);
  assert.equal(loaded.maxImageTokens, 1105);
  assert.equal(loaded.modelName, 'Gemini 4 Carbon (high)');

  rules.clearConversationState('/c/test-persist', mockStorage);
  assert.equal(rules.loadConversationState('/c/test-persist', mockStorage), null);
});

test('extractConversationStats restores conversation memory on startup without scrolling up', () => {
  rules.clearCache();
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const convPath = '/c/test-reopen-startup';
  rules.saveConversationState(convPath, {
    maxChars: 240000,
    maxTurns: 18,
    maxImageTokens: 2210,
    ceiling: 1000000,
    modelName: 'Gemini 4 Carbon (high)',
    blocks: [['p:old turn 1', 1000], ['p:old turn 2', 2000]],
    images: [['img:1', 1105], ['img:2', 1105]]
  }, mockStorage);

  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return { textContent: 'Recent bottom message only (500 chars)' };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return [{}];
      }
      return [];
    }
  };

  const restored = rules.extractConversationStats(doc, mockStorage);
  assert.equal(restored.chars, 240000, 'full cumulative characters restored from storage');
  assert.equal(restored.turns, 18, 'all 18 turns restored without scrolling up');
  assert.equal(restored.imageTokens, 2210, 'image tokens preserved from storage');
  assert.equal(restored.ceiling, 1000000);
  assert.equal(restored.modelName, 'Gemini 4 Carbon (high)');
  assert.ok(restored.tokens >= 60000 + 2160 + 2210, 'true token count available on startup');
});

test('remote control mode displays accurate context budget even when main chat viewport is unmounted', () => {
  rules.clearCache();
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const convPath = '/c/test-remote-control';
  rules.saveConversationState(convPath, {
    maxChars: 80000,
    maxTurns: 12,
    maxImageTokens: 1105,
    ceiling: 128000,
    modelName: 'GPT-OSS 120B'
  }, mockStorage);

  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]' || sel === '[data-testid=conversation-view]') return null;
      if (sel.includes('remote-control')) return { textContent: 'remote control bar' };
      return null;
    },
    querySelectorAll: () => []
  };

  const stats = rules.extractConversationStats(doc, mockStorage);
  assert.equal(stats.chars, 80000);
  assert.equal(stats.turns, 12);
  assert.equal(stats.ceiling, 128000);
  assert.equal(stats.modelName, 'GPT-OSS 120B');
  assert.ok(stats.tokens > 20000);
});

test('estimateAttachmentTokens calculates tokens for PDFs, text documents and binary files', () => {
  // PDF page rate (258 tok/page)
  assert.equal(rules.estimateAttachmentTokens({ name: 'report.pdf', pages: 5 }), 5 * 258);
  assert.equal(rules.estimateAttachmentTokens({ name: 'document.pdf', sizeKb: 180 }), 3 * 258, 'approximates pages from size');
  assert.equal(rules.estimateAttachmentTokens({ name: 'manual.pdf' }), 774, 'defaults to ~3 pages when no size/pages');

  // Text documents: (sizeKb * 1024) / 4
  assert.equal(rules.estimateAttachmentTokens({ name: 'data.csv', sizeKb: 10 }), 2560);
  assert.equal(rules.estimateAttachmentTokens({ name: 'config.json', sizeKb: 4 }), 1024);
  assert.equal(rules.estimateAttachmentTokens({ name: 'notes.md', sizeKb: 2 }), 512);

  // Compressed binary documents: min(15000, max(258, (sizeKb * 1024) / 8))
  assert.equal(rules.estimateAttachmentTokens({ name: 'brief.docx', sizeKb: 100 }), 12800);

  // Images should be ignored (handled by estimateImageTokens)
  assert.equal(rules.estimateAttachmentTokens({ name: 'screenshot.png', sizeKb: 400 }), 0);
  assert.equal(rules.estimateAttachmentTokens({ name: 'photo.jpg', sizeKb: 800 }), 0);
});

test('parseAttachmentInfo and collectAttachments extract metadata without double counting', () => {
  const pdfNode = {
    textContent: 'annual_report.pdf 4 pages (240 KB)',
    querySelector: sel => sel && sel.includes('name') ? { textContent: 'annual_report.pdf' } : null,
    getAttribute: () => null,
    closest: () => null,
    parentElement: null
  };

  const info = rules.parseAttachmentInfo(pdfNode);
  assert.ok(info);
  assert.equal(info.name, 'annual_report.pdf');
  assert.equal(info.pages, 4);
  assert.equal(info.sizeKb, 240);
  assert.equal(info.tokens, 4 * 258);

  // Image chip should return null
  const imgNode = {
    textContent: 'preview.png 500 KB',
    querySelector: () => null,
    getAttribute: () => null,
    closest: () => null,
    parentElement: null
  };
  assert.equal(rules.parseAttachmentInfo(imgNode), null);

  // collectAttachments scanning DOM
  const csvNode = {
    textContent: 'metrics.csv (20 KB)',
    querySelector: () => null,
    getAttribute: () => null,
    closest: () => null,
    parentElement: null
  };
  const ignoredPluginNode = {
    textContent: 'internal.pdf 2 pages',
    querySelector: () => null,
    getAttribute: () => null,
    closest: sel => sel && sel.includes('agpa-context-ui') ? {} : null,
    parentElement: null
  };

  const doc = {
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? {
      querySelectorAll: () => [pdfNode, csvNode, ignoredPluginNode]
    } : null
  };

  const attachments = rules.collectAttachments(doc);
  assert.equal(attachments.length, 2, 'plugin UI attachment ignored');
  assert.equal(attachments[0].name, 'annual_report.pdf');
  assert.equal(attachments[1].name, 'metrics.csv');
});

test('extractConversationStats accounts for document attachments and preserves them across scroll and restart', () => {
  rules.clearCache();
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const pdfNode = {
    textContent: 'spec.pdf 10 pages',
    querySelector: () => ({ textContent: 'spec.pdf' }),
    getAttribute: () => null,
    closest: () => null,
    parentElement: null
  };

  const convPath = '/c/test-attachments-scroll';
  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return {
          textContent: 'Here is the specification document for the project.',
          querySelector: () => null,
          firstElementChild: { children: [] }
        };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel.includes('attachment') || sel.includes('file-pill')) {
        return [pdfNode];
      }
      return [];
    }
  };

  const initialStats = rules.extractConversationStats(doc, mockStorage);
  assert.equal(initialStats.docCount, 1);
  assert.equal(initialStats.docTokens, 10 * 258);
  assert.ok(initialStats.tokens >= 2580);

  // Now simulate scrolling down: PDF node is unmounted from DOM
  const scrolledDoc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return {
          textContent: 'Following up on section 3 of the spec.',
          querySelector: () => null,
          firstElementChild: { children: [] }
        };
      }
      return null;
    },
    querySelectorAll: () => []
  };

  const scrolledStats = rules.extractConversationStats(scrolledDoc, mockStorage);
  assert.equal(scrolledStats.docCount, 1, 'attachment count retained across virtual scroll');
  assert.equal(scrolledStats.docTokens, 2580, 'attachment tokens retained across virtual scroll');

  // Verify restart from cold storage
  rules.clearCache();
  const coldDoc = {
    location: { pathname: convPath },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'bottom' } : null,
    querySelectorAll: () => []
  };

  const coldStats = rules.extractConversationStats(coldDoc, mockStorage);
  assert.equal(coldStats.docTokens, 2580, 'document tokens restored from localStorage on program restart');
});

test('estimateSystemBaseline calculates cold-start overhead from MCP tools, rules and core prompt', () => {
  // 1. Text indicators in composer
  const composerDoc = {
    body: {
      querySelectorAll: sel => {
        if (sel.includes('.surface-composer') || sel.includes('composer')) {
          return [{ textContent: 'Claude 4.6 · 12 tools active · 2 rules' }];
        }
        return [];
      },
      querySelector: () => null
    }
  };
  const baseline = rules.estimateSystemBaseline(composerDoc);
  assert.equal(baseline.toolsCount, 12);
  assert.equal(baseline.rulesCount, 2);
  assert.equal(baseline.baseTokens, 1500);
  assert.equal(baseline.toolTokens, 12 * 180);
  assert.equal(baseline.ruleTokens, 2 * 350);
  assert.equal(baseline.tokens, 1500 + 2160 + 700);

  // 2. DOM elements for MCP servers
  const mcpDoc = {
    body: {
      querySelectorAll: sel => {
        if (sel.includes('mcp-server')) {
          return [{}, {}]; // 2 MCP servers
        }
        return [];
      },
      querySelector: () => null
    }
  };
  const mcpBaseline = rules.estimateSystemBaseline(mcpDoc);
  assert.equal(mcpBaseline.mcpCount, 2);
  assert.equal(mcpBaseline.toolTokens, 2 * 600);
  assert.equal(mcpBaseline.tokens, 1500 + 1200);

  // 3. Clean environment without system elements
  const cleanDoc = {
    body: {
      querySelectorAll: () => [],
      querySelector: () => null
    }
  };
  assert.equal(rules.estimateSystemBaseline(cleanDoc).tokens, 0);
});

test('estimateTokens combines text, turns, images, code, documents and system overhead', () => {
  // 4000 total chars, 2800 code chars (prose: 1200 / 4 = 300 tok, code: 2800 / 2.8 = 1000 tok)
  // turns: 2 * 120 = 240 tok
  // imageTokens: 1105
  // docTokens: 2580
  // systemTokens: 4000
  // total: 300 + 1000 + 240 + 1105 + 2580 + 4000 = 9225
  assert.equal(rules.estimateTokens(4000, 2, 1105, 2800, 2580, 4000), 9225);
});

test('extractConversationStats accounts for system baseline overhead and preserves it across cold restart', () => {
  rules.clearCache();
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const convPath = '/c/test-system-baseline';
  const doc = {
    location: { pathname: convPath },
    body: {
      querySelectorAll: sel => {
        if (sel.includes('.surface-composer') || sel.includes('composer')) {
          return [{ textContent: 'Gemini 4 Carbon · 8 tools' }];
        }
        return [];
      },
      querySelector: () => null
    },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return { textContent: 'First prompt from user' };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel.includes('conversation-navigator-turn')) return [{}];
      return [];
    }
  };

  const stats = rules.extractConversationStats(doc, mockStorage);
  assert.ok(stats.systemTokens > 0);
  assert.equal(stats.systemBaseline.toolsCount, 8);
  assert.equal(stats.systemTokens, 1500 + 8 * 180);
  assert.ok(stats.tokens >= 2940);

  // Cold restart simulation
  rules.clearCache();
  const coldDoc = {
    location: { pathname: convPath },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const coldStats = rules.extractConversationStats(coldDoc, mockStorage);
  assert.equal(coldStats.systemTokens, 2940, 'system baseline restored from storage on cold restart');
});

test('hydrateFromTranscript hydrates conversation stats into cache and storage without scrolling', () => {
  rules.clearCache();
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const convKey = '/c/test-hydrate-transcript';
  const data = {
    maxChars: 120000,
    maxCodeChars: 15000,
    maxTurns: 30,
    maxImageTokens: 516,
    apiTokens: 35000,
    blocks: [
      ['turn-1', { length: 4000, codeChars: 500 }],
      ['turn-2', { length: 5000, codeChars: 800 }]
    ],
    images: [['img-1', 258], ['img-2', 258]]
  };

  const res = rules.hydrateFromTranscript(convKey, data, mockStorage);
  assert.equal(res, true);

  const doc = {
    location: { pathname: convKey },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const stats = rules.extractConversationStats(doc, mockStorage);
  assert.equal(stats.turns, 30);
  assert.equal(stats.chars, 120000);
  assert.equal(stats.imageTokens, 516);
  assert.ok(stats.tokens >= 35000);
});

test('getConversationKey resolves key from pathname, hash, query params, sidebar rows, and containers', () => {
  // Pathname
  assert.equal(rules.getConversationKey({ location: { pathname: '/c/uuid-1' } }), '/c/uuid-1');

  // Hash
  assert.equal(rules.getConversationKey({ location: { pathname: '/', hash: '#/c/uuid-hash' } }), '/c/uuid-hash');

  // Query search
  assert.equal(rules.getConversationKey({ location: { pathname: '/', search: '?conversation=uuid-search' } }), '/c/uuid-search');

  // Full location href with port and query
  assert.equal(rules.getConversationKey({ location: { href: 'https://127.0.0.1:51371/c/uuid-from-href?section=123' } }), '/c/uuid-from-href');

  // Sidebar selected row with data-conversation-id
  const sidebarDoc = {
    location: { pathname: '/' },
    querySelector: sel => {
      if (sel && sel.includes('conversation-row-sidebar')) {
        return {
          getAttribute: attr => attr === 'data-conversation-id' ? 'uuid-sidebar' : null,
          querySelector: () => null
        };
      }
      return null;
    }
  };
  assert.equal(rules.getConversationKey(sidebarDoc), '/c/uuid-sidebar');

  // Sidebar selected row with data-sidebar-row-id
  const sidebarRowIdDoc = {
    location: { pathname: '/' },
    querySelector: sel => {
      if (sel && sel.includes('conversation-row-sidebar')) {
        return {
          getAttribute: attr => attr === 'data-sidebar-row-id' ? 'uuid-sidebar-row' : null,
          querySelector: () => null
        };
      }
      return null;
    }
  };
  assert.equal(rules.getConversationKey(sidebarRowIdDoc), '/c/uuid-sidebar-row');

  // Sidebar selected row with anchor link
  const sidebarLinkDoc = {
    location: { pathname: '/' },
    querySelector: sel => {
      if (sel && sel.includes('conversation-row-sidebar')) {
        return {
          getAttribute: () => null,
          querySelector: s => s && s.includes('a[href*="/c/"]') ? { getAttribute: () => '/c/uuid-link' } : null
        };
      }
      return null;
    }
  };
  assert.equal(rules.getConversationKey(sidebarLinkDoc), '/c/uuid-link');

  // Sidebar selected row with title
  const sidebarTitleDoc = {
    location: { pathname: '/' },
    querySelector: sel => {
      if (sel && sel.includes('conversation-row-sidebar')) {
        return {
          getAttribute: () => null,
          querySelector: () => null,
          textContent: '  Project Architecture Discussion  '
        };
      }
      return null;
    }
  };
  assert.equal(rules.getConversationKey(sidebarTitleDoc), 'conv:Project Architecture Discussion');

  // Viewport container attribute
  const containerDoc = {
    location: { pathname: '/' },
    querySelector: sel => {
      if (sel && sel.includes('conversation-view')) {
        return { getAttribute: attr => attr === 'data-conversation-id' ? 'uuid-container' : null };
      }
      return null;
    }
  };
  assert.equal(rules.getConversationKey(containerDoc), '/c/uuid-container');

  // Fallback
  assert.equal(rules.getConversationKey(null), 'default');
  assert.equal(rules.getConversationKey({ location: { pathname: '/' } }), 'default');
});

test('extractConversationStats projects proportional characters on frame 1 when chat has unmounted turns', () => {
  rules.clearCache();
  const convPath = '/c/test-proportional-projection';

  // 1 mounted block of 1000 chars, but 10 navigator turns total
  const item = {
    textContent: 'User prompt: ' + 'x'.repeat(1000),
    querySelector: () => ({ textContent: 'Do task' }),
    querySelectorAll: () => []
  };

  const doc = {
    location: { pathname: convPath },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return {
          textContent: item.textContent,
          querySelector: () => null,
          firstElementChild: { children: [item] }
        };
      }
      return null;
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=conversation-navigator-turn]') {
        return Array(10).fill({});
      }
      return [];
    }
  };

  const stats = rules.extractConversationStats(doc);
  assert.equal(stats.turns, 10, 'turns reflect total turns from navigator');
  // Proportional projection: 1 block = 1000 chars, 10 turns -> ~10000 chars
  assert.ok(stats.chars >= 10000, 'characters projected proportionally to total turns before scrolling');
  // Tokens reflect the whole projected conversation rather than only 1 turn
  assert.ok(stats.tokens >= 2500 + 1200, 'tokens realistically projected on frame 1 without manual scroll');
});

class FakeClassList {
  constructor() { this.classes = new Set(); }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
}

function makeNode(tag) {
  const attrs = new Map();
  const children = [];
  const listeners = new Map();
  const classList = new FakeClassList();
  let textContent = '';
  const style = {
    properties: new Map(),
    setProperty(k, v) { this.properties.set(k, v); },
    getPropertyValue(k) { return this.properties.get(k) || ''; }
  };

  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    classList,
    style,
    isConnected: true,
    children,
    get className() { return [...classList.classes].join(' '); },
    set className(v) { classList.classes = new Set(v.split(/\s+/).filter(Boolean)); },
    get textContent() { return textContent || children.map(c => c.textContent).join(''); },
    set textContent(v) { textContent = v; },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) { attrs.delete(k); },
    append(...nodes) {
      for (const n of nodes) {
        if (!n) continue;
        n.parentElement = this;
        children.push(n);
      }
    },
    replaceChildren(...nodes) {
      children.length = 0;
      this.append(...nodes);
    },
    insertBefore(node, reference) {
      if (node.parentElement) node.remove();
      node.parentElement = this;
      const index = children.indexOf(reference);
      if (index < 0) children.push(node); else children.splice(index, 0, node);
    },
    get nextElementSibling() {
      const siblings = this.parentElement?.children || [];
      return siblings[siblings.indexOf(this) + 1] || null;
    },
    after(...nodes) {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) {
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n) continue;
            n.parentElement = this.parentElement;
            this.parentElement.children.splice(idx + 1 + i, 0, n);
          }
        }
      }
    },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(event) {
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn(event);
      return true;
    },
    click() {
      return this.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const results = [];
      const parts = selector.split(',').map(s => s.trim());
      function walk(node) {
        for (const child of node.children || []) {
          if (parts.some(s => matches(child, s))) results.push(child);
          walk(child);
        }
      }
      walk(this);
      return results;
    },
    closest(selector) {
      let cur = this;
      while (cur) {
        if (matches(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    getBoundingClientRect() {
      return { left: 100, right: 300, top: 200, bottom: 224, width: 200, height: 24 };
    },
    offsetHeight: 100,
    focus() {}
  };
}

function matches(node, selector) {
  if (!node || !node.tagName) return false;
  if (selector === '[data-agpa-context-budget]') return node.hasAttribute('data-agpa-context-budget');
  if (selector === '[data-agpa-context-ui]') return node.hasAttribute('data-agpa-context-ui');
  if (selector === '.agpa-context-pill') return node.classList.contains('agpa-context-pill');
  if (selector === '.agpa-context-popup') return node.classList.contains('agpa-context-popup');
  if (selector === '.agpa-context-breakdown') return node.classList.contains('agpa-context-breakdown');
  if (selector === '.agpa-context-close') return node.classList.contains('agpa-context-close');
  if (selector === '.agpa-context-compact-btn') return node.classList.contains('agpa-context-compact-btn');
  if (selector === '.surface-composer') return node.classList.contains('surface-composer');
  if (selector === '[data-testid=autoscroll-viewport]') return node.getAttribute('data-testid') === 'autoscroll-viewport';
  if (selector === '[data-testid=conversation-navigator-turn]') return node.getAttribute('data-testid') === 'conversation-navigator-turn';
  if (selector.includes('input-footer')) return node.className.includes('input-footer');
  if (selector.includes('role=combobox')) return node.getAttribute('role') === 'combobox';
  return false;
}

test('context budget component attaches pill, reflects levels and allows inserting /compact', async () => {
  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body');
  html.append(head, body);

  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const editor = makeNode('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('role', 'combobox');
  composer.append(editor);

  let pastedData = '';
  editor.addEventListener('paste', e => {
    pastedData = e.clipboardData?.getData('text/plain') || '';
    editor.textContent = pastedData;
  });

  const footer = makeNode('div');
  footer.className = '@container/input-footer fixture-footer';
  composer.append(footer);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.textContent = 'Conversation text '.repeat(1000); // ~18000 chars

  body.append(viewport, composer);

  // Add 10 turns
  for (let i = 0; i < 10; i++) {
    const turn = makeNode('div');
    turn.setAttribute('data-testid', 'conversation-navigator-turn');
    body.append(turn);
  }

  const document = {
    head,
    body,
    documentElement: html,
    createElement: tag => makeNode(tag),
    querySelector: sel => body.querySelector(sel) || head.querySelector(sel),
    querySelectorAll: sel => [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    document,
    window: {
      innerWidth: 1024,
      innerHeight: 768,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() {}
      disconnect() {}
    },
    setTimeout, clearTimeout,
    queueMicrotask: fn => fn(),
    DataTransfer: class {
      constructor() { this.data = new Map(); }
      setData(k, v) { this.data.set(k, v); }
      getData(k) { return this.data.get(k) || ''; }
    },
    ClipboardEvent: class {
      constructor(type, init) {
        this.type = type;
        this.clipboardData = init?.clipboardData;
      }
    },
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, n) => v[n] || '') }
  };

  vm.createContext(context);
  vm.runInContext(script, context);

  const pill = footer.querySelector('[data-agpa-context-budget]');
  assert.ok(pill, 'context budget pill attached to footer');
  assert.ok(pill.getAttribute('aria-label').includes('k'), 'ring exposes estimated tokens accessibly');

  // Click pill to open popover
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const popup = body.querySelector('.agpa-context-popup');
  assert.ok(popup, 'popover opens on pill click');
  popup.querySelector('.agpa-context-close').dispatchEvent({ type: 'click' });
  assert.equal(body.querySelector('.agpa-context-popup'), null, 'close button dismisses popup');

  // Saturated test
  viewport.textContent = 'Large conversation '.repeat(180000); // 3,420,000 chars -> 855k tokens (saturated on 1M)
  context.__AGContextBudget.refresh();

  assert.equal(pill.getAttribute('data-level'), 'saturated');
  assert.ok(!pill.getAttribute('title'), 'native text tooltip is replaced by graphical hover');
  assert.ok(pill.getAttribute('aria-label').includes('tokens'), 'accessible global usage remains available');

  // Click pill to open popover and click /compact button
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const compactBtn = body.querySelector('.agpa-context-compact-btn');
  assert.ok(compactBtn, 'insert /compact button appears when saturated');

  compactBtn.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(pastedData, '/compact ', 'insert /compact inserts command into composer editor');

  // Clean destruction
  context.__AGContextBudget.destroy();
  assert.equal(footer.querySelector('[data-agpa-context-budget]'), null, 'destroy removes pill');
  assert.equal(context.__AGContextBudget, undefined, 'destroy deletes global instance');
});

test('estimateImageTokens adapts accurately to model family', () => {
  // Gemini standardizes to 258 tokens per image
  assert.equal(rules.estimateImageTokens(1920, 1080, 'Gemini 3.8 Flash'), 258);
  assert.equal(rules.estimateImageTokens(3840, 2160, 'Gemini 4 Carbon'), 258);

  // Claude computes area / 750 bounded to 1568
  assert.equal(rules.estimateImageTokens(1500, 1000, 'Claude Sonnet 3.5'), Math.round(1500000 / 750));

  // Default / OpenAI uses resolution tiling
  assert.equal(rules.estimateImageTokens(1920, 1080), 1105);
});

test('detectActiveModel parses context ceiling dynamically from label', () => {
  const makeDoc = name => ({
    querySelector: sel => sel.includes('model-selector-trigger') ? { textContent: name } : null
  });

  assert.equal(rules.detectActiveModel(makeDoc('Claude 3.5 Sonnet (200k)')).ceiling, 200000);
  assert.equal(rules.detectActiveModel(makeDoc('Gemini 1.5 Pro (2M)')).ceiling, 2000000);
  assert.equal(rules.detectActiveModel(makeDoc('OpenAI o1 (128k)')).ceiling, 128000);
  assert.equal(rules.detectActiveModel(makeDoc('Custom Model (64k)')).ceiling, 64000);
});

test('collectTurnBlocks keeps unique keys when user sends identical prompts', () => {
  const items = [
    {
      textContent: 'User: continua\nModel: step 1 response content is here',
      querySelector: sel => sel && sel.includes('user-input-step') ? { textContent: 'continua' } : null,
      querySelectorAll: () => []
    },
    {
      textContent: 'User: continua\nModel: step 2 response content continues here',
      querySelector: sel => sel && sel.includes('user-input-step') ? { textContent: 'continua' } : null,
      querySelectorAll: () => []
    }
  ];

  const doc = {
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') {
        return {
          querySelector: () => null,
          firstElementChild: { children: items }
        };
      }
      return null;
    }
  };

  const blocks = rules.collectTurnBlocks(doc);
  assert.equal(blocks.length, 2, 'both identical turns are captured');
  assert.notEqual(blocks[0].key, blocks[1].key, 'unique keys assigned despite identical prompts');
});

test('extractConversationStats prioritizes API tokens ground truth and adds live delta for new DOM chars', () => {
  rules.clearCache();
  const convKey = '/c/test-ground-truth-priority';
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  // Hydrate with exact API tokens: 10,000 tokens for 40,000 characters
  rules.hydrateFromTranscript(convKey, {
    maxChars: 40000,
    maxTurns: 5,
    apiTokens: 10000,
    blocks: [['turn-1', { length: 40000, codeChars: 0 }]]
  }, mockStorage);

  // Viewport at same character count -> exact API tokens (no delta)
  const docSame = {
    location: { pathname: convKey },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'a'.repeat(40000) } : null,
    querySelectorAll: sel => sel === '[data-testid=conversation-navigator-turn]' ? [{}, {}, {}, {}, {}] : []
  };

  const statsSame = rules.extractConversationStats(docSame, mockStorage);
  assert.equal(statsSame.tokens, 10000, 'exact API tokens used without heuristic drift');

  // Scrolling up past messages in viewport (chars <= transcriptChars, turns <= transcriptTurns) does not inflate tokens
  const docScroll = {
    location: { pathname: convKey },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'a'.repeat(35000) } : null,
    querySelectorAll: sel => sel === '[data-testid=conversation-navigator-turn]' ? [{}, {}, {}, {}, {}] : []
  };
  const statsScroll = rules.extractConversationStats(docScroll, mockStorage);
  assert.equal(statsScroll.tokens, 10000, 'scrolling up past messages does not inflate API tokens');

  // New prompt typed in DOM (+ 400 chars, + 1 turn) -> exact API tokens + delta
  const docNew = {
    location: { pathname: convKey },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'a'.repeat(40400) } : null,
    querySelectorAll: sel => sel === '[data-testid=conversation-navigator-turn]' ? [{}, {}, {}, {}, {}, {}] : []
  };

  const statsNew = rules.extractConversationStats(docNew, mockStorage);
  // delta: 400 chars / 4 = 100, 1 turn overhead = 120 -> 10000 + 220 = 10220
  assert.equal(statsNew.tokens, 10220, 'exact API base plus delta for newly typed DOM turn');
});

test('extractConversationStats maintains identical token count when scrolling between top and bottom of virtualized viewport', () => {
  rules.clearCache();
  const convKey = '/c/test-virtual-scroll-stability';
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  rules.hydrateFromTranscript(convKey, {
    maxChars: 20000,
    maxTurns: 6,
    apiTokens: 25000,
    images: [['test.png', 258]]
  }, mockStorage);

  // At bottom (only recent messages mounted in viewport: 8,000 characters)
  const docBottom = {
    location: { pathname: convKey },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'a'.repeat(8000) } : null,
    querySelectorAll: sel => sel === '[data-testid=conversation-navigator-turn]' ? [{}, {}, {}, {}, {}, {}] : []
  };
  const statsBottom = rules.extractConversationStats(docBottom, mockStorage);

  // Scrolled up (entire history mounted in viewport: 38,000 characters of rendered HTML)
  const docTop = {
    location: { pathname: convKey },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'a'.repeat(38000) } : null,
    querySelectorAll: sel => sel === '[data-testid=conversation-navigator-turn]' ? [{}, {}, {}, {}, {}, {}] : []
  };
  const statsTop = rules.extractConversationStats(docTop, mockStorage);

  // Scrolled back down (messages unmounted: 8,000 characters)
  const statsBottomAgain = rules.extractConversationStats(docBottom, mockStorage);

  assert.equal(statsBottom.tokens, 25000, 'at bottom tokens match exact apiTokens');
  assert.equal(statsTop.tokens, 25000, 'scrolling up does not fluctuate tokens due to rendered DOM bloat');
  assert.equal(statsBottomAgain.tokens, 25000, 'scrolling back down preserves identical token count');
});

test('fresh new conversation screen (convKey default) starts with 0 turns and zero API tokens without inheriting old sessions', () => {
  rules.clearCache();
  const mockStorage = new Map();
  // Simulate corrupted leftover state in default
  mockStorage.set('agpa_context_budget_default', JSON.stringify({
    apiTokens: 152744,
    inputTokens: 2735,
    cacheReadTokens: 149394,
    outputTokens: 615,
    maxChars: 300000,
    maxTurns: 0,
    ceiling: 1000000
  }));

  const storageAdapter = {
    getItem: k => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: k => mockStorage.delete(k)
  };

  const docNewChat = {
    location: { pathname: '/' },
    querySelector: sel => {
      if (sel === '[data-testid=autoscroll-viewport]') return { textContent: '' };
      if (sel === '[data-testid=agent-input-box]') return { textContent: '' };
      return null;
    },
    querySelectorAll: () => []
  };

  const stats = rules.extractConversationStats(docNewChat, storageAdapter);
  assert.equal(stats.apiTokens, 0, 'apiTokens is 0 on fresh chat screen');
  assert.equal(stats.turns, 0, 'turns is 0 on fresh chat screen');
  assert.equal(stats.chars, 0, 'chars is 0 on fresh chat screen');
  assert.equal(mockStorage.has('agpa_context_budget_default'), false, 'purged corrupted default state from localStorage');
});

test('context budget component requests instant hydration when chat lacks apiTokens without requiring scroll', () => {
  const storeMap = new Map();
  let requestedKey = null;

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body');
  html.append(head, body);

  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer fixture-footer';
  composer.append(footer);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.textContent = 'Initial bottom messages only';

  body.append(viewport, composer);

  const mockWindow = {
    innerWidth: 1024,
    innerHeight: 768,
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const mockDoc = {
    defaultView: mockWindow,
    location: { pathname: '/c/test-unhydrated-chat' },
    head,
    body,
    documentElement: html,
    createElement: tag => makeNode(tag),
    querySelector: sel => body.querySelector(sel) || head.querySelector(sel),
    querySelectorAll: sel => [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    window: mockWindow,
    document: mockDoc,
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() {}
      disconnect() {}
    },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace("{" + p + "}", val), k) },
    __agpaTranscriptRequest: (payload) => {
      const parsed = JSON.parse(payload);
      requestedKey = parsed.convKey;
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.globalThis = context;
  context.__AGPA_CONTEXT_BUDGET__ = rules;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  // Run component in VM context
  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // Verify that needsTranscript is true for newly opened unhydrated chat
  assert.equal(context.__AGContextBudget.needsTranscript('/c/test-unhydrated-chat'), true);

  // Verify that __agpaTranscriptRequest was immediately triggered on chat open without scroll
  assert.equal(requestedKey, '/c/test-unhydrated-chat', 'requests background transcript immediately on open');

  context.__AGContextBudget.destroy();
});

test('estimateTokensPrecise estimates fenced code blocks with delimiter envelope and inline code', () => {
  const emptyTokens = rules.estimateTokensPrecise('', 'gemini');
  assert.equal(emptyTokens, 0);

  // Fenced code block with 29 characters of inner code:
  // Math.ceil(29 / 2.9) + 3 = 10 + 3 = 13 tokens
  const codeBlock = '```javascript\nconst x = 100;\n```';
  const tokens = rules.estimateTokensPrecise(codeBlock, 'gemini');
  assert.ok(tokens >= 10 && tokens <= 16, `expected ~13 tokens, got ${tokens}`);

  // Inline code
  const inline = 'Use `console.log(msg)` here';
  const inlineTokens = rules.estimateTokensPrecise(inline, 'gemini');
  assert.ok(inlineTokens >= 6 && inlineTokens <= 12);
});

test('estimateTokensPrecise classifies structured JSON payloads accurately', () => {
  const jsonPayload = JSON.stringify({
    tool: 'execute_command',
    parameters: { cmd: 'git status', flags: ['--short', '--branch'] }
  });

  const geminiTokens = rules.estimateTokensPrecise(jsonPayload, 'gemini');
  const claudeTokens = rules.estimateTokensPrecise(jsonPayload, 'claude');
  const gptTokens = rules.estimateTokensPrecise(jsonPayload, 'gpt-4o');

  // JSON is denser in Claude (jsonR = 2.0) than Gemini (jsonR = 2.2)
  assert.ok(geminiTokens > 20, 'JSON tokens properly computed for Gemini');
  assert.ok(claudeTokens >= geminiTokens, 'Claude produces equal or higher tokens for dense JSON');
  assert.ok(gptTokens > 20, 'JSON tokens computed for GPT');
});

test('estimateTokensPrecise tokenizes multilingual CJK and non-Latin alphabets accurately', () => {
  // CJK ideographs have dense meaning: 0.8 - 1.3 chars/token
  const cjkText = '这是一个中文测试句子，包含几个汉字。'; // 18 chars
  const cjkTokens = rules.estimateTokensPrecise(cjkText, 'gemini');
  // Naive chars/4 would give 4 tokens; MMSLE should give >= 12
  assert.ok(cjkTokens >= 10, `CJK should have high token density, got ${cjkTokens}`);

  const claudeCjk = rules.estimateTokensPrecise(cjkText, 'claude');
  assert.ok(claudeCjk >= cjkTokens, 'Claude CJK density (0.8) yields higher token count');

  // Cyrillic, Greek, Arabic
  const nonLatin = 'Привет мир Γειά σου مرحبا بالعالم';
  const nlTokens = rules.estimateTokensPrecise(nonLatin, 'gemini');
  assert.ok(nlTokens >= 8, `Non-latin alphabets should be tokenized properly, got ${nlTokens}`);
});

test('estimateTokensPrecise chunks numbers into 3-digit groups and counts punctuation and indentation', () => {
  // 9-digit number = 3 chunks of 3 = 3 tokens
  const numTokens = rules.estimateTokensPrecise('123456789', 'gemini');
  assert.equal(numTokens, 3);

  // 5-digit number = 2 tokens
  assert.equal(rules.estimateTokensPrecise('12345', 'gemini'), 2);

  // Contiguous punctuation run: "===" -> Math.ceil(3/2) = 2 tokens
  const punctTokens = rules.estimateTokensPrecise('===', 'gemini');
  assert.equal(punctTokens, 2);

  // Single punctuation = 1 token
  assert.equal(rules.estimateTokensPrecise('!', 'gemini'), 1);

  // Indentation with newlines
  const indented = 'function test() {\n    return 42;\n}';
  const indTokens = rules.estimateTokensPrecise(indented, 'gemini');
  assert.ok(indTokens >= 8 && indTokens <= 15);
});

test('estimateTokensPrecise calibrates across model families (Gemini vs Claude vs OpenAI)', () => {
  const prose = 'The quick brown fox jumps over the lazy dog and explores the context window.';
  const gemini = rules.estimateTokensPrecise(prose, 'gemini-1.5-pro');
  const claude = rules.estimateTokensPrecise(prose, 'claude-3-7-sonnet');
  const openai = rules.estimateTokensPrecise(prose, 'gpt-4o');

  assert.ok(gemini > 10 && gemini < 25);
  assert.ok(claude >= gemini, 'Claude tokenizer has tighter ratio (3.6 vs 4.2)');
  assert.ok(openai > 10 && openai < 25);
});

test('calculateEffectiveTokens implements dual-anchor calibration with online kappa factor', () => {
  // Case 1: Entry with API tokens ground truth
  const entry = {
    apiTokens: 10000,
    systemTokens: 1500,
    transcriptChars: 40000,
    transcriptTurns: 5,
    maxChars: 40000,
    maxTurns: 5,
    pendingChars: 400,
    pendingTurns: 1,
    pendingCodeChars: 0
  };

  const effective = rules.calculateEffectiveTokens(entry, 'Hello assistant', 'gemini');
  // API base (10,000) + scaled delta (~220) + composer tokens (~3)
  assert.ok(effective > 10000, 'anchored on API tokens ground truth');
  assert.ok(effective >= 10200 && effective <= 10250, `effective tokens within expected calibrated range: ${effective}`);

  // Case 2: Entry without API tokens -> fallback to estimate
  const unhydratedEntry = {
    apiTokens: 0,
    maxChars: 4000,
    maxTurns: 2,
    maxCodeChars: 0,
    systemTokens: 1500
  };
  const unhydrated = rules.calculateEffectiveTokens(unhydratedEntry, '', 'gemini');
  // 4000/4 + 2*120 + 1500 = 1000 + 240 + 1500 = 2740
  assert.equal(unhydrated, 2740);
});

test('extractConversationStats and hydrateFromTranscript preserve inputTokens, cacheReadTokens, outputTokens, and mtime', () => {
  rules.clearCache();
  const convKey = '/c/test-granular-stats-preservation';
  const storeMap = new Map();
  const mockStorage = {
    setItem: (k, v) => storeMap.set(k, String(v)),
    getItem: k => storeMap.get(k) || null,
    removeItem: k => storeMap.delete(k)
  };

  const now = Date.now();
  rules.hydrateFromTranscript(convKey, {
    maxChars: 20000,
    maxTurns: 3,
    apiTokens: 12500,
    inputTokens: 2000,
    cacheReadTokens: 10000,
    outputTokens: 500,
    mtime: now,
    blocks: [['turn-1', { length: 20000, codeChars: 0 }]]
  }, mockStorage);

  const doc = {
    location: { pathname: convKey },
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? { textContent: 'a'.repeat(20000) } : null,
    querySelectorAll: sel => sel === '[data-testid=conversation-navigator-turn]' ? [{}, {}, {}] : []
  };

  const stats = rules.extractConversationStats(doc, mockStorage);
  assert.equal(stats.apiTokens, 12500);
  assert.equal(stats.inputTokens, 2000);
  assert.equal(stats.cacheReadTokens, 10000);
  assert.equal(stats.outputTokens, 500);
  assert.equal(stats.mtime, now);

  // Stored state also preserved
  const loaded = rules.loadConversationState(convKey, mockStorage);
  assert.equal(loaded.inputTokens, 2000);
  assert.equal(loaded.cacheReadTokens, 10000);
  assert.equal(loaded.outputTokens, 500);
  assert.equal(loaded.mtime, now);
});

test('needsTranscript triggers rehydration when mtime is newer than updatedAt', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    }
  };
  const mockDoc = {
    createElement: tag => makeNode(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    head: makeNode('head'),
    body: makeNode('body'),
    location: { pathname: '/c/test-mtime-rehydration' }
  };

  const context = {
    window: mockWindow,
    document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace("{" + p + "}", val), k) },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  const convKey = '/c/test-mtime-rehydration';
  // Seed conversation with updatedAt = 1000, mtime = 1000
  rules.saveConversationState(convKey, {
    maxChars: 5000,
    maxTurns: 2,
    apiTokens: 1500,
    mtime: 1000,
    updatedAt: 1000
  }, mockWindow.localStorage);

  // When mtime is equal to updatedAt, needsTranscript is false
  assert.equal(context.__AGContextBudget.needsTranscript(convKey), false);

  // When local file mtime is newer (e.g. 2000 > 1000), needsTranscript returns true
  assert.equal(context.__AGContextBudget.needsTranscript(convKey, 2000), true);

  // When stored.mtime > stored.updatedAt
  rules.saveConversationState(convKey, {
    maxChars: 5000,
    maxTurns: 2,
    apiTokens: 1500,
    mtime: 3000,
    updatedAt: 1000
  }, mockWindow.localStorage);
  assert.equal(context.__AGContextBudget.needsTranscript(convKey), true);

  context.__AGContextBudget.destroy();
});

test('details popup renders cached tokens, active prompt tokens, and output tokens breakdown', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };

  const trigger = makeNode('button');
  trigger.setAttribute('data-testid', 'model-selector-trigger');
  const body = makeNode('body');
  const triggerContainer = makeNode('div');
  triggerContainer.append(trigger);
  body.append(triggerContainer);

  const mockDoc = {
    createElement: tag => makeNode(tag),
    querySelectorAll: sel => sel === '[data-testid=model-selector-trigger]' ? [trigger] : (body.querySelectorAll(sel) || []),
    querySelector: sel => sel === '[data-testid=model-selector-trigger]' ? trigger : body.querySelector(sel),
    addEventListener: () => {},
    removeEventListener: () => {},
    head: makeNode('head'),
    body,
    location: { pathname: '/c/test-modal-breakdown' }
  };

  const context = {
    window: mockWindow,
    document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace("{" + p + "}", val), k) },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // Hydrate conversation with granular tokens
  rules.hydrateFromTranscript('/c/test-modal-breakdown', {
    maxChars: 20000,
    maxTurns: 4,
    apiTokens: 18500,
    inputTokens: 3500,
    cacheReadTokens: 14000,
    outputTokens: 1000,
    blocks: [['turn-1', { length: 20000, codeChars: 0 }]]
  }, mockWindow.localStorage);

  // Trigger apply/refresh
  context.__AGContextBudget.refresh();

  // Find the pill inserted
  const pill = trigger.parentElement?.querySelector('[data-agpa-context-budget]');
  assert.ok(pill, 'context pill attached after trigger');

  // Click pill to open details popup
  pill.click();

  const popup = mockDoc.body.querySelector('.agpa-context-popup');
  assert.ok(popup, 'details popup opened');

  const breakdown = popup.querySelector('.agpa-context-breakdown');
  assert.ok(breakdown, 'breakdown element rendered in popup');
  assert.ok(breakdown.textContent.includes('Cached:'), 'displays cached tokens');
  assert.ok(breakdown.textContent.includes('Active prompt:'), 'displays active prompt tokens');
  assert.ok(breakdown.textContent.includes('Output:'), 'displays output tokens');

  context.__AGContextBudget.destroy();
});

test('global context hydration discards legacy per-turn telemetry', () => {
  rules.clearCache();
  const storeMap = new Map(), storage = {
    setItem: (k,v) => storeMap.set(k,String(v)), getItem:k=>storeMap.get(k)||null, removeItem:k=>storeMap.delete(k)
  };
  rules.hydrateFromTranscript('/c/global-only', {maxChars:10000,maxTurns:2,apiTokens:7500,inputTokens:1200,cacheReadTokens:5900,outputTokens:400,turnsList:[{footprint:9000}]},storage);
  const doc={location:{pathname:'/c/global-only'},body:{querySelectorAll:()=>[],querySelector:()=>null},querySelector:()=>null,querySelectorAll:()=>[]};
  const stats=rules.extractConversationStats(doc,storage);
  assert.ok(stats.tokens>0);assert.equal(stats.apiTokens,7500);
  assert.equal(stats.cacheReadTokens,5900);assert.equal(stats.turnsList,undefined);
  assert.ok(![...storeMap.values()].some(value=>value.includes('turnsList')));
});

test('compaction markers appear on compacted responses and popup displays clickable compacted turns array', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body');
  html.append(head, body);

  const trigger = makeNode('button');
  trigger.setAttribute('data-testid', 'model-selector-trigger');
  trigger.textContent = 'Gemini 4 Hydrogen (High)';
  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer';
  footer.append(trigger);
  composer.append(footer);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');

  const bars = [];
  for (let i = 1; i <= 3; i++) {
    const turnRow = makeNode('div');
    const bar = makeNode('div');
    const goodBtn = makeNode('button');
    goodBtn.setAttribute('aria-label', 'Good response');
    const copyBtn = makeNode('button');
    copyBtn.setAttribute('aria-label', 'Copy');
    bar.append(goodBtn, copyBtn);
    turnRow.append(bar);
    viewport.append(turnRow);
    bars.push(bar);
  }
  let scrolledTo = null;
  bars[1].scrollIntoView = () => { scrolledTo = 2; };

  body.append(viewport, composer);

  const origQueryAll = viewport.querySelectorAll.bind(viewport);
  viewport.querySelectorAll = sel => {
    if (sel === 'button[aria-label="Good response"]') {
      return bars.map(b => b.children[0]);
    }
    return origQueryAll(sel);
  };
  for (const bar of bars) {
    const origBarQuery = bar.querySelector.bind(bar);
    bar.querySelector = sel => {
      if (sel.includes('aria-label="Copy"')) return bar.children.find(c => c.getAttribute('aria-label') === 'Copy') || null;
      if (sel.startsWith('[data-agpa-compaction-marker]')) {
        const sigMatch = sel.match(/data-agpa-compaction-sig="([^"]+)"/);
        return bar.children.find(c =>
          c.hasAttribute('data-agpa-compaction-marker') &&
          (!sigMatch || c.getAttribute('data-agpa-compaction-sig') === sigMatch[1])
        ) || null;
      }
      return origBarQuery(sel);
    };
  }

  const mockDoc = {
    head,
    body,
    documentElement: html,
    location: { pathname: '/c/compaction-ui-test' },
    createElement: tag => makeNode(tag),
    querySelector: sel => {
      if (sel.includes('model-selector-trigger')) return trigger;
      if (sel === '[data-testid=autoscroll-viewport]') return viewport;
      if (sel === '[data-agpa-context-budget]') return footer.querySelector('[data-agpa-context-budget]');
      return body.querySelector(sel) || head.querySelector(sel);
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=model-selector-trigger]') return [trigger];
      if (sel === '[data-agpa-compaction-marker]') {
        return bars.flatMap(b => b.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')));
      }
      return [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)];
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    window: mockWindow,
    document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace('{' + p + '}', val), k) },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  context.__AGContextBudget.hydrateFromTranscript('/c/compaction-ui-test', {
    maxChars: 12000,
    maxTurns: 3,
    apiTokens: 45000,
    inputTokens: 20000,
    cacheReadTokens: 24000,
    outputTokens: 1000,
    compactions: [
      { turn: 2, preTokens: 256000, postTokens: 19000, count: 1, promptKey: 'turn two' },
      { turn: 3, preTokens: 260000, postTokens: 21000, count: 1, promptKey: 'turn three' }
    ]
  });

  assert.equal(bars[0].children.filter(c => c.hasAttribute('data-agpa-compaction-marker')).length, 0);
  const marker2 = bars[1].children.find(c => c.hasAttribute('data-agpa-compaction-marker'));
  const marker3 = bars[2].children.find(c => c.hasAttribute('data-agpa-compaction-marker'));
  assert.ok(marker2, 'turn 2 response bar has compaction marker');
  assert.ok(marker3, 'turn 3 response bar has compaction marker');
  assert.equal(bars[1].children.indexOf(marker2), 1, 'marker inserted before Copy button');
  assert.ok(marker2.getAttribute('title').includes('~256k'));
  assert.ok(marker2.getAttribute('title').includes('~19k'));

  const pill = footer.querySelector('[data-agpa-context-budget]');
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const popup = body.children.find(c => c.classList.contains('agpa-context-popup'));
  assert.ok(popup, 'popup opened');

  const chips = [];
  (function walk(node) {
    if (node.classList?.contains('agpa-context-compaction-chip')) chips.push(node);
    for (const ch of node.children || []) walk(ch);
  })(popup);

  assert.deepEqual(chips.map(c => c.textContent), ['#2', '#3']);
  chips[0].dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(scrolledTo, 2, 'clicking chip #2 scrolls to turn 2 response bar');

  context.__AGContextBudget.destroy();
});

test('compaction marker resolves virtualized top response even when its user-input-step is unmounted', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };
  const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
  html.append(head, body);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  const list = makeNode('div');
  list.className = 'relative flex flex-col gap-y-3';

  // Item 0: top virtualized response (Turn 27) with NO user-input-step mounted, only response bar
  const item27 = makeNode('div');
  item27.className = 'flex items-start';
  item27.textContent = 'Avvia TestMem5: se supera i 6 minuti il modulo rimosso è difettoso.';
  const bar27 = makeNode('div');
  const good27 = makeNode('button');
  good27.setAttribute('aria-label', 'Good response');
  const copy27 = makeNode('button');
  copy27.setAttribute('aria-label', 'Copy');
  bar27.append(good27, copy27);
  item27.append(bar27);

  // Item 1: Turn 28 mounted below with its user-input-step
  const item28 = makeNode('div');
  item28.className = 'flex items-start';
  const step28 = makeNode('div');
  step28.setAttribute('data-testid', 'user-input-step');
  step28.textContent = 'Ma potrebbe bloccarsi anche a test successivi al 25?';
  const bar28 = makeNode('div');
  const good28 = makeNode('button');
  good28.setAttribute('aria-label', 'Good response');
  const copy28 = makeNode('button');
  copy28.setAttribute('aria-label', 'Copy');
  bar28.append(good28, copy28);
  item28.append(step28, bar28);

  list.append(item27, item28);
  viewport.append(list);

  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer';
  composer.append(footer);
  body.append(viewport, composer);

  for (const [item, bar, good, copy, step] of [
    [item27, bar27, good27, copy27, null],
    [item28, bar28, good28, copy28, step28]
  ]) {
    item.querySelectorAll = sel => sel === 'button[aria-label="Good response"]' ? [good] : [];
    item.querySelector = sel => sel.includes('user-input-step') ? step : (sel === 'button[aria-label="Good response"]' ? good : null);
    bar.querySelector = sel => {
      if (sel.includes('aria-label="Copy"')) return copy;
      if (sel.startsWith('[data-agpa-compaction-marker]')) {
        const sigMatch = sel.match(/data-agpa-compaction-sig="([^"]+)"/);
        return bar.children.find(c =>
          c.hasAttribute('data-agpa-compaction-marker') &&
          (!sigMatch || c.getAttribute('data-agpa-compaction-sig') === sigMatch[1])
        ) || null;
      }
      return null;
    };
  }
  viewport.querySelector = sel => sel === '.relative.flex.flex-col.gap-y-3' ? list : null;
  viewport.querySelectorAll = sel => sel === 'button[aria-label="Good response"]' ? [good27, good28] : [];

  const mockDoc = {
    head, body, documentElement: html,
    location: { pathname: '/c/virtualized-turn27' },
    createElement: tag => makeNode(tag),
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? viewport : (body.querySelector(sel) || head.querySelector(sel)),
    querySelectorAll: sel => sel === '[data-agpa-compaction-marker]'
      ? [bar27, bar28].flatMap(b => b.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')))
      : [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    window: mockWindow, document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace('{' + p + '}', val), k) },
    setTimeout: () => 1, clearTimeout: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  context.__AGContextBudget.hydrateFromTranscript('/c/virtualized-turn27', {
    maxChars: 120000,
    maxTurns: 60,
    apiTokens: 179909,
    compactions: [{
      turn: 27,
      preTokens: 256931,
      postTokens: 13839,
      count: 1,
      promptKey: 'puoi farmi la lista dei 31 test di memte',
      nextPromptKey: 'ma potrebbe bloccarsi anche a test succe',
      responseTail: 'il modulo rimosso è difettoso.'
    }]
  });

  const marker27 = bar27.children.find(c => c.hasAttribute('data-agpa-compaction-marker'));
  assert.ok(marker27, 'virtualized Turn 27 response bar receives compaction marker');
  assert.equal(bar28.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')).length, 0);

  context.__AGContextBudget.destroy();
});

test('clicking compacted turn chip falls back to proportional viewport scroll when navigator dot is absent', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };
  const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
  html.append(head, body);

  let scrolledTop = null;
  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.scrollHeight = 12000;
  viewport.clientHeight = 800;
  viewport.scrollTop = 11000;
  viewport.scrollTo = ({ top }) => { scrolledTop = top; };

  const trigger = makeNode('button');
  trigger.setAttribute('data-testid', 'model-selector-trigger');
  trigger.textContent = 'Gemini 4 Hydrogen';
  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer';
  footer.append(trigger);
  composer.append(footer);
  body.append(viewport, composer);

  const mockDoc = {
    head, body, documentElement: html,
    location: { pathname: '/c/jump-fallback-test' },
    createElement: tag => makeNode(tag),
    querySelector: sel => {
      if (sel.includes('model-selector-trigger')) return trigger;
      if (sel === '[data-testid=autoscroll-viewport]') return viewport;
      if (sel === '[data-agpa-context-budget]') return footer.querySelector('[data-agpa-context-budget]');
      return body.querySelector(sel) || head.querySelector(sel);
    },
    querySelectorAll: sel => sel === '[data-testid=model-selector-trigger]' ? [trigger] : [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    window: mockWindow, document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace('{' + p + '}', val), k) },
    setTimeout: () => 1, clearTimeout: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  context.__AGContextBudget.hydrateFromTranscript('/c/jump-fallback-test', {
    maxChars: 120000,
    maxTurns: 60,
    apiTokens: 180000,
    compactions: [{ turn: 27, preTokens: 256000, postTokens: 14000, count: 1, promptKey: 'turn 27', nextPromptKey: 'turn 28', responseTail: 'done' }]
  });

  const pill = footer.querySelector('[data-agpa-context-budget]');
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const popup = body.children.find(c => c.classList.contains('agpa-context-popup'));
  const chip = [];
  (function walk(n) {
    if (n.classList?.contains('agpa-context-compaction-chip')) chip.push(n);
    for (const ch of n.children || []) walk(ch);
  })(popup);

  assert.equal(chip.length, 1);
  chip[0].dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  assert.ok(typeof scrolledTop === 'number' && scrolledTop > 4000 && scrolledTop < 6000, `expected proportional scroll near turn 27, got ${scrolledTop}`);

  context.__AGContextBudget.destroy();
});

test('resolveTurnNumberForPrompt resolves any turn number from hydrated blocks', () => {
  rules.clearCache();
  const storeMap = new Map();
  const storage = {
    getItem: k => storeMap.get(k) || null,
    setItem: (k, v) => storeMap.set(k, String(v)),
    removeItem: k => storeMap.delete(k)
  };
  const doc = { location: { pathname: '/c/resolve-turn-test' } };
  rules.hydrateFromTranscript('/c/resolve-turn-test', {
    maxChars: 5000,
    maxTurns: 60,
    apiTokens: 120000,
    blocks: [
      ['p:turn-27:Puoi farmi la lista dei 31 test di memtest', { length: 120, codeChars: 0 }],
      ['p:turn-57:Ecco il risultato dopo il riavvio', { length: 90, codeChars: 0 }]
    ],
    compactions: []
  }, storage);

  assert.equal(rules.resolveTurnNumberForPrompt('Ecco il risultato dopo il riavvio1m ago', doc, storage), 57);
  assert.equal(rules.resolveTurnNumberForPrompt('Puoi farmi la lista dei 31 test di memtest', doc, storage), 27);
  assert.equal(rules.resolveTurnNumberForPrompt('Unrelated prompt', doc, storage), null);
});

test('compaction marker matches /compact promptKey without leading slash and rejects short-prefix false positives', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };
  const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
  html.append(head, body);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  const list = makeNode('div');
  list.className = 'relative flex flex-col gap-y-3';

  // Non-turn flex spacer should be ignored by collectTurnItems
  const spacer = makeNode('div');
  spacer.className = 'flex';
  spacer.querySelector = () => null;

  // Turn 10: DOM shows "fix everything" (must NOT match short promptKey "fix")
  const item10 = makeNode('div');
  item10.className = 'flex items-start';
  const step10 = makeNode('div');
  step10.setAttribute('data-testid', 'user-input-step');
  step10.textContent = 'fix everything';
  const bar10 = makeNode('div');
  const good10 = makeNode('button');
  good10.setAttribute('aria-label', 'Good response');
  const copy10 = makeNode('button');
  copy10.setAttribute('aria-label', 'Copy');
  bar10.append(good10, copy10);
  item10.append(step10, bar10);

  // Turn 11: DOM renders "compact" without leading slash (must match promptKey "/compact")
  const item11 = makeNode('div');
  item11.className = 'flex items-start';
  const step11 = makeNode('div');
  step11.setAttribute('data-testid', 'user-input-step');
  step11.textContent = 'compact2m ago';
  const bar11 = makeNode('div');
  const good11 = makeNode('button');
  good11.setAttribute('aria-label', 'Good response');
  const copy11 = makeNode('button');
  copy11.setAttribute('aria-label', 'Copy');
  bar11.append(good11, copy11);
  item11.append(step11, bar11);

  list.append(spacer, item10, item11);
  viewport.append(list);

  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer';
  composer.append(footer);
  body.append(viewport, composer);

  for (const [item, bar, good, copy, step] of [
    [item10, bar10, good10, copy10, step10],
    [item11, bar11, good11, copy11, step11]
  ]) {
    item.querySelectorAll = sel => sel === 'button[aria-label="Good response"]' ? [good] : [];
    item.querySelector = sel => sel.includes('user-input-step') ? step : (sel === 'button[aria-label="Good response"]' ? good : null);
    bar.querySelector = sel => {
      if (sel.includes('aria-label="Copy"')) return copy;
      if (sel.startsWith('[data-agpa-compaction-marker]')) {
        const sigMatch = sel.match(/data-agpa-compaction-sig="([^"]+)"/);
        return bar.children.find(c =>
          c.hasAttribute('data-agpa-compaction-marker') &&
          (!sigMatch || c.getAttribute('data-agpa-compaction-sig') === sigMatch[1])
        ) || null;
      }
      return null;
    };
  }
  viewport.querySelector = sel => sel === '.relative.flex.flex-col.gap-y-3' ? list : null;
  viewport.querySelectorAll = sel => sel === 'button[aria-label="Good response"]' ? [good10, good11] : [];

  const mockDoc = {
    head, body, documentElement: html,
    location: { pathname: '/c/slash-compact-match' },
    createElement: tag => makeNode(tag),
    querySelector: sel => sel === '[data-testid=autoscroll-viewport]' ? viewport : (body.querySelector(sel) || head.querySelector(sel)),
    querySelectorAll: sel => sel === '[data-agpa-compaction-marker]'
      ? [bar10, bar11].flatMap(b => b.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')))
      : [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  let localePrefix = 'EN';
  const subscribers = [];
  const context = {
    window: mockWindow, document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: {
      t: (k, v = {}) => localePrefix + ':' + Object.entries(v).reduce((s, [p, val]) => s.replace('{' + p + '}', val), k),
      subscribe: fn => { subscribers.push(fn); return () => {}; }
    },
    setTimeout: () => 1, clearTimeout: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  vm.createContext(context);
  vm.runInContext(script, context);

  context.__AGContextBudget.hydrateFromTranscript('/c/slash-compact-match', {
    maxChars: 50000,
    maxTurns: 20,
    apiTokens: 90000,
    compactions: [
      { turn: 5, preTokens: 200000, postTokens: 15000, count: 1, promptKey: 'fix' },
      { turn: 11, preTokens: 250000, postTokens: 18000, count: 1, promptKey: '/compact' }
    ]
  });

  // Turn 5 ("fix") must NOT falsely match "fix everything" on bar10; Turn 11 ("/compact") MUST match "compact2m ago" on bar11
  assert.equal(bar10.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')).length, 0);
  const marker11 = bar11.children.find(c => c.hasAttribute('data-agpa-compaction-marker'));
  assert.ok(marker11, 'DOM "compact2m ago" matches promptKey "/compact"');
  assert.ok(marker11.getAttribute('title').startsWith('EN:'));

  // Locale change updates existing marker title and aria-label in-place
  localePrefix = 'IT';
  subscribers.forEach(fn => fn());
  assert.ok(marker11.getAttribute('title').startsWith('IT:'), 'marker title updates on locale change');
  assert.ok(marker11.getAttribute('aria-label').startsWith('IT:'), 'marker aria-label updates on locale change');

  context.__AGContextBudget.destroy();
});

test('compaction chips use role="group" container and preserve native button role', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };
  const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
  html.append(head, body);

  const trigger = makeNode('button');
  trigger.setAttribute('data-testid', 'model-selector-trigger');
  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer';
  footer.append(trigger);
  composer.append(footer);
  body.append(composer);

  const mockDoc = {
    head, body, documentElement: html,
    location: { pathname: '/c/a11y-chips-test' },
    createElement: tag => makeNode(tag),
    querySelector: sel => {
      if (sel.includes('model-selector-trigger')) return trigger;
      if (sel === '[data-agpa-context-budget]') return footer.querySelector('[data-agpa-context-budget]');
      return body.querySelector(sel) || head.querySelector(sel);
    },
    querySelectorAll: sel => sel === '[data-testid=model-selector-trigger]' ? [trigger] : [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const context = {
    window: mockWindow, document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace('{' + p + '}', val), k) },
    setTimeout: () => 1, clearTimeout: () => {}
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  vm.createContext(context);
  vm.runInContext(script, context);

  context.__AGContextBudget.hydrateFromTranscript('/c/a11y-chips-test', {
    maxChars: 12000,
    maxTurns: 4,
    apiTokens: 45000,
    compactions: [{ turn: 2, preTokens: 250000, postTokens: 18000, count: 2, promptKey: 'step 2' }]
  });

  const pill = footer.querySelector('[data-agpa-context-budget]');
  pill.click();
  const popup = body.children.find(c => c.classList.contains('agpa-context-popup'));
  assert.ok(popup, 'popup opened');

  let chipList = null;
  const chips = [];
  (function walk(n) {
    if (n.classList?.contains('agpa-context-compactions-array')) chipList = n;
    if (n.classList?.contains('agpa-context-compaction-chip')) chips.push(n);
    for (const ch of n.children || []) walk(ch);
  })(popup);

  assert.ok(chipList, 'compactions chip container rendered');
  assert.equal(chipList.getAttribute('role'), 'group', 'chip container uses role="group"');
  assert.equal(chips.length, 1);
  assert.equal(chips[0].tagName, 'BUTTON');
  assert.equal(chips[0].getAttribute('role'), null, 'chip button preserves native button role');
  assert.equal(chips[0].textContent, '#2 ×2');

  context.__AGContextBudget.destroy();
});

test('jumpToCompactionTurn cancels on manual scroll, chat switch, and nativeContext handoff, and cleans markers', () => {
  const storeMap = new Map();
  const mockWindow = {
    localStorage: {
      getItem: k => storeMap.get(k) || null,
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: k => storeMap.delete(k)
    },
    innerWidth: 1024,
    innerHeight: 768
  };
  const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
  html.append(head, body);

  const viewport = makeNode('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.scrollHeight = 12000;
  viewport.clientHeight = 800;
  viewport.scrollTop = 9000;
  viewport.scrollTo = ({ top }) => { viewport.scrollTop = top; };

  const bar1 = makeNode('div');
  const good1 = makeNode('button');
  good1.setAttribute('aria-label', 'Good response');
  const copy1 = makeNode('button');
  copy1.setAttribute('aria-label', 'Copy');
  bar1.append(good1, copy1);
  bar1.querySelector = sel => sel.includes('aria-label="Copy"') ? copy1 : (sel.startsWith('[data-agpa-compaction-marker]') ? bar1.children.find(c => c.hasAttribute('data-agpa-compaction-marker')) || null : null);
  viewport.append(bar1);
  viewport.querySelectorAll = sel => sel === 'button[aria-label="Good response"]' ? [good1] : [];

  const trigger = makeNode('button');
  trigger.setAttribute('data-testid', 'model-selector-trigger');
  const composer = makeNode('div');
  composer.className = 'surface-composer';
  const footer = makeNode('div');
  footer.className = '@container/input-footer';
  footer.append(trigger);
  composer.append(footer);
  body.append(viewport, composer);

  let nativeIndicator = null;
  let nextTimerId = 1;
  const activeTimers = new Map();
  const mockSetTimeout = (fn) => {
    const id = nextTimerId++;
    activeTimers.set(id, fn);
    return id;
  };
  const mockClearTimeout = (id) => {
    activeTimers.delete(id);
  };

  const docListeners = new Map();
  const mockDoc = {
    head, body, documentElement: html,
    location: { pathname: '/c/jump-cancel-chat-1' },
    createElement: tag => makeNode(tag),
    querySelector: sel => {
      if (sel === '[data-testid=context-usage-indicator]') return nativeIndicator;
      if (sel.includes('model-selector-trigger')) return trigger;
      if (sel === '[data-testid=autoscroll-viewport]') return viewport;
      if (sel === '[data-agpa-context-budget]') return footer.querySelector('[data-agpa-context-budget]');
      return body.querySelector(sel) || head.querySelector(sel);
    },
    querySelectorAll: sel => {
      if (sel === '[data-testid=model-selector-trigger]') return [trigger];
      if (sel === '[data-agpa-compaction-marker]') return bar1.children.filter(c => c.hasAttribute('data-agpa-compaction-marker'));
      return [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)];
    },
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      docListeners.get(type)?.delete(fn);
    },
    dispatchEvent: evt => {
      for (const fn of [...(docListeners.get(evt.type) || [])]) fn(evt);
    }
  };

  const context = {
    window: mockWindow, document: mockDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: rules,
    __AGPAI18n: { t: (k, v = {}) => Object.entries(v).reduce((s, [p, val]) => s.replace('{' + p + '}', val), k) },
    setTimeout: mockSetTimeout,
    clearTimeout: mockClearTimeout
  };
  context.globalThis = context;
  context.location = mockDoc.location;
  context.localStorage = mockWindow.localStorage;

  vm.createContext(context);
  vm.runInContext(script, context);

  context.__AGContextBudget.hydrateFromTranscript('/c/jump-cancel-chat-1', {
    maxChars: 120000,
    maxTurns: 60,
    apiTokens: 180000,
    compactions: [{ turn: 27, preTokens: 256000, postTokens: 14000, count: 1, promptKey: 'turn 27' }]
  });

  const openAndClickChip = () => {
    const pill = footer.querySelector('[data-agpa-context-budget]');
    pill.click();
    const popup = body.children.find(c => c.classList.contains('agpa-context-popup'));
    const chips = [];
    (function walk(n) {
      if (n.classList?.contains('agpa-context-compaction-chip')) chips.push(n);
      for (const ch of n.children || []) walk(ch);
    })(popup);
    chips[0].click();
  };

  // 1. Manual scroll (wheel) and click (pointerdown) abort pending jump timer
  openAndClickChip();
  assert.equal(activeTimers.size, 1, 'jump refinement timer scheduled');
  mockDoc.dispatchEvent({ type: 'wheel' });
  assert.equal(activeTimers.size, 0, 'manual wheel event cancels jump timer');

  openAndClickChip();
  assert.equal(activeTimers.size, 1, 'jump refinement timer scheduled before click cancel');
  mockDoc.dispatchEvent({ type: 'pointerdown' });
  assert.equal(activeTimers.size, 0, 'click (pointerdown) anywhere cancels jump timer');

  // 2. Chat switch cancels pending jump timer, closes popup, and clears compaction markers
  openAndClickChip();
  assert.equal(activeTimers.size, 1, 'jump timer active before chat switch');
  mockDoc.location.pathname = '/c/jump-cancel-chat-2';
  context.__AGContextBudget.refresh();
  assert.equal(activeTimers.size, 0, 'chat switch cancels jump timer');
  assert.equal(body.children.find(c => c.classList.contains('agpa-context-popup')), undefined, 'chat switch closes popup');

  // 3. Switch back to compacted chat with single-turn bar so marker is placed, then trigger nativeContext handoff
  mockDoc.location.pathname = '/c/jump-cancel-chat-1';
  context.__AGContextBudget.hydrateFromTranscript('/c/jump-cancel-chat-1', {
    maxChars: 12000,
    maxTurns: 1,
    apiTokens: 45000,
    compactions: [{ turn: 1, preTokens: 256000, postTokens: 14000, count: 1, promptKey: 'turn 1' }]
  });
  assert.equal(bar1.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')).length, 1, 'marker placed before native handoff');

  // Start a jump on a virtualized turn and then mount native context indicator
  context.__AGContextBudget.hydrateFromTranscript('/c/jump-cancel-chat-1', {
    maxChars: 120000,
    maxTurns: 60,
    apiTokens: 180000,
    compactions: [{ turn: 27, preTokens: 256000, postTokens: 14000, count: 1, promptKey: 'turn 27' }]
  });
  openAndClickChip();
  assert.equal(activeTimers.size, 1, 'jump timer scheduled before native handoff');
  nativeIndicator = makeNode('div');
  nativeIndicator.setAttribute('data-testid', 'context-usage-indicator');
  context.__AGContextBudget.refresh();
  assert.equal(activeTimers.size, 0, 'nativeContext handoff cancels jump timer');
  assert.equal(bar1.children.filter(c => c.hasAttribute('data-agpa-compaction-marker')).length, 0, 'nativeContext handoff removes compaction markers');

  context.__AGContextBudget.destroy();
});

test('hydrateFromTranscript preserves compactions when isCompacted is true and clears stale compactions otherwise', () => {
  rules.clearCache();
  const storeMap = new Map();
  const storage = {
    getItem: k => storeMap.get(k) || null,
    setItem: (k, v) => storeMap.set(k, String(v)),
    removeItem: k => storeMap.delete(k)
  };
  const convKey = '/c/is-compacted-state-test';

  // Initial hydration with compaction event
  rules.hydrateFromTranscript(convKey, {
    maxChars: 50000,
    maxTurns: 10,
    apiTokens: 40000,
    isCompacted: true,
    compactions: [{ turn: 8, preTokens: 250000, postTokens: 18000, count: 1, promptKey: '/compact' }]
  }, storage);

  const doc = { location: { pathname: convKey }, querySelector: () => null, querySelectorAll: () => [] };
  let stats = rules.extractConversationStats(doc, storage);
  assert.equal(stats.compactions.length, 1);
  assert.equal(stats.compactions[0].turn, 8);

  // Subsequent hydration with isCompacted: true and no new compactions array preserves prior compaction history
  rules.hydrateFromTranscript(convKey, {
    maxChars: 60000,
    maxTurns: 12,
    apiTokens: 52000,
    isCompacted: true
  }, storage);
  stats = rules.extractConversationStats(doc, storage);
  assert.equal(stats.compactions.length, 1, 'isCompacted preserves existing compactions when omitted');
  assert.equal(stats.compactions[0].turn, 8);

  // Re-hydration with an explicit empty compactions array and isCompacted: false clears state cleanly
  rules.hydrateFromTranscript(convKey, {
    maxChars: 5000,
    maxTurns: 1,
    apiTokens: 2000,
    isCompacted: false,
    compactions: []
  }, storage);
  stats = rules.extractConversationStats(doc, storage);
  assert.equal(stats.compactions.length, 0, 'explicit empty compactions resets state cleanly');
});
