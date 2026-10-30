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
  assert.equal(extractConversationId('invalid-key'), '');
  assert.equal(extractConversationId(null), '');
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
