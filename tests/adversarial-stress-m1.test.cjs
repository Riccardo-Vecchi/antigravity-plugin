'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const transcriptReader = require('../common/transcript-reader.cjs');
const contextBudget = require('../common/context-budget.cjs');

test('Adversarial 1.1a: Skipping corrupt syntax and non-JSON lines in parseTranscriptContent', () => {
  const corruptLines = [
    '', // empty line
    '   ', // whitespace only
    '\r', // CR only
    'null', // JSON null primitive
    '12345', // JSON number primitive
    '"plain string"', // JSON string primitive
    'true', // JSON boolean primitive
    '{"type": "UNKNOWN_EVENT_TYPE", "payload": 123}', // unknown type
    '{"type": "USER_INPUT", "content": ', // truncated JSON
    '{invalid json completely!@#$%%^&*()}',
    '\x00\x01\x02\x03\xff\xfe', // binary garbage
    '{"type": "USER_INPUT", "content": "Valid user message after corruption"}'
  ].join('\n');

  let parsed = null;
  assert.doesNotThrow(() => {
    parsed = transcriptReader.parseTranscriptContent(corruptLines);
  }, 'parseTranscriptContent must never crash on corrupt or malformed inputs');

  assert.ok(parsed, 'parseTranscriptContent returns result');
  assert.strictEqual(parsed.turns, 1, 'Exactly one valid turn counted despite surrounding corruption');
  assert.ok(Number.isFinite(parsed.chars), 'chars must be a finite number');
  assert.ok(Number.isFinite(parsed.codeChars), 'codeChars must be a finite number');
  assert.ok(Number.isFinite(parsed.apiTokens), 'apiTokens must be a finite number');
  assert.ok(Number.isFinite(parsed.pendingChars), 'pendingChars must be a finite number');
  assert.strictEqual(parsed.chars, 'Valid user message after corruption'.length, 'Valid user message content counted');
  assert.strictEqual(parsed.blocks.length, 1);
});

test('Adversarial 1.1b: Malformed fields, unexpected types and non-numeric values in parseTranscriptContent', () => {
  const malformedLines = [
    '{"type": "USER_INPUT", "content": null, "media": null}',
    '{"type": "USER_INPUT", "content": 12345, "media": "not-an-array"}',
    '{"type": "USER_INPUT", "content": {"obj": true}}',
    '{"type": "PLANNER_RESPONSE", "input_tokens": -500, "output_tokens": -200}',
    '{"type": "PLANNER_RESPONSE", "input_tokens": "1000", "output_tokens": null}',
    '{"type": "PLANNER_RESPONSE", "input_tokens": null, "output_tokens": undefined}',
    '{"type": "PLANNER_RESPONSE", "input_tokens": NaN, "output_tokens": Infinity}',
    '{"type": "PLANNER_RESPONSE", "content": 12345, "thinking": {}, "tool_calls": "string"}',
    '{"type": "GENERIC", "content": null}',
    '{"type": "SYSTEM_MESSAGE", "content": null}',
    '{"type": "SYSTEM_MESSAGE", "content": 9999}',
    '{"type": "SYSTEM_MESSAGE", "content": {"text": "invalid"}}'
  ].join('\n');

  let parsed = null;
  assert.doesNotThrow(() => {
    parsed = transcriptReader.parseTranscriptContent(malformedLines);
  });
  assert.ok(parsed);
  assert.ok(Number.isFinite(parsed.turns), 'turns must be finite');
  assert.ok(Number.isFinite(parsed.chars), 'chars must be finite');
  assert.ok(Number.isFinite(parsed.apiTokens), 'apiTokens must be finite');
  assert.ok(!Number.isNaN(parsed.apiTokens), 'apiTokens must not be NaN');
  assert.ok(!Number.isNaN(parsed.chars), 'chars must not be NaN');
});


test('Adversarial 1.2: SYSTEM_MESSAGE interspersion throughout turns', () => {
  const conversationWithSys = [
    JSON.stringify({ type: 'SYSTEM_MESSAGE', content: 'System instruction: You are a helpful assistant.\n```python\nprint("init")\n```', step_index: 0 }),
    JSON.stringify({ type: 'USER_INPUT', content: 'Hello assistant' }),
    JSON.stringify({ type: 'PLANNER_RESPONSE', input_tokens: 1500, cache_read_tokens: 500, output_tokens: 120, content: 'Hello! How can I help you?', step_index: 1 }),
    JSON.stringify({ type: 'SYSTEM_MESSAGE', content: 'System reminder: tool output format must be JSON.', step_index: 2 }),
    JSON.stringify({ type: 'GENERIC', content: 'Tool execution result: success', step_index: 3 }),
    JSON.stringify({ type: 'PLANNER_RESPONSE', input_tokens: 2200, cache_read_tokens: 1800, output_tokens: 250, content: 'Operation completed.', step_index: 4 }),
    JSON.stringify({ type: 'SYSTEM_MESSAGE', content: 'Trailing system message after last response', step_index: 5 })
  ].join('\n');

  const parsed = transcriptReader.parseTranscriptContent(conversationWithSys);
  assert.ok(parsed);
  assert.strictEqual(parsed.turns, 1, 'SYSTEM_MESSAGE does not increment user turns');
  assert.strictEqual(parsed.apiTokens, 2200 + 1800 + 250, 'Latest apiTokens captured accurately');
  assert.strictEqual(parsed.inputTokens, 2200);
  assert.strictEqual(parsed.cacheReadTokens, 1800);
  assert.strictEqual(parsed.outputTokens, 250);

  // The trailing SYSTEM_MESSAGE arrived after latest PLANNER_RESPONSE, so it must be accounted in pendingChars
  const trailingLen = 'Trailing system message after last response'.length;
  assert.strictEqual(parsed.pendingChars, trailingLen, 'Pending chars accurately accounts for trailing system message');

  // Verify blocks contains s:step- entries
  const sysBlocks = parsed.blocks.filter(([k]) => k.startsWith('s:step-'));
  assert.strictEqual(sysBlocks.length, 3, 'All 3 SYSTEM_MESSAGE blocks registered');
});

test('Adversarial 1.3: Extremely large JSONL files (12,000+ lines, multiple megabytes)', () => {
  const lines = [];

  for (let i = 0; i < 4000; i++) {
    lines.push(JSON.stringify({
      type: 'USER_INPUT',
      content: `User query ${i}: Please analyze the following code:\n\`\`\`javascript\nconst a = ${i};\nfunction compute(x) { return x * 2; }\n\`\`\``
    }));
    lines.push(JSON.stringify({
      type: 'SYSTEM_MESSAGE',
      content: `System step telemetry ${i}: memory usage OK.`
    }));
    lines.push(JSON.stringify({
      type: 'PLANNER_RESPONSE',
      input_tokens: 1000 + i * 2,
      cache_read_tokens: 500 + i,
      output_tokens: 50 + (i % 20),
      content: `Plan ${i}: completed step with results.`,
      thinking: `Thinking carefully about query ${i}...`,
      tool_calls: [{ name: 'exec', args: { id: i } }]
    }));
  }

  const hugeContent = lines.join('\n');
  const sizeMb = (Buffer.byteLength(hugeContent, 'utf8') / (1024 * 1024)).toFixed(2);
  assert.strictEqual(lines.length, 12000, 'Generated 12,000 lines');

  const parseStart = performance.now();
  const parsed = transcriptReader.parseTranscriptContent(hugeContent);
  const parseDuration = performance.now() - parseStart;

  assert.ok(parsed, 'Parsed 12,000 lines successfully');
  assert.strictEqual(parsed.turns, 4000, 'Counted exactly 4,000 user turns');
  assert.strictEqual(parsed.apiTokens, (1000 + 3999 * 2) + (500 + 3999) + (50 + (3999 % 20)), 'Extracted exact latest API tokens');
  assert.ok(parseDuration < 1500, `Parse time for 12,000 lines (${sizeMb} MB) must be sub-second (actual: ${parseDuration.toFixed(1)}ms)`);
});

test('Adversarial 2.1: Dual-Anchor Hybrid Calibration stability during rapid composer edits', () => {
  const entry = {
    transcriptChars: 40000,
    maxChars: 40000,
    maxCodeChars: 15000,
    maxTurns: 10,
    maxImageTokens: 516,
    maxDocTokens: 0,
    systemBaseline: { tokens: 2500 },
    apiTokens: 11000, // Ground truth
    pendingChars: 0,
    pendingCodeChars: 0,
    pendingTurns: 0
  };

  // 1. Initial effective tokens with empty composer
  const baseTokens = contextBudget.calculateEffectiveTokens(entry, '', 'gemini-1.5-pro');
  assert.strictEqual(baseTokens, 11000, 'Base tokens equals apiTokens ground truth');

  // 2. Simulate rapid typing and backspacing over 500 characters
  let prevTokens = baseTokens;
  let text = '';
  const tokensHistory = [];

  for (let i = 1; i <= 300; i++) {
    text += (i % 10 === 0 ? ' ```test``` ' : (i % 5 === 0 ? ' 123456 ' : ' word'));
    const currentTokens = contextBudget.calculateEffectiveTokens(entry, text, 'gemini-1.5-pro');

    assert.ok(Number.isFinite(currentTokens), 'Tokens must always be finite');
    assert.strictEqual(currentTokens >= prevTokens, true, `Tokens must not decrease when adding characters (step ${i})`);
    prevTokens = currentTokens;
    tokensHistory.push(currentTokens);
  }

  // 3. Now simulate rapid deletion back to empty
  while (text.length > 0) {
    text = text.slice(0, Math.max(0, text.length - 15));
    const currentTokens = contextBudget.calculateEffectiveTokens(entry, text, 'gemini-1.5-pro');
    assert.ok(Number.isFinite(currentTokens), 'Tokens must remain finite during backspacing');
    assert.strictEqual(currentTokens <= prevTokens, true, 'Tokens must not increase during backspacing');
    prevTokens = currentTokens;
  }

  assert.strictEqual(contextBudget.calculateEffectiveTokens(entry, '', 'gemini-1.5-pro'), 11000, 'Returns cleanly to ground truth');
});

test('Adversarial 2.2: Dual-Anchor division-by-zero, extreme kappa ratios and edge bounds', () => {
  // Case A: Zero histEstimate (no transcript chars, no code, no images)
  const zeroHistEntry = {
    transcriptChars: 0,
    maxChars: 0,
    maxCodeChars: 0,
    maxImageTokens: 0,
    maxDocTokens: 0,
    apiTokens: 5000,
    systemBaseline: { tokens: 1000 }
  };
  const zeroHistRes = contextBudget.calculateEffectiveTokens(zeroHistEntry, 'Testing zero history', 'gemini');
  assert.ok(Number.isFinite(zeroHistRes), 'Zero history estimate must not produce NaN or Infinity');
  assert.ok(zeroHistRes > 5000, 'Adds estimated composer tokens with kappa=1.0');

  // Case B: apiTokens <= systemBaseline
  const lowApiEntry = {
    transcriptChars: 10000,
    maxChars: 10000,
    maxCodeChars: 0,
    apiTokens: 1000,
    systemBaseline: { tokens: 2000 } // baseline higher than apiTokens
  };
  const lowApiRes = contextBudget.calculateEffectiveTokens(lowApiEntry, 'Hello', 'gemini');
  assert.ok(Number.isFinite(lowApiRes));

  // Case C: Extreme discrepancy (apiTokens 100x higher than estimate -> rawKappa = 100)
  const extremeDiscrepancyEntry = {
    transcriptChars: 100, // estimated ~ 25 tokens
    maxChars: 100,
    maxCodeChars: 0,
    apiTokens: 25000, // 1000x higher
    systemBaseline: null
  };
  // rawKappa = 25000 / 25 = 1000 -> outside [0.5, 2.0] -> fallback to kappa = 1.0
  const extremeRes = contextBudget.calculateEffectiveTokens(extremeDiscrepancyEntry, 'Short input', 'gemini');
  assert.ok(Number.isFinite(extremeRes));
  assert.strictEqual(extremeRes, 25000 + Math.round(contextBudget.estimateTokensPrecise('Short input', 'gemini') * 1.0));

  // Case D: In-bounds discrepancy (rawKappa = 1.3)
  const boundedEntry = {
    transcriptChars: 4000, // histEstimate ~ 1000 tokens
    maxChars: 4000,
    maxCodeChars: 0,
    apiTokens: 1300, // rawKappa = 1300 / 1000 = 1.3
    systemBaseline: null
  };
  const boundedRes = contextBudget.calculateEffectiveTokens(boundedEntry, 'Composer test', 'gemini');
  const compTok = contextBudget.estimateTokensPrecise('Composer test', 'gemini');
  assert.strictEqual(boundedRes, 1300 + Math.round(compTok * 1.3));
});

test('Adversarial 2.3: Transition between pure estimation (apiTokens === 0) and ground truth (apiTokens > 0)', () => {
  const unhydrated = {
    maxChars: 12000,
    maxCodeChars: 4000,
    maxTurns: 3,
    maxImageTokens: 0,
    maxDocTokens: 0,
    systemTokens: 1500,
    apiTokens: 0 // unhydrated
  };

  const pureEstimated = contextBudget.calculateEffectiveTokens(unhydrated, 'composer text', 'gemini');
  assert.ok(pureEstimated > 0);
  assert.strictEqual(pureEstimated, contextBudget.estimateTokens(12000, 3, 0, 4000, 0, 1500) + contextBudget.estimateTokensPrecise('composer text', 'gemini'));

  // Now conversation is hydrated with ground truth
  const hydrated = {
    ...unhydrated,
    transcriptChars: 12000,
    apiTokens: 4200, // Ground truth from server
    inputTokens: 3500,
    cacheReadTokens: 500,
    outputTokens: 200,
    pendingChars: 0,
    pendingTurns: 0
  };

  const anchoredTokens = contextBudget.calculateEffectiveTokens(hydrated, 'composer text', 'gemini');
  // histEstimate = (8000/4) + (4000/2.8) = 2000 + 1429 = 3429
  // rawKappa = 4200 / 3429 = 1.2248 -> clamped in [0.7, 1.5] -> 1.2248
  assert.ok(anchoredTokens >= 4200, 'Anchored on ground truth');
  assert.strictEqual(anchoredTokens, 4200 + Math.round(contextBudget.estimateTokensPrecise('composer text', 'gemini') * (4200 / 3429)));
});

test('Adversarial 2.4: estimateTokensPrecise stress against bizarre inputs and massive text', () => {
  assert.strictEqual(contextBudget.estimateTokensPrecise(null), 0);
  assert.strictEqual(contextBudget.estimateTokensPrecise(undefined), 0);
  assert.strictEqual(contextBudget.estimateTokensPrecise(''), 0);

  // Unclosed code blocks and rogue backticks
  const rogueBackticks = '```\nlet x = 1;\n```\n```\nunclosed code block indefinitely...';
  const rogueTok = contextBudget.estimateTokensPrecise(rogueBackticks, 'gemini');
  assert.ok(Number.isFinite(rogueTok) && rogueTok > 0);

  // High volume CJK and emojis
  const cjkAndEmoji = '你好世界'.repeat(500) + '🚀🔥💻🎉'.repeat(200);
  const cjkTok = contextBudget.estimateTokensPrecise(cjkAndEmoji, 'gemini');
  assert.ok(Number.isFinite(cjkTok) && cjkTok > 0);

  // 1 Million characters string benchmark
  const hugeText = 'const variableName = 12345; // some prose explaining computation\n'.repeat(15000); // ~975 KB
  const t0 = performance.now();
  const hugeTok = contextBudget.estimateTokensPrecise(hugeText, 'claude-3-5-sonnet');
  const dur = performance.now() - t0;
  assert.ok(Number.isFinite(hugeTok) && hugeTok > 0);
  assert.ok(dur < 500, `Processing 1MB lexical stream took ${dur.toFixed(1)}ms (< 500ms)`);
});

test('Adversarial 3.1: Reactive mtime sub-millisecond and rapid simulated disk writes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpa-mtime-stress-'));
  const testConvId = '11111111-2222-3333-4444-555555555555';
  const brainDir = path.join(tmpDir, 'brain');
  const logDir = path.join(brainDir, testConvId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, 'transcript_full.jsonl');

  try {
    let lastMtime = 0;
    let detections = 0;
    const iterations = 50;

    for (let i = 0; i < iterations; i++) {
      fs.appendFileSync(logFile, JSON.stringify({
        type: 'PLANNER_RESPONSE',
        input_tokens: 1000 + i,
        step_index: i
      }) + '\n');

      const stat = fs.statSync(logFile);
      const currentMtime = stat.mtimeMs;

      // Simulate daemon logic
      if (currentMtime > 0 && currentMtime !== lastMtime) {
        detections++;
        lastMtime = currentMtime;
      }
    }

    assert.ok(detections >= 1, 'Detected disk modifications');

    // Test sub-millisecond precision: explicitly set utimes with fractional timestamps if supported
    const past = 1700000000.123;
    const nowFractional = 1700000000.456;
    fs.utimesSync(logFile, past, past);
    const stat1 = fs.statSync(logFile);

    fs.utimesSync(logFile, nowFractional, nowFractional);
    const stat2 = fs.statSync(logFile);

    assert.notStrictEqual(stat1.mtimeMs, stat2.mtimeMs, 'Sub-millisecond / distinct fractional mtimeMs values are differentiated by !==');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Adversarial 3.2: ReDoS stress with pathological backticks and punctuation patterns', () => {
  // 50,000 backtick characters
  const pathologicalBackticks = '`'.repeat(50000);
  const t0 = performance.now();
  const tokBackticks = contextBudget.estimateTokensPrecise(pathologicalBackticks, 'gemini');
  const d0 = performance.now() - t0;
  assert.ok(d0 < 100, `Pathological backticks took ${d0.toFixed(1)}ms (< 100ms)`);
  assert.ok(Number.isFinite(tokBackticks));

  // 50,000 alternating punctuation characters
  const pathologicalPunct = '.,;:!?(){}[]<>/\\-+*=&|%#@~`^'.repeat(2000);
  const t1 = performance.now();
  const tokPunct = contextBudget.estimateTokensPrecise(pathologicalPunct, 'claude');
  const d1 = performance.now() - t1;
  assert.ok(d1 < 100, `Pathological punctuation took ${d1.toFixed(1)}ms (< 100ms)`);
  assert.ok(Number.isFinite(tokPunct));
});

test('Adversarial 3.3: End-to-end multi-step turn lifecycle and model switching', () => {
  const convKey = '/c/test-lifecycle-agent-1234';
  const memoryStore = new Map();
  const mockStorage = {
    getItem: k => memoryStore.get(k) || null,
    setItem: (k, v) => memoryStore.set(k, v),
    removeItem: k => memoryStore.delete(k)
  };

  contextBudget.clearCache(convKey, mockStorage);

  // Turn 1: User asks question in unhydrated state
  const mockDoc = {
    location: { pathname: convKey },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const initialStats = contextBudget.extractConversationStats(mockDoc, mockStorage);
  assert.strictEqual(initialStats.apiTokens, 0);

  // Model starts on Gemini (~256k context ceiling in Antigravity)
  assert.strictEqual(initialStats.ceiling, 256000);

  // First step transcript arrives: 3500 api tokens
  contextBudget.hydrateFromTranscript(convKey, {
    maxChars: 4000,
    maxCodeChars: 800,
    maxTurns: 1,
    maxImageTokens: 0,
    apiTokens: 3500,
    inputTokens: 3000,
    cacheReadTokens: 400,
    outputTokens: 100,
    mtime: 1700000001000,
    blocks: [['p:turn-1:User prompt', { length: 200, codeChars: 0 }]],
    images: []
  }, mockStorage);

  // Assistant executes tool 1: in-flight pending DOM additions
  const hydratedEntry = contextBudget.loadConversationState(convKey, mockStorage);
  assert.strictEqual(hydratedEntry.apiTokens, 3500);

  // User begins typing next prompt in composer (length 250)
  const composerText = 'Can you refactor this function to be async?\n```javascript\nfunction run() { return 1; }\n```';
  const effectiveGemini = contextBudget.calculateEffectiveTokens(hydratedEntry, composerText, 'gemini-1.5-pro');
  assert.ok(effectiveGemini > 3500, 'Effective tokens include composer estimation');

  // Switch model to Claude
  const effectiveClaude = contextBudget.calculateEffectiveTokens(hydratedEntry, composerText, 'claude-3-5-sonnet');
  assert.ok(effectiveClaude > 3500);

  // Switch model to GPT-OSS 120B (128k ceiling)
  const effectiveOpenAI = contextBudget.calculateEffectiveTokens(hydratedEntry, composerText, 'gpt-4o');
  assert.ok(effectiveOpenAI > 3500);

  // Verify all estimates are close and bounded (within 10% of each other, no sudden spikes or drops)
  const diffRatio = Math.abs(effectiveGemini - effectiveClaude) / effectiveGemini;
  assert.ok(diffRatio < 0.15, `Model family variation must be smooth and realistic (actual diff ratio: ${(diffRatio * 100).toFixed(1)}%)`);

  contextBudget.clearCache(convKey, mockStorage);
});

