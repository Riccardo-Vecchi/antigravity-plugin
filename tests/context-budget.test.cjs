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
  assert.ok(pill.getAttribute('title').includes('86%'), 'saturated ring exposes utilization in its tooltip');

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
