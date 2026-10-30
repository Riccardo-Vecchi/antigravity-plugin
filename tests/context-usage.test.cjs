"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const { createContextReader } = require("../common/context-usage.cjs");
const reader = createContextReader();
test("context percentages require both reported estimate and limit", () => {
  const state = {
    trajectorySlice: {
      generatorMetadatasInSlice: [
        {
          metadata: {
            value: {
              contextWindowMetadata: {
                estimatedTokensUsed: 291000,
                maxContextTokens: 475000,
              },
            },
          },
        },
      ],
    },
  };
  const value = reader.snapshot(state);
  assert.equal(value.used, 291000);
  assert.equal(value.max, 475000);
  assert.equal(Math.round(value.percent), 61);
});
test("reported input and cache tokens stay separate and never invent a limit", () => {
  const value = reader.snapshot({
    trajectorySlice: {
      stepsInSlice: [
        {
          metadata: {
            modelUsage: {
              inputTokens: 3036n,
              cacheReadTokens: 34547n,
              cacheWriteTokens: 0n,
            },
          },
        },
      ],
    },
  });
  assert.equal(value.input, 3036);
  assert.equal(value.cacheRead, 34547);
  assert.equal(value.used, null);
  assert.equal(value.max, null);
  assert.equal(value.percent, null);
});
test("absent, invalid and unsafe numeric metadata cannot fabricate usage", () => {
  assert.equal(reader.snapshot({}), null);
  assert.equal(
    reader.snapshot({ trajectorySlice: { stepsInSlice: [] } }),
    null,
  );
  for (const value of [
    -1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    "12k",
  ])
    assert.equal(
      reader.snapshot({
        trajectorySlice: {
          stepsInSlice: [{ metadata: { modelUsage: { inputTokens: value } } }],
        },
      }),
      null,
    );
});
test("only the current native conversation provider is discovered; reader is serializable", () => {
  const provider = { getState() {}, onDidChange() {} },
    trigger = {
      __reactFiber$test: {
        dependencies: {
          firstContext: {
            memoizedValue: {
              cascadeContext: { state: { agentStateProvider: provider } },
            },
          },
        },
      },
    };
  assert.equal(reader.providerFor(trigger), provider);
  assert.equal(reader.providerFor({}), null);
  const cloned = vm.runInNewContext(
    `(${createContextReader.toString()})()`,
    {},
  );
  assert.equal(cloned.snapshot(null), null);
});
