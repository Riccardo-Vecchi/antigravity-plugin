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
