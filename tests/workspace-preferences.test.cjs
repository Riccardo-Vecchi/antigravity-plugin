"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { createStore } = require("../common/workspace-preferences.cjs");
test("sidebar modes are independent, persisted and retain the native default until changed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "workspace.json"),
    store = createStore(file);
  assert.equal((await store.load()).sidebarMode, null);
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
  for (const mode of ["open", "compact", "hover"]) {
    await store.update(mode);
    assert.equal((await createStore(file).load()).sidebarMode, mode);
  }
  const before = await fs.readFile(file);
  await assert.rejects(store.update("invalid"));
  assert.deepEqual(await fs.readFile(file), before);
});
