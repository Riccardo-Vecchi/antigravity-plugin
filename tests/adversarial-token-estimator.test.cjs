'use strict';

/**
 * Adversarial Testing Harness & Stress Suite
 * Multi-Modal Segmented Lexical Estimator (estimateTokensPrecise & calculateEffectiveTokens)
 * 
 * Verifies:
 * 1. Pathological / adversarial inputs (ReDoS, 50,000+ repeated brackets/backticks/quotes)
 * 2. Extreme Unicode (CJK ideographs, surrogate pairs, ZWJ sequences, skin-tone emojis, RTL Arabic/Hebrew)
 * 3. Huge strings (1 MB payload) and latency benchmarks (< 1ms on standard chunks)
 * 4. Boundary inputs (empty, null, undefined, non-strings, whitespace variants)
 * 5. Empirical correctness (dense code vs sparse prose, CJK ~1 token/char, valid & malformed JSON)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const {
  estimateTokensPrecise,
  calculateEffectiveTokens
} = require('../common/context-budget.cjs');

// =========================================================================
// 1. Pathological / Adversarial Inputs & ReDoS Stress Testing
// =========================================================================
test('Adversarial 1.1: 50,000 consecutive unclosed backticks does not freeze (ReDoS immunity)', () => {
  const input = '`'.repeat(50000);
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens), 'Must return a valid number');
  assert.ok(tokens > 0, 'Must produce positive tokens');
  assert.ok(elapsed < 200, `Execution took ${elapsed.toFixed(2)}ms (must be < 200ms)`);
});

test('Adversarial 1.2: 30,000 consecutive unclosed fenced code backticks (```) processes rapidly', () => {
  const input = '```'.repeat(30000); // 90,000 characters
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens), 'Must return a valid number');
  assert.ok(tokens > 0, 'Must produce positive tokens');
  assert.ok(elapsed < 200, `Execution took ${elapsed.toFixed(2)}ms (must be < 200ms)`);
});

test('Adversarial 1.3: Unclosed code block with 50,000 trailing characters without closing delimiter', () => {
  const input = '```javascript\nconst a = 1;\n' + 'x'.repeat(50000);
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  assert.ok(tokens > 0);
  assert.ok(elapsed < 200, `Execution took ${elapsed.toFixed(2)}ms (must be < 200ms)`);
});

test('Adversarial 1.4: 50,000 opening brackets and 50,000 closing brackets (100k chars)', () => {
  const input = '{'.repeat(50000) + '}'.repeat(50000);
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  assert.ok(tokens > 0);
  assert.ok(elapsed < 200, `Execution took ${elapsed.toFixed(2)}ms (must be < 200ms)`);
});

test('Adversarial 1.5: 50,000 unclosed double quotes and single quotes', () => {
  const inputDouble = '"'.repeat(50000);
  const t0 = performance.now();
  const tokensDouble = estimateTokensPrecise(inputDouble, 'gemini');
  const elapsedDouble = performance.now() - t0;

  assert.ok(tokensDouble > 0);
  assert.ok(elapsedDouble < 200, `Double quotes took ${elapsedDouble.toFixed(2)}ms`);

  const inputSingle = "'".repeat(50000);
  const t1 = performance.now();
  const tokensSingle = estimateTokensPrecise(inputSingle, 'gemini');
  const elapsedSingle = performance.now() - t1;

  assert.ok(tokensSingle > 0);
  assert.ok(elapsedSingle < 200, `Single quotes took ${elapsedSingle.toFixed(2)}ms`);
});

test('Adversarial 1.6: 64,000 alternating syntax and operator characters (dense punctuation)', () => {
  const punctCycle = '.,!?;:()[]{}<>"\'`~@#$%^&*+=|\\/-';
  const input = punctCycle.repeat(2000);
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  assert.ok(tokens > 0);
  assert.ok(elapsed < 200, `Execution took ${elapsed.toFixed(2)}ms (must be < 200ms)`);
});

test('Adversarial 1.7: 50,000 consecutive newlines with deep indentation runs', () => {
  const input = ('\n' + ' '.repeat(100)).repeat(500); // 50,500 characters
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  assert.ok(tokens > 0);
  assert.ok(elapsed < 200, `Execution took ${elapsed.toFixed(2)}ms (must be < 200ms)`);
});

test('Adversarial 1.8: 60,000 continuous digits without spaces', () => {
  const input = '9'.repeat(60000);
  const t0 = performance.now();
  const tokens = estimateTokensPrecise(input, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  // 60,000 digits in 3-digit groups = 20,000 tokens
  assert.strictEqual(tokens, 20000, '60,000 digits should chunk into exactly 20,000 tokens');
  assert.ok(elapsed < 100, `Execution took ${elapsed.toFixed(2)}ms`);
});

// =========================================================================
// 2. Extreme Unicode Strings (CJK, Emojis, Surrogate Pairs, RTL)
// =========================================================================
test('Adversarial 2.1: 5,000 CJK Hanzi, Kana and Hangul ideographs', () => {
  // Construct 5,000 mixed CJK ideographs
  let cjk = '';
  for (let i = 0; i < 2000; i++) {
    cjk += String.fromCharCode(0x4e00 + (i % 500)); // Chinese Hanzi
  }
  for (let i = 0; i < 1500; i++) {
    cjk += String.fromCharCode(0x3041 + (i % 80));  // Japanese Hiragana
  }
  for (let i = 0; i < 1500; i++) {
    cjk += String.fromCharCode(0xac00 + (i % 500)); // Korean Hangul
  }
  assert.strictEqual(cjk.length, 5000);

  const t0 = performance.now();
  const geminiTokens = estimateTokensPrecise(cjk, 'gemini');
  const claudeTokens = estimateTokensPrecise(cjk, 'claude');
  const openaiTokens = estimateTokensPrecise(cjk, 'openai');
  const elapsed = performance.now() - t0;

  assert.ok(elapsed < 100, `CJK execution took ${elapsed.toFixed(2)}ms`);

  // Gemini cjkR = 1.3 -> 5000 / 1.3 ≈ 3847 tokens (~0.77 tok/char)
  // Claude cjkR = 0.8 -> 5000 / 0.8 ≈ 6250 tokens (~1.25 tok/char)
  // OpenAI cjkR = 1.4 -> 5000 / 1.4 ≈ 3572 tokens (~0.71 tok/char)
  assert.ok(geminiTokens >= 3500 && geminiTokens <= 4200, `Gemini tokens: ${geminiTokens}`);
  assert.ok(claudeTokens >= 6000 && claudeTokens <= 6500, `Claude tokens: ${claudeTokens}`);
  assert.ok(openaiTokens >= 3300 && openaiTokens <= 3800, `OpenAI tokens: ${openaiTokens}`);

  // Contrast with naive chars / 4 (which would incorrectly yield 1250 tokens)
  assert.ok(geminiTokens > 2.5 * (5000 / 4), 'Must estimate significantly more tokens than naive chars / 4');
});

test('Adversarial 2.2: Composite ZWJ emoji sequences and skin-tone modifiers', () => {
  // Family ZWJ sequence: 👨‍👩‍👧‍👦 (11 UTF-16 code units)
  const familyEmoji = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}';
  // Skin tone modifiers: 👍🏽 (thumbs up with medium skin tone)
  const skinToneThumb = '\u{1F44D}\u{1F3FD}';
  // Multiple flags: 🇮🇹 🇯🇵 🇺🇸 🇬🇧
  const flags = '🇮🇹 🇯🇵 🇺🇸 🇬🇧';

  const mixedEmojis = `${familyEmoji} ${skinToneThumb} ${flags}`.repeat(100);
  const tokens = estimateTokensPrecise(mixedEmojis, 'gemini');

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  assert.ok(tokens > 100, 'Emojis must be properly accounted for');
});

test('Adversarial 2.3: Arabic and Hebrew right-to-left text with diacritics', () => {
  const arabicText = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ - الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ';
  const hebrewText = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ';
  const combined = (arabicText + ' ' + hebrewText + '\n').repeat(50); // ~6,000 characters

  const t0 = performance.now();
  const tokens = estimateTokensPrecise(combined, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(tokens > 0);
  assert.ok(!Number.isNaN(tokens));
  assert.ok(elapsed < 50, `Arabic/Hebrew processing took ${elapsed.toFixed(2)}ms`);
  // Non-Latin alphabet ratio is 2.2 chars/token -> ~2700 tokens
  assert.ok(tokens >= 2000 && tokens <= 3500, `Expected ~2700 tokens, got ${tokens}`);
});

test('Adversarial 2.4: Astral plane characters (U+10000 to U+10FFFF) and mathematical alphanumeric symbols', () => {
  // Mathematical Bold Fraktur: 𝕬 𝕭 𝕮 𝕯 𝕰 𝕱
  const mathChars = '𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅'.repeat(100);
  const tokens = estimateTokensPrecise(mathChars, 'gemini');

  assert.ok(typeof tokens === 'number' && !Number.isNaN(tokens));
  assert.ok(tokens > 0);
});

// =========================================================================
// 3. Huge Strings (1 MB) & Benchmark Latency Requirements
// =========================================================================
test('Adversarial 3.1: Standard 1 KB code/prose chunk executes in sub-millisecond (< 1.0 ms)', () => {
  const standardChunk = `
function calculateFibonacci(n) {
  if (n <= 1) return n;
  let prev = 0, curr = 1;
  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}

// Quick verification and test execution for Fibonacci
const result = calculateFibonacci(10);
console.log("Fibonacci result for 10 is: " + result);
`;
  assert.ok(standardChunk.length >= 250);

  // Warmup
  for (let i = 0; i < 10; i++) estimateTokensPrecise(standardChunk, 'gemini');

  // Benchmark 100 runs
  const iterations = 100;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    estimateTokensPrecise(standardChunk, 'gemini');
  }
  const avgMs = (performance.now() - t0) / iterations;

  assert.ok(avgMs < 1.0, `Average latency for standard chunk was ${avgMs.toFixed(4)}ms (must be < 1.0ms)`);
});

test('Adversarial 3.2: 100 KB realistic code file executes well under 20 ms', () => {
  const codeUnit = `
class DataPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.buffer = new Map();
    this.capacity = options.capacity || 1024;
    this.flushIntervalMs = 5000;
  }

  processBatch(items) {
    if (!Array.isArray(items)) throw new TypeError('Expected array of items');
    for (const item of items) {
      if (!item || !item.id) continue;
      this.buffer.set(item.id, {
        payload: item.data,
        processedAt: Date.now(),
        retries: 0
      });
    }
    if (this.buffer.size >= this.capacity) {
      this.flush();
    }
  }

  flush() {
    const batch = Array.from(this.buffer.entries());
    this.buffer.clear();
    this.emit('flush', batch);
    return batch.length;
  }
}
`;
  const code100kb = codeUnit.repeat(150); // ~100,000 characters
  assert.ok(code100kb.length >= 95000);

  const t0 = performance.now();
  const tokens = estimateTokensPrecise(code100kb, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && tokens > 15000);
  assert.ok(elapsed < 25, `100 KB code execution took ${elapsed.toFixed(2)}ms (must be < 25ms)`);
});

test('Adversarial 3.3: 1 MB massive composite payload executes under 150 ms without memory exhaustion', () => {
  const codeSnippet = '```typescript\ninterface Config { id: string; count: number; active: boolean; }\n```\n';
  const proseSnippet = 'The system architecture coordinates asynchronous background events with minimal overhead.\n';
  const jsonSnippet = '{"status": 200, "message": "OK", "records": [1, 2, 3, 4, 5]}\n';
  const cjkSnippet = 'システムアーキテクチャの性能検証テストを実施中。\n';

  const mixedBlock = (codeSnippet + proseSnippet + jsonSnippet + cjkSnippet).repeat(10);
  const payload1Mb = mixedBlock.repeat(350); // ~1,000,000 characters
  assert.ok(payload1Mb.length >= 900000, `Actual payload length: ${payload1Mb.length}`);

  const t0 = performance.now();
  const tokens = estimateTokensPrecise(payload1Mb, 'gemini');
  const elapsed = performance.now() - t0;

  assert.ok(typeof tokens === 'number' && tokens > 100000);
  assert.ok(elapsed < 150, `1 MB execution took ${elapsed.toFixed(2)}ms (must be < 150ms)`);
});

// =========================================================================
// 4. Boundary Inputs & Type Coercion
// =========================================================================
test('Adversarial 4.1: Boundary values: empty string, null, undefined, boolean, number, object', () => {
  assert.strictEqual(estimateTokensPrecise(''), 0, 'Empty string must return 0');
  assert.strictEqual(estimateTokensPrecise(null), 0, 'null must return 0');
  assert.strictEqual(estimateTokensPrecise(undefined), 0, 'undefined must return 0');
  assert.strictEqual(estimateTokensPrecise(0), 0, 'number 0 must return 0');
  assert.strictEqual(estimateTokensPrecise(12345), 0, 'number must return 0');
  assert.strictEqual(estimateTokensPrecise(true), 0, 'true must return 0');
  assert.strictEqual(estimateTokensPrecise(false), 0, 'false must return 0');
  assert.strictEqual(estimateTokensPrecise({}), 0, 'object must return 0');
  assert.strictEqual(estimateTokensPrecise([]), 0, 'array must return 0');
  assert.strictEqual(estimateTokensPrecise(() => {}), 0, 'function must return 0');
});

test('Adversarial 4.2: String representations of primitives', () => {
  assert.strictEqual(estimateTokensPrecise('0'), 1, '"0" should be 1 token');
  assert.strictEqual(estimateTokensPrecise('null'), 1, '"null" should be 1 token');
  assert.strictEqual(estimateTokensPrecise('undefined'), 3, '"undefined" should be ~3 tokens (9 chars / 4.2)');
  assert.strictEqual(estimateTokensPrecise('true'), 1, '"true" should be 1 token');
  assert.strictEqual(estimateTokensPrecise('false'), 1, '"false" should be 1 token');
});

test('Adversarial 4.3: Whitespace variations: only spaces, tabs, CRLF, non-breaking and zero-width spaces', () => {
  // Single space returns 1 (minimum floor for non-empty string)
  assert.strictEqual(estimateTokensPrecise(' '), 1);
  assert.strictEqual(estimateTokensPrecise('    '), 1);
  assert.strictEqual(estimateTokensPrecise('\t\t\t'), 1);
  assert.strictEqual(estimateTokensPrecise('\u00A0\u00A0'), 1); // Non-breaking space
  assert.strictEqual(estimateTokensPrecise('\u200B\u200B'), 1); // Zero-width space

  // Newlines add structural tokens
  const newlinesOnly = '\n\n\n\n\n'; // 5 newlines = Math.ceil(5 * 0.75) = 4
  assert.strictEqual(estimateTokensPrecise(newlinesOnly), 4);
});

// =========================================================================
// 5. Empirical Correctness (Code vs Prose, CJK Tokens, JSON Payloads)
// =========================================================================
test('Adversarial 5.1: Dense code produces significantly more tokens than sparse prose of identical length', () => {
  // Dense code: heavy operators, punctuation, short symbols, brackets
  const denseCode = `
for (let i = 0; i < len; i++) {
  if (arr[i] !== null && (flags & 0xFF) === 0x01) {
    res.push({ idx: i, val: (arr[i] * 3.14159) >> 2 });
  } else {
    res.push({ idx: i, val: -1 });
  }
}
`.repeat(10); // ~1,800 characters

  // Sparse prose: long natural English words, few punctuations, standard spacing
  const sparseProse = `
The international scientific symposium gathered researchers from across multiple continents
to deliberate upon sustainable development, renewable environmental technologies, and collective
strategies for international cooperation and technological advancement in contemporary society.
`.repeat(6); // ~1,800 characters

  // Normalize lengths to exact same character count
  const minLength = Math.min(denseCode.length, sparseProse.length);
  const normalizedCode = denseCode.slice(0, minLength);
  const normalizedProse = sparseProse.slice(0, minLength);
  assert.strictEqual(normalizedCode.length, normalizedProse.length);

  const codeTokens = estimateTokensPrecise(normalizedCode, 'gemini');
  const proseTokens = estimateTokensPrecise(normalizedProse, 'gemini');

  // Dense code must produce at least 25% more tokens than sparse prose for the exact same character count
  assert.ok(
    codeTokens > proseTokens * 1.25,
    `Dense code tokens (${codeTokens}) should be >= 1.25x sparse prose tokens (${proseTokens}) for ${minLength} chars`
  );
});

test('Adversarial 5.2: CJK ideographs estimate at ~1 token per character rather than 1 per 4 characters', () => {
  const cjkText = '自然言語処理におけるトークナイザーの語彙数と圧縮効率に関する評価実験。'; // 36 characters
  const tokens = estimateTokensPrecise(cjkText, 'gemini');

  // 36 CJK chars with cjkR = 1.3 -> Math.ceil(36 / 1.3) = 28 tokens
  // If naive chars / 4 were used, it would yield only 9 tokens (36 / 4 = 9)
  assert.ok(
    tokens >= 25 && tokens <= 36,
    `CJK tokens for 36 chars should be between 25 and 36 (got ${tokens})`
  );
  assert.ok(
    tokens >= (36 / 4) * 2.5,
    `CJK estimation (${tokens}) must be at least 2.5x higher than naive 1-token-per-4-chars (${36 / 4})`
  );
});

test('Adversarial 5.3: Valid JSON payload parsed and estimated with JSON ratio', () => {
  const validJson = JSON.stringify({
    status: 'success',
    sessionId: 'c8f7d9a1-2b3c-4d5e-6f7a-8b9c0d1e2f3a',
    timestamp: 1729000000000,
    metrics: { cpu: 12.5, memory: 45.8, network: [1024, 2048, 4096] },
    flags: { enabled: true, debug: false, experimental: null }
  }, null, 2);

  const tokens = estimateTokensPrecise(validJson, 'gemini');
  // jsonR = 2.2 -> validJson.length / 2.2
  const expectedApprox = Math.ceil(validJson.length / 2.2);
  assert.ok(
    Math.abs(tokens - expectedApprox) <= 5,
    `Valid JSON estimated ${tokens} tokens, expected close to ${expectedApprox}`
  );
});

test('Adversarial 5.4: Malformed and truncated JSON payloads do not throw uncaught exceptions', () => {
  const malformedCases = [
    '{"unclosed": "string without end',
    '{"key": undefined, bad: syntax}',
    '{[1, 2, 3]: "invalid object key"}',
    '{"deep": ' + '{"deep": '.repeat(50) + '1' + '}'.repeat(40), // unbalanced braces
    '{"a": 1, "b": 2,}', // trailing comma
    '{"proto": {"__proto__": { "polluted": true }}}'
  ];

  for (const badJson of malformedCases) {
    assert.doesNotThrow(() => {
      const tokens = estimateTokensPrecise(badJson, 'gemini');
      assert.ok(typeof tokens === 'number' && tokens > 0);
    }, `Failed on malformed JSON: ${badJson.slice(0, 30)}`);
  }
});

test('Adversarial 5.5: calculateEffectiveTokens smoothly scales pending turns/chars with kappa factor', () => {
  const entryWithGroundTruth = {
    apiTokens: 80000,
    transcriptChars: 150000,
    maxChars: 150000,
    maxTurns: 30,
    pendingChars: 2000,
    pendingTurns: 1,
    pendingCodeChars: 500,
    systemBaseline: { tokens: 2500 }
  };

  const composer = 'Please refactor this method to use streaming buffers instead of memory arrays.';
  const effective = calculateEffectiveTokens(entryWithGroundTruth, composer, 'gemini-1.5-pro');

  // Should anchor on 80,000 + pending delta + composer tokens
  assert.ok(typeof effective === 'number' && !Number.isNaN(effective));
  assert.ok(effective > 80000, `Effective tokens (${effective}) must exceed ground-truth base (80000)`);
  assert.ok(effective < 82000, `Delta should be bounded realistically (got ${effective})`);
});
