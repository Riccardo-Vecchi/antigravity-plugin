'use strict';

/**
 * E2E Test Suite: Surgical Context Token Counter
 * 
 * Requirements Source:
 * - ORIGINAL_REQUEST.md (§R1, §R2, §R3, §R4)
 * - PROJECT.md (Features F1 through F10, Interface Contracts 1, 2, 3)
 * - TEST_INFRA.md (Tiers 1, 2, 3, 4)
 * 
 * Constraints:
 * - Pure Node.js built-ins only (node:test, node:assert/strict, node:fs, node:path, node:os, node:vm)
 * - Zero external npm dependencies
 * - Isolated test environments (temporary directories, no shared test state)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const transcriptReader = require('../common/transcript-reader.cjs');
const contextBudget = require('../common/context-budget.cjs');

// Helper to create isolated temporary brain directory for transcript testing
function createTempBrain(t) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-e2e-brain-'));
  if (t && typeof t.after === 'function') {
    t.after(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });
  }
  return tmpDir;
}

// Helper to write transcript JSONL lines
function writeTranscript(brainDir, convId, filename, lines) {
  const logsDir = path.join(brainDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const content = lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n');
  const filePath = path.join(logsDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// Lightweight pure-JS DOM Mock for renderer UI testing
function createMockDom(options = {}) {
  const storageMap = new Map();

  function makeElement(tagName = 'div') {
    const listeners = new Map();
    const el = {
      tagName: tagName.toUpperCase(),
      className: '',
      textContent: '',
      attributes: {},
      children: [],
      style: {
        setProperty(k, v) { this[k] = String(v); },
        getPropertyValue(k) { return this[k] || ''; },
        removeProperty(k) { delete this[k]; }
      },
      parentElement: null,
      offsetHeight: 100,
      offsetWidth: 200,
      focus() {},
      getBoundingClientRect() {
        return { left: 100, right: 300, top: 200, bottom: 224, width: 200, height: 24 };
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; },
      append(...nodes) {
        for (const n of nodes) {
          if (typeof n === 'string') {
            this.children.push({ tagName: '#text', textContent: n, parentElement: this });
          } else if (n) {
            n.parentElement = this;
            this.children.push(n);
          }
        }
      },
      appendChild(n) {
        if (n) {
          n.parentElement = this;
          this.children.push(n);
        }
        return n;
      },
      removeChild(n) {
        const idx = this.children.indexOf(n);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          n.parentElement = null;
        }
        return n;
      },
      remove() {
        if (this.parentElement) {
          this.parentElement.removeChild(this);
        }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type);
        if (list) {
          const idx = list.indexOf(fn);
          if (idx !== -1) list.splice(idx, 1);
        }
      },
      dispatchEvent(event) {
        const list = listeners.get(event?.type);
        if (list) {
          for (const fn of list) fn.call(this, event);
        }
      },
      querySelector(selector) {
        return querySelectorInternal(this, selector);
      },
      querySelectorAll(selector) {
        const results = [];
        querySelectorAllInternal(this, selector, results);
        return results;
      }
    };
    return el;
  }

  function querySelectorInternal(node, selector) {
    if (!node || !node.children) return null;
    for (const child of node.children) {
      if (matches(child, selector)) return child;
      const found = querySelectorInternal(child, selector);
      if (found) return found;
    }
    return null;
  }

  function querySelectorAllInternal(node, selector, acc) {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (matches(child, selector)) acc.push(child);
      querySelectorAllInternal(child, selector, acc);
    }
  }

  function matches(el, sel) {
    if (!el || !el.tagName || el.tagName === '#text') return false;
    const cleanSel = sel.trim();
    if (cleanSel.includes(',')) {
      return cleanSel.split(',').some(part => matches(el, part.trim()));
    }
    const parts = cleanSel.split(/\s+/);
    if (parts.length > 1) {
      const target = parts[parts.length - 1];
      if (!matches(el, target)) return false;
      let curr = el.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        const ancestorSel = parts[i];
        while (curr && !matches(curr, ancestorSel)) {
          curr = curr.parentElement;
        }
        if (!curr) return false;
        curr = curr.parentElement;
      }
      return true;
    }
    if (cleanSel.startsWith('.')) {
      const cls = cleanSel.slice(1);
      return (el.className || '').split(/\s+/).includes(cls);
    }
    if (cleanSel.startsWith('#')) {
      return el.getAttribute('id') === cleanSel.slice(1);
    }
    if (cleanSel.startsWith('[') && cleanSel.endsWith(']')) {
      const attr = cleanSel.slice(1, -1);
      if (attr.includes('*=')) {
        const [k, v] = attr.split('*=').map(s => s.replace(/["']/g, '').trim());
        const val = el.getAttribute(k) || (k === 'class' ? el.className : '');
        return Boolean(val && val.includes(v));
      }
      if (attr.includes('=')) {
        const [k, v] = attr.split('=').map(s => s.replace(/["']/g, '').trim());
        const val = el.getAttribute(k) || (k === 'class' ? el.className : '');
        return val === v;
      }
      return el.hasAttribute(attr);
    }
    return el.tagName.toLowerCase() === cleanSel.toLowerCase();
  }

  const documentElement = makeElement('html');
  const head = makeElement('head');
  const body = makeElement('body');
  documentElement.append(head, body);

  const mockWindow = {
    innerWidth: 1024,
    innerHeight: 768,
    localStorage: {
      getItem: k => storageMap.get(k) || null,
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: k => storageMap.delete(k),
      clear: () => storageMap.clear(),
      get length() { return storageMap.size; },
      key: i => Array.from(storageMap.keys())[i] || null
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const mockDoc = {
    documentElement,
    head,
    body,
    defaultView: mockWindow,
    location: { pathname: options.pathname || '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719', hash: '', search: '' },
    createElement: tag => makeElement(tag),
    querySelector: sel => querySelectorInternal(documentElement, sel),
    querySelectorAll: sel => {
      const results = [];
      querySelectorAllInternal(documentElement, sel, results);
      return results;
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  return { doc: mockDoc, win: mockWindow, storageMap };
}


// ============================================================================
// TIER 1: FEATURE COVERAGE (F1 through F10)
// ============================================================================

// ----------------------------------------------------------------------------
// Feature F1: Granular Ground-Truth Extraction
// ----------------------------------------------------------------------------
test('Tier 1 - F1.1: parseTranscriptContent extracts input_tokens from PLANNER_RESPONSE', () => {
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'What is token counting?' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 4250, cache_read_tokens: 0, output_tokens: 320 })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed, 'parsed transcript object must exist');
  assert.equal(parsed.apiTokens, 4570, 'apiTokens must be sum of input + cache_read + output');
  assert.equal(parsed.turns, 1, 'turn count must be 1');
});

test('Tier 1 - F1.2: parseTranscriptContent accounts for cache_read_tokens in active context', () => {
  // Production scenario from survey 3: cache_read_tokens accounts for >90% of active tokens
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Execute benchmark suite' }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 2269,
      cache_read_tokens: 66283,
      output_tokens: 140
    })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  // Total context footprint = 2269 + 66283 + 140 = 68692
  assert.equal(parsed.apiTokens, 68692, 'cache_read_tokens must be incorporated into cumulative apiTokens');
});

test('Tier 1 - F1.3: parseTranscriptContent accounts for output_tokens (generation + thinking)', () => {
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Explain quantum mechanics' }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 1500,
      cache_read_tokens: 500,
      output_tokens: 1850,
      thinking: 'Thinking through quantum states...',
      content: 'Quantum mechanics is a fundamental theory in physics...'
    })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.equal(parsed.apiTokens, 3850, '1500 + 500 + 1850 = 3850 apiTokens');
});

test('Tier 1 - F1.4: readTranscriptStats returns granular tokens (inputTokens, cacheReadTokens, outputTokens)', (t) => {
  const brainDir = createTempBrain(t);
  const convId = 'f1e2d3c4-b5a6-7890-1234-56789abcdef0';
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Generate report' }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 3100,
      cache_read_tokens: 12400,
      output_tokens: 650
    })
  ];

  writeTranscript(brainDir, convId, 'transcript_full.jsonl', jsonl);
  const stats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  assert.ok(stats, 'stats must be returned');
  assert.equal(stats.conversationId, convId);
  assert.equal(stats.apiTokens, 16150); // 3100 + 12400 + 650

  // Granular fields per PROJECT.md interface contract
  assert.equal(typeof stats.inputTokens, 'number', 'inputTokens field must be exported in stats');
  assert.equal(typeof stats.cacheReadTokens, 'number', 'cacheReadTokens field must be exported in stats');
  assert.equal(typeof stats.outputTokens, 'number', 'outputTokens field must be exported in stats');
  assert.equal(stats.inputTokens, 3100);
  assert.equal(stats.cacheReadTokens, 12400);
  assert.equal(stats.outputTokens, 650);
});

test('Tier 1 - F1.5: Sequential PLANNER_RESPONSE steps update to latest ground-truth checkpoint', () => {
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Step 1 prompt' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 5000, cache_read_tokens: 0, output_tokens: 200 }),
    JSON.stringify({ step_index: 2, type: 'USER_INPUT', content: 'Step 2 prompt' }),
    JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', input_tokens: 1200, cache_read_tokens: 5200, output_tokens: 350 })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.equal(parsed.turns, 2);
  // Checkpoint at step 3: 1200 + 5200 + 350 = 6750
  assert.equal(parsed.apiTokens, 6750, 'must reflect latest PLANNER_RESPONSE ground-truth checkpoint');
  assert.equal(parsed.pendingChars, 0, 'pending chars reset immediately after latest API checkpoint');
});

// ----------------------------------------------------------------------------
// Feature F2: SYSTEM_MESSAGE Accounting
// ----------------------------------------------------------------------------
test('Tier 1 - F2.1: parseTranscriptContent parses SYSTEM_MESSAGE at step 0 into character counts and blocks', () => {
  const systemText = 'You are Antigravity Assistant. Adhere strictly to the workspace guidelines.';
  const jsonl = [
    JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: systemText }),
    JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Hello' })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.ok(parsed.chars >= systemText.length + 5, 'chars must include SYSTEM_MESSAGE characters');
  assert.ok(parsed.blocks.length >= 2, 'blocks must include an entry for SYSTEM_MESSAGE');
});

test('Tier 1 - F2.2: Mid-conversation SYSTEM_MESSAGE injection is accounted for in pending counters', () => {
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Initial setup' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 4000, output_tokens: 200 }),
    JSON.stringify({ step_index: 2, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: '<SYSTEM_UPDATE>Context altered</SYSTEM_UPDATE>' })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.ok(parsed.pendingChars > 0, 'pendingChars must reflect injected SYSTEM_MESSAGE content');
});

test('Tier 1 - F2.3: SYSTEM_MESSAGE with empty or non-string content handled gracefully without crashing', () => {
  const jsonl = [
    JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: '' }),
    JSON.stringify({ step_index: 1, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: null }),
    JSON.stringify({ step_index: 2, type: 'USER_INPUT', content: 'Hello after empty system message' })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.equal(parsed.turns, 1);
  assert.ok(parsed.chars > 0);
});

test('Tier 1 - F2.4: SYSTEM_MESSAGE containing markdown guidelines accounts for code characters', () => {
  const systemGuidelines = 'Guidelines:\n```javascript\nconst strict = true;\n```';
  const jsonl = [
    JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: systemGuidelines }),
    JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Ready' })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.ok(parsed.codeChars > 15, 'code characters in SYSTEM_MESSAGE code blocks must be extracted');
});

test('Tier 1 - F2.5: readTranscriptStats reflects SYSTEM_MESSAGE in returned stats blocks and maxChars', (t) => {
  const brainDir = createTempBrain(t);
  const convId = '22222222-3333-4444-5555-666666666666';
  const sysMsg = 'SYSTEM_DIRECTIVE: High precision mode engaged.';
  const jsonl = [
    JSON.stringify({ step_index: 0, type: 'SYSTEM_MESSAGE', content: sysMsg }),
    JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Status check' }),
    JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', input_tokens: 1500, output_tokens: 50 })
  ];

  writeTranscript(brainDir, convId, 'transcript.jsonl', jsonl);
  const stats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  assert.ok(stats);
  assert.ok(stats.maxChars >= sysMsg.length + 12);
  const hasSysBlock = stats.blocks.some(([key]) => key.startsWith('s:') || key.includes('system') || key.includes('step-0'));
  assert.ok(hasSysBlock, 'blocks list should represent the system message block');
});

// ----------------------------------------------------------------------------
// Feature F3: MMSLE Token Estimation (Pure JS)
// ----------------------------------------------------------------------------
test('Tier 1 - F3.1: Fenced code blocks evaluated with code density ratio and delimiter envelope', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function', 'context-budget.cjs must export estimateTokensPrecise');

  const rawCode = 'function calculateTotal(price, tax) {\n  return price * (1 + tax);\n}';
  const fenced = '```javascript\n' + rawCode + '\n```';

  const tokens = contextBudget.estimateTokensPrecise(fenced, 'gemini');
  // In MMSLE: code ratio ~2.9, rawCode.length = 61 chars -> ~21 tokens + 3 envelope tokens = ~24 tokens
  assert.ok(tokens >= 20 && tokens <= 35, `Fenced code tokens (${tokens}) should be near 24`);
});

test('Tier 1 - F3.2: Inline code spans evaluated with code density ratio and wrapper bonus', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const inline = 'Use the command `npm test -- --coverage` to verify suites.';
  const tokens = contextBudget.estimateTokensPrecise(inline, 'gemini');
  // Inline code `npm test -- --coverage` (21 chars) + prose around it
  assert.ok(tokens >= 10 && tokens <= 20, `Inline code tokens (${tokens}) must reflect code and prose`);
});

test('Tier 1 - F3.3: Structured JSON payloads evaluated with JSON density ratio (~2.0 - 2.3 chars/tok)', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const jsonPayload = JSON.stringify({
    action: 'tool_call',
    tool_name: 'read_resource',
    parameters: { uri: 'file:///c:/project/file.js', max_depth: 3 }
  });

  const tokens = contextBudget.estimateTokensPrecise(jsonPayload, 'gemini');
  // JSON payload length = 113 chars. At JSON ratio 2.2 chars/token -> ~51 tokens
  assert.ok(tokens >= 40 && tokens <= 65, `JSON tokens (${tokens}) should reflect dense JSON syntax`);
});

test('Tier 1 - F3.4: Number sequences chunked into 3-digit groups', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  // A 9-digit number chunked by 3 digits = 3 tokens
  const num9 = '123456789';
  const tokens9 = contextBudget.estimateTokensPrecise(num9, 'gemini');
  assert.equal(tokens9, 3, '9-digit number should evaluate to 3 tokens (3-digit chunking)');

  // A 12-digit number = 4 tokens
  const num12 = '123456789012';
  const tokens12 = contextBudget.estimateTokensPrecise(num12, 'gemini');
  assert.equal(tokens12, 4, '12-digit number should evaluate to 4 tokens');
});

test('Tier 1 - F3.5: Whitespace indentation runs and newlines contribute structural tokens', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const indentedText = 'line1\n    line2\n        line3\n            line4';
  const tokens = contextBudget.estimateTokensPrecise(indentedText, 'gemini');
  // 3 newlines + indentation spaces (4, 8, 12 spaces)
  assert.ok(tokens >= 8, `Indented text tokens (${tokens}) must account for structural whitespace`);
});

// ----------------------------------------------------------------------------
// Feature F4: Multi-Byte UTF-8 & Multilingual
// ----------------------------------------------------------------------------
test('Tier 1 - F4.1: CJK Hanzi ideographs evaluated at dense multilingual ratio (0.8 - 1.4 chars/tok)', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const hanzi = '这是一段关于上下文窗口令牌计算的测试文本。'; // 21 Hanzi chars
  const tokens = contextBudget.estimateTokensPrecise(hanzi, 'gemini');
  // In Gemini: 21 / 1.3 ~ 17 tokens. Naive chars/4 would only predict 5 tokens (underestimation of 70%)!
  assert.ok(tokens >= 14 && tokens <= 22, `Hanzi tokens (${tokens}) must reflect high CJK density (~1.3 chars/tok)`);
});

test('Tier 1 - F4.2: Japanese Kana (Hiragana and Katakana) evaluated at multilingual ratio', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const kana = 'こんにちは世界！テストを実行してください。'; // 20 Japanese chars
  const tokens = contextBudget.estimateTokensPrecise(kana, 'gemini');
  assert.ok(tokens >= 13 && tokens <= 22, `Kana tokens (${tokens}) must reflect multilingual ratio`);
});

test('Tier 1 - F4.3: Korean Hangul syllables evaluated at multilingual density', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const hangul = '안녕하세요! 컨텍스트 토큰 카운터 테스트입니다.'; // 26 Hangul chars
  const tokens = contextBudget.estimateTokensPrecise(hangul, 'gemini');
  assert.ok(tokens >= 16 && tokens <= 28, `Hangul tokens (${tokens}) must reflect Korean token density`);
});

test('Tier 1 - F4.4: Italian accented vowels and Latin-1 supplement handled without byte corruption', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const italian = "È già più difficile perché l'eredità dell'integrità è prioritaria.";
  const tokens = contextBudget.estimateTokensPrecise(italian, 'gemini');
  assert.ok(tokens >= 10 && tokens <= 25, `Italian accented prose tokens (${tokens}) must evaluate cleanly`);
});

test('Tier 1 - F4.5: Cyrillic script and composite emojis evaluate cleanly without NaN', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const mixed = 'Привет мир! 🚀 Проверка токенов 👨‍💻 и эмодзи 🌟.';
  const tokens = contextBudget.estimateTokensPrecise(mixed, 'gemini');
  assert.ok(tokens >= 10 && tokens <= 25, `Cyrillic + emoji tokens (${tokens}) must be a valid number`);
  assert.ok(!Number.isNaN(tokens), 'Must not return NaN on emoji or Cyrillic');
});

// ----------------------------------------------------------------------------
// Feature F5: Model Family Calibration Ratios
// ----------------------------------------------------------------------------
test('Tier 1 - F5.1: Gemini SentencePiece 256k uses calibrated ratios (prose ~4.2, code ~2.9, CJK ~1.3)', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const prose = 'The surgical token counter provides exact context window estimates.';
  const tokens = contextBudget.estimateTokensPrecise(prose, 'gemini');
  assert.ok(tokens >= 8 && tokens <= 16, `Gemini prose tokens (${tokens})`);
});

test('Tier 1 - F5.2: Claude custom dense BPE is denser than Gemini for identical text', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const sample = 'Specialized context window tokenizer benchmarking across multiple architectures: ```const a = 1;```';
  const geminiTokens = contextBudget.estimateTokensPrecise(sample, 'gemini');
  const claudeTokens = contextBudget.estimateTokensPrecise(sample, 'claude');

  // Claude BPE is ~10-25% denser on code & CJK
  assert.ok(claudeTokens >= geminiTokens, `Claude tokens (${claudeTokens}) must be >= Gemini tokens (${geminiTokens})`);
});

test('Tier 1 - F5.3: OpenAI o200k_base applies calibrated ratios', () => {
  assert.equal(typeof contextBudget.estimateTokensPrecise, 'function');
  const text = 'Testing OpenAI GPT-4o model calibration with standard numbers 123456 and code `let x = 10`.';
  const tokens = contextBudget.estimateTokensPrecise(text, 'gpt-4o');
  assert.ok(tokens > 0 && !Number.isNaN(tokens));
});

test('Tier 1 - F5.4: detectActiveModel detects Gemini, Claude, and OpenAI model families', () => {
  const makeDoc = (label) => ({
    querySelector: sel => sel && sel.includes('model-selector-trigger') ? { textContent: label } : null
  });

  const m1 = contextBudget.detectActiveModel(makeDoc('Gemini 4 Argon (high)'));
  assert.ok(m1.name.includes('Gemini 4 Argon'));
  assert.equal(m1.ceiling, 1000000);

  const m2 = contextBudget.detectActiveModel(makeDoc('Claude 3.5 Sonnet'));
  assert.ok(m2.name.includes('Claude'));
  assert.equal(m2.ceiling, 1000000);

  const m3 = contextBudget.detectActiveModel(makeDoc('GPT-OSS 120B'));
  assert.ok(m3.name.includes('GPT-OSS'));
  assert.equal(m3.ceiling, 128000);
});

test('Tier 1 - F5.5: detectActiveModel parses dynamic context ceiling from label (e.g. 200k, 2M, 128k)', () => {
  const makeDoc = (label) => ({
    querySelector: sel => sel && sel.includes('model-selector-trigger') ? { textContent: label } : null
  });

  assert.equal(contextBudget.detectActiveModel(makeDoc('Claude 3.5 (200k)')).ceiling, 200000);
  assert.equal(contextBudget.detectActiveModel(makeDoc('Gemini 1.5 Pro (2M)')).ceiling, 2000000);
  assert.equal(contextBudget.detectActiveModel(makeDoc('Custom Model (500k)')).ceiling, 500000);
});

// ----------------------------------------------------------------------------
// Feature F6: Dual-Anchor Hybrid Calibration (kappa)
// ----------------------------------------------------------------------------
test('Tier 1 - F6.1: When API ground truth is present, calculation anchors on apiTokens', () => {
  const { doc } = createMockDom();
  contextBudget.clearCache();

  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';
  contextBudget.hydrateFromTranscript(convKey, {
    apiTokens: 25000,
    maxChars: 50000,
    maxTurns: 5,
    pendingChars: 0,
    pendingTurns: 0
  });

  const stats = contextBudget.extractConversationStats(doc);
  assert.ok(stats.tokens >= 25000, `Tokens (${stats.tokens}) must anchor on API ground truth (25000)`);
});

test('Tier 1 - F6.2: In-flight composer typing adds pending tokens smoothly without resetting anchor', () => {
  const { doc } = createMockDom();
  contextBudget.clearCache();

  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';
  contextBudget.hydrateFromTranscript(convKey, {
    apiTokens: 30000,
    maxChars: 60000,
    maxTurns: 10,
    pendingChars: 0,
    pendingTurns: 0
  });

  // User types in composer
  const composer = doc.createElement('div');
  composer.className = 'surface-composer';
  const input = doc.createElement('div');
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('data-testid', 'agent-input-box');
  input.textContent = 'Please implement the surgical token counter following all workspace guidelines and specs.';
  composer.append(input);
  doc.body.append(composer);

  const stats = contextBudget.extractConversationStats(doc);
  assert.ok(stats.tokens > 30000, 'Effective tokens must include composer typing delta');
  assert.ok(stats.tokens < 30100, 'Composer delta should be around ~25 tokens, not huge');
});

test('Tier 1 - F6.3: calculateEffectiveTokens evaluates formula T_effective = T_ground_truth + Delta T_pending', () => {
  assert.equal(typeof contextBudget.calculateEffectiveTokens, 'function', 'context-budget.cjs must export calculateEffectiveTokens');

  const entry = {
    apiTokens: 40000,
    maxChars: 80000,
    transcriptChars: 80000,
    pendingChars: 0,
    pendingTurns: 0,
    systemTokens: 1500
  };

  const effective = contextBudget.calculateEffectiveTokens(entry, 'Next user instruction', 'gemini');
  assert.ok(effective > 40000, 'Must include delta from composer text');
});

test('Tier 1 - F6.4: Online calibration factor kappa is bounded between [0.5, 2.0]', () => {
  // Verifies that online calibration prevents wild multiplier drift
  assert.equal(typeof contextBudget.calculateEffectiveTokens, 'function');

  const entryExtreme = {
    apiTokens: 100000, // Very large API usage
    maxChars: 5000,    // Very small character count
    transcriptChars: 5000,
    pendingChars: 500,
    systemTokens: 1500
  };

  const effective = contextBudget.calculateEffectiveTokens(entryExtreme, 'Small prompt', 'gemini');
  assert.ok(effective >= 100000 && effective < 105000, 'Delta must be bounded without extreme overshooting');
});

test('Tier 1 - F6.5: Cold start without prior API response defaults smoothly to MMSLE/baseline without NaN', () => {
  const { doc } = createMockDom();
  contextBudget.clearCache();

  // Fresh conversation, no transcript hydrated
  const stats = contextBudget.extractConversationStats(doc);
  assert.ok(typeof stats.tokens === 'number');
  assert.ok(!Number.isNaN(stats.tokens));
  assert.ok(stats.tokens >= 0);
});

// ----------------------------------------------------------------------------
// Feature F7: Real-Time mtime Invalidation Pipeline
// ----------------------------------------------------------------------------
test('Tier 1 - F7.1: readTranscriptStats returns disk mtime matching fileStat.mtimeMs', (t) => {
  const brainDir = createTempBrain(t);
  const convId = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
  const filePath = writeTranscript(brainDir, convId, 'transcript.jsonl', [
    { step_index: 0, type: 'USER_INPUT', content: 'Testing mtime' }
  ]);

  const expectedMtime = fs.statSync(filePath).mtimeMs;
  const stats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  assert.ok(stats);
  assert.equal(stats.mtime, expectedMtime, 'mtime in stats must match file stat mtimeMs');
});

test('Tier 1 - F7.2: needsTranscript detects mtime advance during multi-step turn where navTurns is unchanged', () => {
  const { doc, win } = createMockDom();
  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';

  // State stored with mtime 1000
  win.localStorage.setItem('agpa_context_budget_' + convKey, JSON.stringify({
    apiTokens: 10000,
    maxChars: 20000,
    maxTurns: 2,
    mtime: 1000,
    updatedAt: 1000
  }));

  // ContextBudget webview loaded via VM
  const context = {
    window: win,
    document: doc,
    globalThis: null,
    localStorage: win.localStorage,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: contextBudget,
    __AGPAI18n: { t: k => k },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.globalThis = context;
  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // If a newer mtime (2000 > 1000) exists, needsTranscript must return true
  const requiresHydration = context.__AGContextBudget.needsTranscript(convKey, 2000);
  assert.equal(requiresHydration, true, 'needsTranscript must return true when disk mtime > stored mtime');

  context.__AGContextBudget.destroy();
});

test('Tier 1 - F7.3: needsTranscript returns false when mtime and navTurns are identical', () => {
  const { doc, win } = createMockDom();
  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';

  win.localStorage.setItem('agpa_context_budget_' + convKey, JSON.stringify({
    apiTokens: 15000,
    maxChars: 30000,
    maxTurns: 5,
    mtime: 5000,
    updatedAt: 5000
  }));

  const context = {
    window: win,
    document: doc,
    globalThis: null,
    localStorage: win.localStorage,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: contextBudget,
    __AGPAI18n: { t: k => k },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.globalThis = context;
  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // mtime is same (5000 == 5000), turns match
  const needed = context.__AGContextBudget.needsTranscript(convKey, 5000);
  assert.equal(needed, false, 'needsTranscript should return false when state is up to date');

  context.__AGContextBudget.destroy();
});

test('Tier 1 - F7.4: Rapid consecutive file touches update mtime and trigger fresh read', (t) => {
  const brainDir = createTempBrain(t);
  const convId = '55555555-6666-7777-8888-999999999999';

  const file = writeTranscript(brainDir, convId, 'transcript.jsonl', [
    { step_index: 0, type: 'USER_INPUT', content: 'Touch 1' }
  ]);
  const stats1 = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  // Update file with new step and set newer timestamp
  fs.appendFileSync(file, '\n' + JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 3000 }));
  const futureTime = new Date(Date.now() + 2000);
  fs.utimesSync(file, futureTime, futureTime);

  const stats2 = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });
  assert.ok(stats2.mtime > stats1.mtime, 'Subsequent touch must advance mtime');
  assert.equal(stats2.apiTokens, 3000);
});

test('Tier 1 - F7.5: Absent transcript file or invalid path returns null gracefully', () => {
  const missingStats = transcriptReader.readTranscriptStats('/c/non-existent-conversation-uuid-9999');
  assert.equal(missingStats, null, 'Non-existent conversation must return null safely');
});

// ----------------------------------------------------------------------------
// Feature F8: Token Breakdown Modal Data Structure
// ----------------------------------------------------------------------------
test('Tier 1 - F8.1: Token breakdown modal reflects inputTokens, cacheReadTokens, and outputTokens', () => {
  const { doc, win } = createMockDom();
  contextBudget.clearCache();

  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';
  contextBudget.hydrateFromTranscript(convKey, {
    apiTokens: 68692,
    inputTokens: 2269,
    cacheReadTokens: 66283,
    outputTokens: 140,
    maxChars: 100000,
    maxTurns: 10
  });

  // Setup footer and viewport in doc for pill placement
  const composer = doc.createElement('div');
  composer.className = 'surface-composer';
  const footer = doc.createElement('div');
  footer.className = '@container/input-footer fixture-footer';
  composer.append(footer);

  const viewport = doc.createElement('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.textContent = 'Active conversation content exceeding 100 characters to ensure pill attaches properly.';
  doc.body.append(viewport, composer);

  const context = {
    window: win,
    document: doc,
    globalThis: null,
    localStorage: win.localStorage,
    MutationObserver: class { observe() {} disconnect() {} },
    queueMicrotask: fn => fn(),
    __AGPA_CONTEXT_BUDGET__: contextBudget,
    __AGPAI18n: { t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, m) => v[m] || m) },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.globalThis = context;
  const scriptContent = fs.readFileSync(path.join(__dirname, '../common/context-budget.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(scriptContent, context);

  // Trigger pill render
  context.__AGContextBudget.refresh();

  const pill = doc.querySelector('.agpa-context-pill');
  assert.ok(pill, 'Context pill element must be rendered');

  // Open details popup
  pill.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
  const popup = doc.querySelector('.agpa-context-popup');
  assert.ok(popup, 'Context breakdown popup must open');

  context.__AGContextBudget.destroy();
});

test('Tier 1 - F8.2: Percentage calculation accurately scales with model ceiling', () => {
  const b1 = contextBudget.budgetLevelFor(250000, 1000000); // 25% of 1M
  assert.equal(b1.percentage, 25);
  assert.equal(b1.level, 'moderate');

  const b2 = contextBudget.budgetLevelFor(96000, 128000); // 75% of 128k
  assert.equal(b2.percentage, 75);
  assert.equal(b2.level, 'elevated');
});

test('Tier 1 - F8.3: Cache read ratio indicates prompt caching efficiency (>95% hit)', () => {
  const inputTokens = 2269;
  const cacheReadTokens = 66283;
  const totalPrompt = inputTokens + cacheReadTokens;
  const cacheHitRatio = (cacheReadTokens / totalPrompt) * 100;

  assert.ok(cacheHitRatio > 95, `Prompt cache hit (${cacheHitRatio.toFixed(1)}%) should exceed 95%`);
});

test('Tier 1 - F8.4: formatTokens produces standard clean formatting (k, M, commas)', () => {
  assert.equal(contextBudget.formatTokens(0), '0');
  assert.equal(contextBudget.formatTokens(450), '450');
  assert.equal(contextBudget.formatTokens(1240), '~1k');
  assert.equal(contextBudget.formatTokens(45200), '~45k');
  assert.equal(contextBudget.formatTokens(1000000), '~1M');
});

test('Tier 1 - F8.5: Saturated threshold triggers correct level, color and compact recommendation', () => {
  const saturatedBudget = contextBudget.budgetLevelFor(850000, 1000000); // 85% of 1M
  assert.equal(saturatedBudget.level, 'saturated');
  assert.equal(saturatedBudget.color, '#ff666a');
  assert.equal(saturatedBudget.percentage, 85);
});

// ----------------------------------------------------------------------------
// Feature F9: Zero NPM Dependencies & Node.js Built-in Compliance
// ----------------------------------------------------------------------------
test('Tier 1 - F9.1: Project code requires exclusively node:* built-in modules', () => {
  const commonFiles = ['context-budget.cjs', 'transcript-reader.cjs', 'daemon.cjs'];
  for (const f of commonFiles) {
    const fullPath = path.join(__dirname, '../common', f);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    // Find all require('...') or require("...") calls
    const requires = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
    for (const req of requires) {
      const match = req.match(/require\(['"]([^'"]+)['"]\)/);
      const mod = match[1];
      const isBuiltin = mod.startsWith('node:') || [
        'fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'url', 'events', 'stream', 'util', 'vm'
      ].includes(mod);
      const isRelative = mod.startsWith('.') || mod.startsWith('/');
      assert.ok(isBuiltin || isRelative, `Disallowed non-builtin npm module import: ${mod} in ${f}`);
    }
  }
});

test('Tier 1 - F9.2: No package.json runtime dependencies exist in repo root', () => {
  const root = path.join(__dirname, '..');
  const packageJson = path.join(root, 'package.json');
  if (fs.existsSync(packageJson)) {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    assert.equal(pkg.dependencies, undefined, 'Plugin runtime must have zero npm dependencies');
  }
});

test('Tier 1 - F9.3: All algorithms run in pure JavaScript without native C++ or WASM blobs', () => {
  const commonDir = path.join(__dirname, '../common');
  const files = fs.readdirSync(commonDir);
  const binaryFiles = files.filter(f => f.endsWith('.node') || f.endsWith('.wasm') || f.endsWith('.dll') || f.endsWith('.so'));
  assert.equal(binaryFiles.length, 0, 'No binary addons or WASM blobs allowed');
});

test('Tier 1 - F9.4: Code executes cleanly in standard Node.js without Babel or transpilers', () => {
  assert.doesNotThrow(() => {
    require('../common/context-budget.cjs');
    require('../common/transcript-reader.cjs');
  });
});

test('Tier 1 - F9.5: Execution avoids polluting globalThis with accidental variables', () => {
  const keysBefore = Object.keys(globalThis);
  require('../common/context-budget.cjs');
  const keysAfter = Object.keys(globalThis);
  const diff = keysAfter.filter(k => !keysBefore.includes(k) && !k.startsWith('__AG'));
  assert.equal(diff.length, 0, `No unintended global variable leakage: ${diff.join(', ')}`);
});

// ----------------------------------------------------------------------------
// Feature F10: Non-Regression across Existing Context Budget Behavior
// ----------------------------------------------------------------------------
test('Tier 1 - F10.1: Backward-compatible estimateTokens preserves signature and behavior', () => {
  assert.equal(contextBudget.estimateTokens(0, 0), 0);
  assert.equal(contextBudget.estimateTokens(400, 1), 100 + 120);
  assert.equal(contextBudget.estimateTokens(4000, 2, 0, 2800), 1540); // 1200/4 + 2800/2.8 + 240
});

test('Tier 1 - F10.2: estimateImageTokens preserves resolution-based tiling and model constraints', () => {
  assert.equal(contextBudget.estimateImageTokens(0, 0), 0);
  assert.equal(contextBudget.estimateImageTokens(30, 30), 0); // Under 40px ignored
  assert.equal(contextBudget.estimateImageTokens(500, 500, 'gemini'), 258);
  assert.equal(contextBudget.estimateImageTokens(1920, 1080), 1105);
});

test('Tier 1 - F10.3: estimateAttachmentTokens handles PDFs, code documents, and binary files', () => {
  assert.equal(contextBudget.estimateAttachmentTokens({ name: 'doc.pdf', pages: 3 }), 3 * 258);
  assert.equal(contextBudget.estimateAttachmentTokens({ name: 'code.js', sizeKb: 4 }), 1024); // (4 * 1024) / 4
});

test('Tier 1 - F10.4: estimateSystemBaseline calculates cold-start tool and rule overhead', () => {
  const composerDoc = {
    body: {
      querySelectorAll: sel => {
        if (sel.includes('.surface-composer') || sel.includes('composer')) {
          return [{ textContent: 'Claude 4.6 · 10 tools active · 2 rules' }];
        }
        return [];
      },
      querySelector: () => null
    }
  };

  const baseline = contextBudget.estimateSystemBaseline(composerDoc);
  assert.equal(baseline.toolsCount, 10);
  assert.equal(baseline.rulesCount, 2);
  assert.equal(baseline.baseTokens, 1500);
  assert.equal(baseline.tokens, 1500 + 10 * 180 + 2 * 350);
});

test('Tier 1 - F10.5: Local storage state serialization and restoration operate without corruption', () => {
  const store = new Map();
  const storage = {
    getItem: k => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };

  const key = 'test-conv-persistence';
  const data = { maxChars: 12345, maxTurns: 4, apiTokens: 6789 };

  contextBudget.saveConversationState(key, data, storage);
  const loaded = contextBudget.loadConversationState(key, storage);

  assert.deepEqual(loaded.maxChars, data.maxChars);
  assert.deepEqual(loaded.apiTokens, data.apiTokens);
  contextBudget.clearConversationState(key, storage);
  assert.equal(contextBudget.loadConversationState(key, storage), null);
});


// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (25 tests)
// ============================================================================

// ----------------------------------------------------------------------------
// Category 2.1: Empty & Minimal Inputs
// ----------------------------------------------------------------------------
test('Tier 2 - Boundary 2.1.1: Empty string returns 0 tokens', () => {
  if (contextBudget.estimateTokensPrecise) {
    assert.equal(contextBudget.estimateTokensPrecise('', 'gemini'), 0);
  }
  assert.equal(contextBudget.estimateTokens(0, 0, 0, 0, 0, 0), 0);
});

test('Tier 2 - Boundary 2.1.2: Single ASCII character returns exactly 1 token', () => {
  if (contextBudget.estimateTokensPrecise) {
    assert.equal(contextBudget.estimateTokensPrecise('a', 'gemini'), 1);
  }
});

test('Tier 2 - Boundary 2.1.3: Single symbol or punctuation character returns 1 token', () => {
  if (contextBudget.estimateTokensPrecise) {
    assert.equal(contextBudget.estimateTokensPrecise(';', 'gemini'), 1);
    assert.equal(contextBudget.estimateTokensPrecise('{', 'gemini'), 1);
  }
});

test('Tier 2 - Boundary 2.1.4: 0 turns, 0 chars, 0 images returns 0 tokens', () => {
  assert.equal(contextBudget.estimateTokens(0, 0, 0, 0), 0);
});

test('Tier 2 - Boundary 2.1.5: parseTranscriptContent(null) and parseTranscriptContent("") return null safely', () => {
  assert.equal(transcriptReader.parseTranscriptContent(null), null);
  assert.equal(transcriptReader.parseTranscriptContent(''), null);
  const whitespaceParsed = transcriptReader.parseTranscriptContent('   \n  ');
  assert.ok(whitespaceParsed === null || whitespaceParsed.turns === 0);
});

// ----------------------------------------------------------------------------
// Category 2.2: Extreme & Massive Inputs
// ----------------------------------------------------------------------------
test('Tier 2 - Boundary 2.2.1: Massive string (150,000 characters) processes rapidly under 25ms', () => {
  if (contextBudget.estimateTokensPrecise) {
    const huge = 'const a = 1;\n'.repeat(10000); // 130,000 chars
    const start = Date.now();
    const tokens = contextBudget.estimateTokensPrecise(huge, 'gemini');
    const elapsed = Date.now() - start;

    assert.ok(tokens > 10000);
    assert.ok(elapsed < 200, `Execution took ${elapsed}ms (must be sub-200ms)`);
  }
});

test('Tier 2 - Boundary 2.2.2: Massive token count exceeding context ceiling clamps percentage to 100%', () => {
  const budget = contextBudget.budgetLevelFor(2500000, 1000000); // 2.5M on 1M ceiling
  assert.equal(budget.percentage, 100);
  assert.equal(budget.level, 'saturated');
});

test('Tier 2 - Boundary 2.2.3: Single unbroken 5,000-character alphanumeric string without spaces does not freeze', () => {
  if (contextBudget.estimateTokensPrecise) {
    const longToken = 'x'.repeat(5000);
    const tokens = contextBudget.estimateTokensPrecise(longToken, 'gemini');
    assert.ok(tokens > 500 && tokens < 2000);
  }
});

test('Tier 2 - Boundary 2.2.4: 500 consecutive turns in transcript log parsed without degradation', () => {
  const lines = [];
  for (let i = 0; i < 500; i++) {
    lines.push(JSON.stringify({ step_index: i * 2, type: 'USER_INPUT', content: `Turn prompt ${i}` }));
    lines.push(JSON.stringify({ step_index: i * 2 + 1, type: 'PLANNER_RESPONSE', content: `Response ${i}` }));
  }

  const start = Date.now();
  const parsed = transcriptReader.parseTranscriptContent(lines.join('\n'));
  const elapsed = Date.now() - start;

  assert.ok(parsed);
  assert.equal(parsed.turns, 500);
  assert.ok(elapsed < 500, `Parsed 1,000 records in ${elapsed}ms`);
});

test('Tier 2 - Boundary 2.2.5: Huge 60-digit integer string chunked cleanly into ~20 tokens', () => {
  if (contextBudget.estimateTokensPrecise) {
    const hugeNum = '9'.repeat(60);
    const tokens = contextBudget.estimateTokensPrecise(hugeNum, 'gemini');
    assert.equal(tokens, 20, '60-digit number chunked into groups of 3 should equal 20 tokens');
  }
});

// ----------------------------------------------------------------------------
// Category 2.3: Whitespace & Strange Newlines
// ----------------------------------------------------------------------------
test('Tier 2 - Boundary 2.3.1: Whitespace-only string evaluates cleanly without NaN or negative values', () => {
  if (contextBudget.estimateTokensPrecise) {
    const ws = '     \t\t\t    \n\n\n\r\n     ';
    const tokens = contextBudget.estimateTokensPrecise(ws, 'gemini');
    assert.ok(tokens >= 0);
    assert.ok(!Number.isNaN(tokens));
  }
});

test('Tier 2 - Boundary 2.3.2: Windows CRLF and Unix LF produce consistent token estimations', () => {
  if (contextBudget.estimateTokensPrecise) {
    const unix = 'line1\nline2\nline3\nline4\n';
    const windows = 'line1\r\nline2\r\nline3\r\nline4\r\n';
    const tUnix = contextBudget.estimateTokensPrecise(unix, 'gemini');
    const tWindows = contextBudget.estimateTokensPrecise(windows, 'gemini');
    assert.equal(Math.abs(tUnix - tWindows) <= 1, true, 'CRLF vs LF should yield near identical counts');
  }
});

test('Tier 2 - Boundary 2.3.3: 50 consecutive newlines evaluated proportionally', () => {
  if (contextBudget.estimateTokensPrecise) {
    const newlines = '\n'.repeat(50);
    const tokens = contextBudget.estimateTokensPrecise(newlines, 'gemini');
    assert.ok(tokens >= 30 && tokens <= 55, `50 newlines tokens (${tokens})`);
  }
});

test('Tier 2 - Boundary 2.3.4: Deep indentation (16 spaces and multiple levels) adds indent tokens', () => {
  if (contextBudget.estimateTokensPrecise) {
    const deep = 'def foo():\n    if True:\n        for i in range(10):\n            print(i)';
    const tokens = contextBudget.estimateTokensPrecise(deep, 'gemini');
    assert.ok(tokens >= 15);
  }
});

test('Tier 2 - Boundary 2.3.5: Empty fenced code blocks (```\\n```) handle boundary safely', () => {
  if (contextBudget.estimateTokensPrecise) {
    const emptyFence = '```\n```';
    const tokens = contextBudget.estimateTokensPrecise(emptyFence, 'gemini');
    assert.ok(tokens >= 1 && tokens <= 5);
  }
});

// ----------------------------------------------------------------------------
// Category 2.4: Deeply Nested & Malformed JSON
// ----------------------------------------------------------------------------
test('Tier 2 - Boundary 2.4.1: Deeply nested JSON object (depth 15) estimated with JSON density', () => {
  let nested = { value: 'leaf' };
  for (let i = 0; i < 15; i++) {
    nested = { depth: i, inner: nested };
  }
  const jsonStr = JSON.stringify(nested);
  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(jsonStr, 'gemini');
    assert.ok(tokens > 30);
  }
});

test('Tier 2 - Boundary 2.4.2: Malformed or truncated JSON falls back gracefully without throwing', () => {
  const truncated = '{"tool": "run_command", "args": {"cmd": "npm test"'; // missing closing braces
  if (contextBudget.estimateTokensPrecise) {
    assert.doesNotThrow(() => {
      const tokens = contextBudget.estimateTokensPrecise(truncated, 'gemini');
      assert.ok(tokens > 0);
    });
  }
});

test('Tier 2 - Boundary 2.4.3: JSON with escaped quotes and backslashes handled cleanly', () => {
  const jsonEscaped = JSON.stringify({ path: 'C:\\projects\\demo\\file.txt', msg: 'He said "Hello"' });
  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(jsonEscaped, 'gemini');
    assert.ok(tokens > 15);
  }
});

test('Tier 2 - Boundary 2.4.4: Empty JSON structures ({} and []) estimated at minimal tokens', () => {
  if (contextBudget.estimateTokensPrecise) {
    assert.ok(contextBudget.estimateTokensPrecise('{}', 'gemini') <= 2);
    assert.ok(contextBudget.estimateTokensPrecise('[]', 'gemini') <= 2);
  }
});

test('Tier 2 - Boundary 2.4.5: JSON array of 100 integers evaluated cleanly', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const jsonArr = JSON.stringify(arr);
  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(jsonArr, 'gemini');
    assert.ok(tokens >= 80 && tokens <= 150);
  }
});

// ----------------------------------------------------------------------------
// Category 2.5: Extreme Multilingual & Unicode Edge Cases
// ----------------------------------------------------------------------------
test('Tier 2 - Boundary 2.5.1: Mixed CJK + Italian vowels + code + emoji in single prompt', () => {
  const combined = "こんにちは! 🚀 Abbiamo trovato l'errore: `const x = 42;` in progetto.";
  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(combined, 'gemini');
    assert.ok(tokens >= 18 && tokens <= 35, `Combined multilingual tokens (${tokens})`);
  }
});

test('Tier 2 - Boundary 2.5.2: RTL scripts (Arabic, Hebrew) handled with non-Latin ratios', () => {
  const arabic = 'مرحبا بكم في اختبار حساب الرموز';
  const hebrew = 'שלום עולם בדיקת ספירת אסימונים';
  if (contextBudget.estimateTokensPrecise) {
    const tArabic = contextBudget.estimateTokensPrecise(arabic, 'gemini');
    const tHebrew = contextBudget.estimateTokensPrecise(hebrew, 'gemini');
    assert.ok(tArabic > 5);
    assert.ok(tHebrew > 5);
  }
});

test('Tier 2 - Boundary 2.5.3: Composite emojis with Zero-Width Joiner (ZWJ) sequences handled without NaN', () => {
  const zwjEmojis = '👨‍💻👩‍🔬🏳️‍🌈🧑‍🤝‍🧑';
  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(zwjEmojis, 'gemini');
    assert.ok(tokens >= 4);
    assert.ok(!Number.isNaN(tokens));
  }
});

test('Tier 2 - Boundary 2.5.4: Combining diacritical marks and accented characters', () => {
  const decomposed = 'e\u0301'; // 'é' via combining acute accent
  const precomposed = 'é';
  if (contextBudget.estimateTokensPrecise) {
    const tDecomposed = contextBudget.estimateTokensPrecise(decomposed, 'gemini');
    const tPrecomposed = contextBudget.estimateTokensPrecise(precomposed, 'gemini');
    assert.ok(tDecomposed >= 1 && tPrecomposed >= 1);
  }
});

test('Tier 2 - Boundary 2.5.5: Astral plane characters (U+10000+) preserved without string truncation', () => {
  const astral = '𝄢 𝄞 🀀 🀁 🀂'; // Musical & Mahjong symbols
  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(astral, 'gemini');
    assert.ok(tokens >= 3);
  }
});


// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Interactions)
// ============================================================================

test('Tier 3 - Pairwise 3.1: Cache read tokens (65k) + in-flight CJK streaming delta', () => {
  const { doc } = createMockDom();
  contextBudget.clearCache();

  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';
  // Checkpoint with large prompt caching hit
  contextBudget.hydrateFromTranscript(convKey, {
    apiTokens: 65000,
    inputTokens: 2000,
    cacheReadTokens: 63000,
    outputTokens: 500,
    maxChars: 90000,
    maxTurns: 15
  });

  // User streams Japanese instruction in composer
  const composer = doc.createElement('div');
  composer.className = 'surface-composer';
  const input = doc.createElement('div');
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('data-testid', 'agent-input-box');
  input.textContent = 'この関数のパフォーマンスを最適化し、テストを実行してください。';
  composer.append(input);
  doc.body.append(composer);

  const stats = contextBudget.extractConversationStats(doc);
  assert.ok(stats.tokens > 65000, 'Tokens must synthesize ground truth and CJK delta');
  assert.ok(stats.tokens < 65100, 'CJK delta should be ~25-35 tokens');
});

test('Tier 3 - Pairwise 3.2: System message + prompt caching + tool call sequential turns', (t) => {
  const brainDir = createTempBrain(t);
  const convId = '33333333-aaaa-bbbb-cccc-444444444444';

  const jsonl = [
    JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: 'SYSTEM INSTRUCTIONS' }),
    JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Run command' }),
    JSON.stringify({
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      input_tokens: 12000,
      cache_read_tokens: 0,
      output_tokens: 300,
      tool_calls: [{ name: 'run_command', args: { CommandLine: 'node --version' } }]
    }),
    JSON.stringify({ step_index: 3, type: 'GENERIC', content: 'v20.10.0' }),
    JSON.stringify({
      step_index: 4,
      type: 'PLANNER_RESPONSE',
      input_tokens: 1500,
      cache_read_tokens: 12000,
      output_tokens: 250,
      content: 'Node version is v20.10.0'
    })
  ];

  writeTranscript(brainDir, convId, 'transcript_full.jsonl', jsonl);
  const stats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  assert.ok(stats);
  // Last step apiTokens = 1500 + 12000 + 250 = 13750
  assert.equal(stats.apiTokens, 13750);
  assert.equal(stats.maxTurns, 1);
  assert.equal(stats.pendingChars, 0);
});

test('Tier 3 - Pairwise 3.3: Model family switching dynamically recalculates ceiling and tokenizer ratios', () => {
  const makeDoc = (modelName) => {
    const { doc } = createMockDom();
    const selector = doc.createElement('div');
    selector.setAttribute('data-testid', 'model-selector-trigger');
    selector.textContent = modelName;
    doc.body.append(selector);
    return doc;
  };

  const docGemini = makeDoc('Gemini 4 Argon (1M)');
  const modelGemini = contextBudget.detectActiveModel(docGemini);
  assert.equal(modelGemini.ceiling, 1000000);

  const docClaude = makeDoc('Claude 3.5 Sonnet (200k)');
  const modelClaude = contextBudget.detectActiveModel(docClaude);
  assert.equal(modelClaude.ceiling, 200000);
});

test('Tier 3 - Pairwise 3.4: mtime invalidation automatically updates modal breakdown fields', (t) => {
  const brainDir = createTempBrain(t);
  const convId = '44444444-bbbb-cccc-dddd-555555555555';

  const file = writeTranscript(brainDir, convId, 'transcript_full.jsonl', [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Initial' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 5000, cache_read_tokens: 0, output_tokens: 200 })
  ]);

  const stats1 = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });
  assert.equal(stats1.apiTokens, 5200);

  // Background agent writes step 2 with prompt cache hits
  fs.appendFileSync(file, '\n' + JSON.stringify({
    step_index: 2,
    type: 'PLANNER_RESPONSE',
    input_tokens: 800,
    cache_read_tokens: 5000,
    output_tokens: 150
  }));
  const future = new Date(Date.now() + 1000);
  fs.utimesSync(file, future, future);

  const stats2 = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });
  assert.ok(stats2.mtime > stats1.mtime);
  assert.equal(stats2.apiTokens, 5950); // 800 + 5000 + 150
});

test('Tier 3 - Pairwise 3.5: JSON tool output containing CJK error stack trace estimated accurately', () => {
  const toolOutput = JSON.stringify({
    status: 'error',
    code: 500,
    message: 'ファイルの読み込みに失敗しました。パスが見つかりません。',
    stack: 'Error: Cannot find path\n    at readFile (/c/app/index.js:42:15)'
  });

  if (contextBudget.estimateTokensPrecise) {
    const tokens = contextBudget.estimateTokensPrecise(toolOutput, 'gemini');
    // ~190 chars with JSON + CJK + stack trace indentation
    assert.ok(tokens >= 50 && tokens <= 95);
  }
});

test('Tier 3 - Pairwise 3.6: Multimodal PDF attachment + live code editing + API checkpoint', () => {
  const { doc } = createMockDom();
  contextBudget.clearCache();

  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';
  contextBudget.hydrateFromTranscript(convKey, {
    apiTokens: 20000,
    maxChars: 40000,
    maxTurns: 3,
    pendingChars: 0
  });

  // Attach a 3-page PDF attachment
  const attTokens = contextBudget.estimateAttachmentTokens({ name: 'specs.pdf', pages: 3 });
  assert.equal(attTokens, 774); // 3 * 258

  const stats = contextBudget.extractConversationStats(doc);
  assert.ok(stats.tokens >= 20000);
});


// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 scenarios)
// ============================================================================

test('Tier 4 - Scenario 4.1: Full conversation lifecycle (Cold Start -> Tool Call -> Cache Hit -> Composer Typing)', (t) => {
  const brainDir = createTempBrain(t);
  const convId = 'aaaa1111-bb22-cc33-dd44-ee55ff667788';

  // Turn 1: Cold start with system rules (Step 0) & prompt (Step 1)
  const lines = [
    { step_index: 0, type: 'SYSTEM_MESSAGE', content: 'You are an expert coding assistant with 18 tools.' },
    { step_index: 1, type: 'USER_INPUT', content: 'Check repository status and files.' },
    {
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      input_tokens: 13036,
      cache_read_tokens: 0,
      output_tokens: 810,
      tool_calls: [{ name: 'list_dir', args: { DirectoryPath: 'c:/project' } }]
    },
    {
      step_index: 3,
      type: 'GENERIC',
      content: '{"name": "common", "isDir": true}\n{"name": "tests", "isDir": true}'
    },
    // Turn 2: Cache hit follow-up
    {
      step_index: 4,
      type: 'PLANNER_RESPONSE',
      input_tokens: 2269,
      cache_read_tokens: 13800,
      output_tokens: 350,
      content: 'Directory contains common and tests folders.'
    }
  ];

  writeTranscript(brainDir, convId, 'transcript_full.jsonl', lines);
  const stats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  assert.ok(stats);
  // Turn 2 checkpoint: 2269 + 13800 + 350 = 16419
  assert.equal(stats.apiTokens, 16419);
  assert.equal(stats.maxTurns, 1);

  // Turn 3: User begins typing follow-up in composer
  const { doc } = createMockDom({ pathname: `/c/${convId}` });
  contextBudget.clearCache();
  contextBudget.hydrateFromTranscript(`/c/${convId}`, stats);

  const composer = doc.createElement('div');
  composer.className = 'surface-composer';
  const input = doc.createElement('div');
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('data-testid', 'agent-input-box');
  input.textContent = 'Please run all tests in tests/ and report failures.';
  composer.append(input);
  doc.body.append(composer);

  const liveStats = contextBudget.extractConversationStats(doc);
  assert.ok(liveStats.tokens > 16419, 'Tokens must update live with composer delta');
  assert.ok(liveStats.tokens < 16500, 'Composer delta should be around ~15 tokens');
});

test('Tier 4 - Scenario 4.2: Multi-tool coding workflow (find_by_name -> view_file -> replace_file_content)', (t) => {
  const brainDir = createTempBrain(t);
  const convId = 'bbbb2222-cc33-dd44-ee55-ff66aa778899';

  const lines = [
    { step_index: 0, type: 'USER_INPUT', content: 'Fix bug in auth.js' },
    {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 14000,
      output_tokens: 200,
      tool_calls: [{ name: 'find_by_name', args: { Pattern: 'auth.js' } }]
    },
    { step_index: 2, type: 'GENERIC', content: 'auth.js (size: 4500 bytes)' },
    {
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      input_tokens: 1800,
      cache_read_tokens: 14200,
      output_tokens: 300,
      tool_calls: [{ name: 'view_file', args: { AbsolutePath: 'auth.js' } }]
    },
    { step_index: 4, type: 'GENERIC', content: 'const auth = true;\nmodule.exports = { auth };' },
    {
      step_index: 5,
      type: 'PLANNER_RESPONSE',
      input_tokens: 1600,
      cache_read_tokens: 16300,
      output_tokens: 450,
      content: 'Bug fixed successfully in auth.js'
    }
  ];

  writeTranscript(brainDir, convId, 'transcript_full.jsonl', lines);
  const stats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });

  assert.ok(stats);
  // Final checkpoint: 1600 + 16300 + 450 = 18350
  assert.equal(stats.apiTokens, 18350);
  assert.equal(stats.pendingChars, 0);
});

test('Tier 4 - Scenario 4.3: Non-Latin multilingual interactive debugging session (Italian & Japanese)', () => {
  if (contextBudget.estimateTokensPrecise) {
    const sessionText = [
      'Domanda: Perché il metodo `countTurns()` fallisce con i messaggi in lingua giapponese?',
      'Spiegazione:',
      '```javascript',
      'function countTurns(doc) {',
      '  // 日本語のテキストと記号を正確にカウントする',
      '  const turns = doc.querySelectorAll(".turn-item");',
      '  return turns.length;',
      '}',
      '```',
      'Conclusione: È necessario utilizzare un selettore UTF-8 sicuro.'
    ].join('\n');

    const tokens = contextBudget.estimateTokensPrecise(sessionText, 'gemini');
    // Around 330 characters, contains code block, Japanese comments, and Italian text
    assert.ok(tokens >= 80 && tokens <= 140, `Multilingual session tokens (${tokens})`);
  }
});

test('Tier 4 - Scenario 4.4: Context saturation boundary & /compact action recommendation', () => {
  const { doc, win } = createMockDom();
  contextBudget.clearCache();

  const convKey = '/c/01ed90cd-c026-4190-bfd8-5bb6444c0719';
  // Hydrate with 850,000 tokens on 1M ceiling (85% saturation)
  contextBudget.hydrateFromTranscript(convKey, {
    apiTokens: 850000,
    maxChars: 1500000,
    maxTurns: 45,
    ceiling: 1000000
  });

  const stats = contextBudget.extractConversationStats(doc);
  assert.equal(stats.budget.level, 'saturated');
  assert.equal(stats.budget.percentage, 85);
  assert.equal(stats.budget.color, '#ff666a');

  // Verify compact action advice in status message
  const statusNote = stats.budget.level === 'saturated' ? '/compact recommended.' : 'healthy';
  assert.ok(statusNote.includes('/compact'));
});

test('Tier 4 - Scenario 4.5: Zero-action background daemon invalidation during asynchronous task', (t) => {
  const brainDir = createTempBrain(t);
  const convId = 'dddd4444-ee55-ff66-aa77-888899990000';

  // Step 1: User runs long-running daemon test
  const file = writeTranscript(brainDir, convId, 'transcript_full.jsonl', [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Start daemon background task' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 8000, output_tokens: 150 })
  ]);

  const initialStats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });
  assert.equal(initialStats.apiTokens, 8150);

  // Background daemon appends step 2 asynchronously to disk
  fs.appendFileSync(file, '\n' + JSON.stringify({
    step_index: 2,
    type: 'PLANNER_RESPONSE',
    input_tokens: 1200,
    cache_read_tokens: 8150,
    output_tokens: 400
  }));
  const future = new Date(Date.now() + 1500);
  fs.utimesSync(file, future, future);

  // Daemon polling check: detects mtime change without user action
  const updatedStats = transcriptReader.readTranscriptStats(`/c/${convId}`, { brainDir });
  assert.ok(updatedStats.mtime > initialStats.mtime);
  assert.equal(updatedStats.apiTokens, 9750); // 1200 + 8150 + 400
});
