"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createViewerBundleLoader } = require("../common/viewer-bundle.cjs");
test("viewer code is lazy and concurrent previews share the same read", async () => {
  let count = 0,
    finish;
  const load = createViewerBundleLoader("bundle.js", async () => {
    count++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  assert.equal(count, 0);
  const a = load(),
    b = load();
  await Promise.resolve();
  assert.equal(count, 1);
  assert.equal(a, b);
  finish("viewer code");
  assert.equal(await a, "viewer code");
  assert.equal(await load(), "viewer code");
  assert.equal(count, 1);
});
test("a failed bundle read can be retried", async () => {
  let count = 0;
  const load = createViewerBundleLoader("bundle.js", async () => {
    if (++count === 1) throw Error("temporary failure");
    return "code";
  });
  await assert.rejects(load(), /temporary failure/);
  assert.equal(await load(), "code");
  assert.equal(count, 2);
});
