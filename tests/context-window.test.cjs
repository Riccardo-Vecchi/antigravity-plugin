"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { contextWindowBreakdown } = require("../common/context-budget.cjs");

test("context rows partition usage without adding cache counters twice", () => {
  const summary = contextWindowBreakdown({
    tokens: 78000,
    ceiling: 1000000,
    systemTokens: 2000,
    cacheReadTokens: 50000,
    inputTokens: 20000,
    outputTokens: 111,
  });
  assert.deepEqual(summary, {
    used: 78000,
    capacity: 1000000,
    instructions: 2000,
    conversation: 76000,
    free: 922000,
    percentage: 7.8,
  });
  assert.equal(
    summary.instructions + summary.conversation + summary.free,
    summary.capacity,
  );
});

test("missing instruction telemetry remains unknown instead of showing zero", () => {
  const summary = contextWindowBreakdown({ tokens: 8000, ceiling: 128000 });
  assert.equal(summary.instructions, null);
  assert.equal(summary.conversation, null);
  assert.equal(summary.free, 120000);
});

test("invalid inputs and over-capacity estimates never make negative segments", () => {
  assert.deepEqual(
    contextWindowBreakdown({
      tokens: NaN,
      ceiling: Infinity,
      systemTokens: -10,
    }),
    {
      used: 0,
      capacity: null,
      instructions: null,
      conversation: null,
      free: null,
      percentage: null,
    },
  );
  const summary = contextWindowBreakdown({
    tokens: 300000,
    ceiling: 256000,
    systemTokens: 400000,
  });
  assert.equal(summary.instructions, 300000);
  assert.equal(summary.conversation, 0);
  assert.equal(summary.free, 0);
  assert.equal(summary.percentage, 100);
});

test("compaction headroom keeps model capacity and clamps past the threshold", () => {
  const stats = { tokens: 100000, ceiling: 1000000, compactionThreshold: 512000 };
  const summary = contextWindowBreakdown(stats);
  assert.equal(summary.capacity, 1000000);
  assert.equal(summary.free, 900000);
  assert.equal(summary.percentage, 10);
  assert.deepEqual(summary.compaction, {
    threshold: 512000,
    remaining: 412000,
    percentage: 19.53125,
  });
  assert.equal(contextWindowBreakdown({ ...stats, tokens: 256000 }).compaction.percentage, 50);
  assert.deepEqual(contextWindowBreakdown({ ...stats, tokens: 512000 }).compaction, {
    threshold: 512000,
    remaining: 0,
    percentage: 100,
  });
  assert.equal(contextWindowBreakdown({ ...stats, tokens: 512001 }).compaction.percentage, 100);
  assert.equal(contextWindowBreakdown({ ...stats, ceiling: 128000 }).compaction, undefined);
});

test("a named model restores its threshold from a legacy cache without changing capacity", () => {
  const { extractConversationStats, loadConversationState, saveConversationState } =
    require("../common/context-budget.cjs");
  const entries = new Map();
  const storage = {
    setItem: (key, value) => entries.set(key, value),
    getItem: (key) => entries.get(key),
  };
  const convKey = "/c/legacy-compaction-example";
  saveConversationState(convKey, {
    modelName: "Gemini 4 Argon (High)",
    ceiling: 1000000,
    apiTokens: 100000,
    maxTurns: 1,
  }, storage);
  const doc = { location: { pathname: convKey } };
  const stats = extractConversationStats(doc, storage);
  assert.equal(stats.ceiling, 1000000);
  assert.equal(stats.compactionThreshold, 512000);
  assert.equal(stats.budget.percentage, 20);
  assert.equal(loadConversationState(convKey, storage).ceiling, 1000000);

  for (const [label, expected] of [
    ["Gemini 4 Carbon Medium", 512000],
    ["Gemini 4 Hydrogen (Extra)", 512000],
    ["Gemini 3.8 Flash (Medium)", 256000],
    ["Gemini 3.8 Flash (Low)", 256000],
    ["Claude Opus 5.5 (Thinking)", 256000],
    ["Orchestrator (Argon)", 256000],
    ["Gemini 4 Argon (128k)", null],
    ["Gemini 4 Argon Experimental", null],
    ["GPT-OSS 120B", null],
  ]) {
    doc.querySelector = (selector) => selector.includes("model-selector-trigger")
      ? { textContent: label }
      : null;
    assert.equal(extractConversationStats(doc, storage).compactionThreshold, expected, label);
  }
});
