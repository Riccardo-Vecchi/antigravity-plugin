'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  extractConversationId,
  parseTranscriptContent,
  readTranscriptStats
} = require('../common/transcript-reader.cjs');

test('extractConversationId parses uuid from various url and key formats', () => {
  const uuid = '01ed90cd-c026-4190-bfd8-5bb6444c0719';
  assert.equal(extractConversationId(`/c/${uuid}`), uuid);
  assert.equal(extractConversationId(`/c/${uuid}?section=123`), uuid);
  assert.equal(extractConversationId(`https://127.0.0.1:28256/c/${uuid}#anchor`), uuid);
  assert.equal(extractConversationId(uuid), uuid);
  assert.equal(extractConversationId(''), '');
  assert.equal(extractConversationId('default'), '');
  assert.equal(extractConversationId('/'), '');
  assert.equal(extractConversationId('new'), '');
  assert.equal(extractConversationId('invalid-key'), '');
  assert.equal(extractConversationId(null), '');
  assert.equal(readTranscriptStats('default'), null);
});

test('parseTranscriptContent extracts turns, code characters, images and apiTokens', () => {
  const sampleJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>How do I configure this plugin?</USER_REQUEST>',
      media: [{ mime_type: 'image/png', uri: '/path/to/diagram.png' }]
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      content: 'Here is the setup code:\n```javascript\nconst a = 1;\nconsole.log(a);\n```',
      input_tokens: 1200,
      cache_read_tokens: 3400
    }),
    JSON.stringify({
      step_index: 2,
      type: 'USER_INPUT',
      content: 'Can you show me more details?'
    }),
    JSON.stringify({
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      content: 'Sure! All configured properly.',
      input_tokens: 1500,
      cache_read_tokens: 4200
    })
  ].join('\n');

  const parsed = parseTranscriptContent(sampleJsonl);
  assert.ok(parsed);
  assert.equal(parsed.turns, 2);
  assert.equal(parsed.imageCount, 1);
  assert.equal(parsed.imageTokens, 258);
  assert.equal(parsed.apiTokens, 5700); // 1500 + 4200
  assert.ok(parsed.chars > 100);
  assert.ok(parsed.codeChars > 20);
  assert.equal(parsed.blocks.length, 4); // 2 USER_INPUT + 2 PLANNER_RESPONSE
});

test('parseTranscriptContent includes output_tokens, thinking, tool_calls and GENERIC tool outputs', () => {
  const sampleJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Inspect the project logs'
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 5000,
      cache_read_tokens: 1000,
      output_tokens: 350,
      thinking: 'Analyzing the environment logs...',
      tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm test' } }]
    }),
    JSON.stringify({
      step_index: 2,
      type: 'GENERIC',
      content: 'Test output: 10 passed, 0 failed\n```output\nAll tests green\n```'
    }),
    JSON.stringify({
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      input_tokens: 6500,
      cache_read_tokens: 1000,
      output_tokens: 200,
      content: 'Everything is clean!'
    }),
    JSON.stringify({
      step_index: 4,
      type: 'USER_INPUT',
      content: 'Great, what about disk space?'
    })
  ].join('\n');

  const parsed = parseTranscriptContent(sampleJsonl);
  assert.ok(parsed);
  assert.equal(parsed.turns, 2);
  // Last PLANNER_RESPONSE was step 3: 6500 + 1000 + 200 = 7700
  assert.equal(parsed.apiTokens, 7700);
  // Step 4 is a USER_INPUT after step 3: pendingChars should be > 0
  assert.ok(parsed.pendingChars > 0);
  assert.equal(parsed.pendingTurns, 1);
  assert.ok(parsed.chars > 200);
});

test('readTranscriptStats reads from disk and formats complete state', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-brain-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const convId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const logsDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const sampleJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Hello Antigravity'
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      content: 'Hello! How can I help you?',
      input_tokens: 500,
      cache_read_tokens: 1000
    })
  ].join('\n');

  fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), sampleJsonl, 'utf8');

  const stats = readTranscriptStats(`/c/${convId}`, { brainDir: tmpDir });
  assert.ok(stats);
  assert.equal(stats.conversationId, convId);
  assert.equal(stats.maxTurns, 1);
  assert.equal(stats.apiTokens, 1500);
  assert.ok(stats.maxChars > 30);
  assert.equal(stats.systemTokens, 1500);
  assert.equal(stats.blocks.length, 2);

  // Non-existent conversation returns null
  assert.equal(readTranscriptStats('/c/non-existent-conv-id', { brainDir: tmpDir }), null);
});

test('readTranscriptStats prefers transcript_full.jsonl when available', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-brain-full-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const convId = 'f1e2d3c4-b5a6-7890-1234-56789abcdef0';
  const logsDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const truncatedJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Short'
    })
  ].join('\n');

  const fullJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Very long untruncated transcript full content with lots of characters'
    })
  ].join('\n');

  fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), truncatedJsonl, 'utf8');
  fs.writeFileSync(path.join(logsDir, 'transcript_full.jsonl'), fullJsonl, 'utf8');

  const stats = readTranscriptStats(`/c/${convId}`, { brainDir: tmpDir });
  assert.ok(stats);
  assert.ok(stats.maxChars > 50, 'uses full content rather than truncated content');
});

test('extractConversationId resolves conversation UUID by matching title or prompt in brain directory', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-brain-search-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const convId = '98765432-10ab-cdef-1234-567890abcdef';
  const logsDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const sampleJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Fix architecture issue in payment gateway</USER_REQUEST>'
    })
  ].join('\n');

  fs.writeFileSync(path.join(logsDir, 'transcript.jsonl'), sampleJsonl, 'utf8');

  // Lookup by 'conv:Fix architecture issue' without knowing the UUID
  const foundId = extractConversationId('conv:Fix architecture issue', { brainDir: tmpDir });
  assert.equal(foundId, convId, 'resolves exact UUID from conversation title or prompt');

  const stats = readTranscriptStats('conv:Fix architecture issue', { brainDir: tmpDir });
  assert.ok(stats, 'readTranscriptStats loads stats successfully through title/prompt query');
  assert.equal(stats.conversationId, convId);
});

test('parseTranscriptContent extracts granular inputTokens, cacheReadTokens, and outputTokens', () => {
  const jsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Run benchmark'
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 3120,
      cache_read_tokens: 15400,
      output_tokens: 450,
      content: 'Benchmark executed successfully.'
    })
  ].join('\n');

  const parsed = parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.equal(parsed.inputTokens, 3120);
  assert.equal(parsed.cacheReadTokens, 15400);
  assert.equal(parsed.outputTokens, 450);
  assert.equal(parsed.apiTokens, 18970); // 3120 + 15400 + 450
});

test('parseTranscriptContent accounts for SYSTEM_MESSAGE in characters, code blocks and pending counters', () => {
  const jsonl = [
    JSON.stringify({
      step_index: 0,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      content: 'You are an AI assistant.\n```system_rules\nrule 1: stay accurate\n```'
    }),
    JSON.stringify({
      step_index: 1,
      type: 'USER_INPUT',
      content: 'Hello'
    })
  ].join('\n');

  const parsed = parseTranscriptContent(jsonl);
  assert.ok(parsed);
  assert.ok(parsed.chars > 50);
  assert.ok(parsed.codeChars > 20);
  assert.equal(parsed.blocks.length, 2);
  assert.ok(parsed.blocks[0][0].startsWith('s:step-0'));
  assert.ok(parsed.pendingChars > 50);
});

test('readTranscriptStats exposes granular token breakdown and file mtime from disk', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-stats-granular-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const convId = '55555555-4444-3333-2222-111111111111';
  const logsDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const sampleJsonl = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Compute metrics'
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      input_tokens: 2500,
      cache_read_tokens: 12000,
      output_tokens: 300,
      content: 'Done!'
    })
  ].join('\n');

  const fullPath = path.join(logsDir, 'transcript_full.jsonl');
  fs.writeFileSync(fullPath, sampleJsonl, 'utf8');

  const stats = readTranscriptStats(`/c/${convId}`, { brainDir: tmpDir });
  assert.ok(stats);
  assert.equal(stats.apiTokens, 14800);
  assert.equal(stats.inputTokens, 2500);
  assert.equal(stats.cacheReadTokens, 12000);
  assert.equal(stats.outputTokens, 300);
  assert.ok(typeof stats.mtime === 'number' && stats.mtime > 0);
});

test('parseTranscriptContent and readTranscriptStats compute per-turn deltaTokens and turnsList', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-turns-list-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const convId = '99999999-8888-7777-6666-555555555555';
  const logsDir = path.join(tmpDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const sampleJsonl = [
    // Turn 1
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Turn 1 prompt' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'read_file' }], output_tokens: 100, input_tokens: 2000, cache_read_tokens: 10000 }),
    JSON.stringify({ step_index: 2, type: 'GENERIC', content: 'file content' }),
    JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', output_tokens: 300, input_tokens: 2500, cache_read_tokens: 10000 }),
    // Turn 2
    JSON.stringify({ step_index: 4, type: 'USER_INPUT', content: 'Turn 2 prompt' }),
    JSON.stringify({ step_index: 5, type: 'PLANNER_RESPONSE', output_tokens: 250, input_tokens: 1500, cache_read_tokens: 12500 }),
    // Turn 3 (context contraction / cache optimization)
    JSON.stringify({ step_index: 6, type: 'USER_INPUT', content: 'Turn 3 prompt' }),
    JSON.stringify({ step_index: 7, type: 'PLANNER_RESPONSE', output_tokens: 180, input_tokens: 1200, cache_read_tokens: 10000 }),
    // Turn 4 (Compaction checkpoint event with pre-compaction peak)
    JSON.stringify({ step_index: 8, type: 'USER_INPUT', content: 'Turn 4 prompt' }),
    JSON.stringify({ step_index: 9, type: 'PLANNER_RESPONSE', output_tokens: 500, input_tokens: 5000, cache_read_tokens: 15000 }), // 20,500 peak!
    JSON.stringify({ step_index: 10, type: 'CHECKPOINT', content: '# Resuming from a compaction\n\nTruncated context summary' }),
    JSON.stringify({ step_index: 11, type: 'PLANNER_RESPONSE', output_tokens: 150, input_tokens: 1000, cache_read_tokens: 2000 }),
    // Turn 5 (Compaction checkpoint event occurring immediately after USER_INPUT before any PLANNER_RESPONSE)
    JSON.stringify({ step_index: 12, type: 'USER_INPUT', content: 'Turn 5 prompt reaching 258k' }),
    JSON.stringify({ step_index: 13, type: 'CHECKPOINT', content: '# Resuming from a compaction' }),
    JSON.stringify({ step_index: 14, type: 'PLANNER_RESPONSE', output_tokens: 100, input_tokens: 800, cache_read_tokens: 500 })
  ].join('\n');

  const fullPath = path.join(logsDir, 'transcript_full.jsonl');
  fs.writeFileSync(fullPath, sampleJsonl, 'utf8');

  const stats = readTranscriptStats(`/c/${convId}`, { brainDir: tmpDir });
  assert.ok(stats);
  assert.ok(Array.isArray(stats.turnsList));
  assert.equal(stats.turnsList.length, 5);

  // Turn 1 assertions
  const t1 = stats.turnsList[0];
  assert.equal(t1.turnIndex, 1);
  assert.equal(t1.prompt, 'Turn 1 prompt');
  assert.equal(t1.outputTokens, 400); // 100 + 300
  assert.equal(t1.finalOutputTokens, 300);
  assert.equal(t1.inputTokens, 2500);
  assert.equal(t1.cacheReadTokens, 10000);
  assert.equal(t1.totalTokens, 12800); // 2500 + 10000 + 300
  assert.equal(t1.realDelta, 12800);
  assert.equal(t1.deltaTokens, 12800); // initial turn growth
  assert.equal(t1.footprint, 2800);    // active input (2500) + final output (300)
  assert.equal(t1.toolCallsCount, 1);
  assert.equal(t1.hasCompaction, false);

  // Turn 2 assertions
  const t2 = stats.turnsList[1];
  assert.equal(t2.turnIndex, 2);
  assert.equal(t2.prompt, 'Turn 2 prompt');
  assert.equal(t2.outputTokens, 250);
  assert.equal(t2.finalOutputTokens, 250);
  assert.equal(t2.inputTokens, 1500);
  assert.equal(t2.cacheReadTokens, 12500);
  assert.equal(t2.totalTokens, 14250); // 1500 + 12500 + 250
  assert.equal(t2.realDelta, 1450);    // 14250 - 12800 = +1450 context growth
  assert.equal(t2.deltaTokens, 1450);
  assert.equal(t2.footprint, 1750);    // active input (1500) + final output (250)
  assert.equal(t2.toolCallsCount, 0);
  assert.equal(t2.hasCompaction, false);

  // Turn 3 assertions (negative net delta due to cache optimization / log trimming)
  const t3 = stats.turnsList[2];
  assert.equal(t3.turnIndex, 3);
  assert.equal(t3.prompt, 'Turn 3 prompt');
  assert.equal(t3.outputTokens, 180);
  assert.equal(t3.finalOutputTokens, 180);
  assert.equal(t3.inputTokens, 1200);
  assert.equal(t3.cacheReadTokens, 10000);
  assert.equal(t3.totalTokens, 11380); // 1200 + 10000 + 180
  assert.equal(t3.realDelta, -2870);   // 11380 - 14250 = -2870 contraction
  assert.equal(t3.deltaTokens, 0);     // clamped non-negative
  assert.equal(t3.footprint, 1380);    // active input (1200) + final output (180)
  assert.equal(t3.toolCallsCount, 0);
  assert.equal(t3.hasCompaction, false);

  // Turn 4 assertions (explicit compaction checkpoint with peak tracking)
  const t4 = stats.turnsList[3];
  assert.equal(t4.turnIndex, 4);
  assert.equal(t4.prompt, 'Turn 4 prompt');
  assert.equal(t4.outputTokens, 650); // 500 + 150
  assert.equal(t4.finalOutputTokens, 150);
  assert.equal(t4.inputTokens, 1000);
  assert.equal(t4.cacheReadTokens, 2000);
  assert.equal(t4.totalTokens, 3150); // 1000 + 2000 + 150
  assert.equal(t4.realDelta, -8230);  // 3150 - 11380
  assert.equal(t4.footprint, 1150);
  assert.equal(t4.hasCompaction, true);
  assert.equal(t4.peakTokens, 20500);           // peak reached before compaction
  assert.equal(t4.preCompactionTokens, 20500);  // pre-compaction peak
  assert.equal(t4.postCompactionTokens, 3150);  // post-compaction reset

  // Turn 5 assertions (compaction occurring immediately at prompt start before PLANNER_RESPONSE)
  const t5 = stats.turnsList[4];
  assert.equal(t5.turnIndex, 5);
  assert.equal(t5.prompt, 'Turn 5 prompt reaching 258k');
  assert.equal(t5.outputTokens, 100);
  assert.equal(t5.finalOutputTokens, 100);
  assert.equal(t5.inputTokens, 800);
  assert.equal(t5.cacheReadTokens, 500);
  assert.equal(t5.totalTokens, 1400); // 800 + 500 + 100
  assert.equal(t5.realDelta, -1750);  // 1400 - 3150
  assert.equal(t5.hasCompaction, true);
  assert.equal(t5.preCompactionTokens, 3150); // captures peak from previous turn!
  assert.equal(t5.postCompactionTokens, 1400); // post-compaction first response
});


test('unchanged transcript files are cached and changed files invalidate their snapshot', (t) => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agpa-transcript-cache-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const id = '11111111-2222-3333-4444-555555555555';
  const logs = path.join(dir, id, '.system_generated', 'logs');
  fs.mkdirSync(logs, {recursive:true});
  const file = path.join(logs, 'transcript.jsonl');
  fs.writeFileSync(file, JSON.stringify({type:'USER_INPUT',content:'first question'})+'\n');
  const original = fs.readFileSync;
  let reads = 0;
  const spy = t.mock.method(fs,'readFileSync',function(name,...args){
    if (name === file) reads++;
    return original.call(this,name,...args);
  });
  const first = readTranscriptStats('/c/'+id,{brainDir:dir});
  const again = readTranscriptStats('/c/'+id,{brainDir:dir});
  assert.equal(reads,1);
  assert.equal(first.maxChars,again.maxChars);
  fs.appendFileSync(file,JSON.stringify({type:'USER_INPUT',content:'second longer question'})+'\n');
  const next = readTranscriptStats('/c/'+id,{brainDir:dir});
  assert.equal(reads,2);
  assert.ok(next.maxChars > first.maxChars);
  spy.mock.restore();
});
