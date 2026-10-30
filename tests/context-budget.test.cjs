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

  // Anthropic Claude (Sonnet 4.6 and Opus 4.6 both have 1M)
  assert.equal(rules.detectActiveModel(makeDoc('Claude Sonnet 4.6')).ceiling, 1000000);
  assert.equal(rules.detectActiveModel(makeDoc('Claude Opus 4.6')).ceiling, 1000000);

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

test('context budget component attaches pill, reflects levels and allows inserting /compact', async () => {
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
    if (selector === '.agpa-context-close') return node.classList.contains('agpa-context-close');
    if (selector === '.agpa-context-compact-btn') return node.classList.contains('agpa-context-compact-btn');
    if (selector === '.surface-composer') return node.classList.contains('surface-composer');
    if (selector === '[data-testid=autoscroll-viewport]') return node.getAttribute('data-testid') === 'autoscroll-viewport';
    if (selector === '[data-testid=conversation-navigator-turn]') return node.getAttribute('data-testid') === 'conversation-navigator-turn';
    if (selector.includes('input-footer')) return node.className.includes('input-footer');
    if (selector.includes('role=combobox')) return node.getAttribute('role') === 'combobox';
    return false;
  }

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
  assert.ok(pill.textContent.includes('k'), 'pill shows estimated k tokens');

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
  assert.ok(pill.textContent.includes('/compact'), 'saturated pill mentions /compact');

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
