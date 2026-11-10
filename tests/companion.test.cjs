"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { createCompanion, SERVER } = require("../common/companion.cjs"),
  {
    connect,
    createSettings,
    locations,
  } = require("../common/companion-core.cjs");
async function fixture(
  t,
  { foreign = false, idleTimeout = 60000, request } = {},
) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-comp-")),
    configDir = path.join(home, ".config/antigravity-plugin"),
    mcp = path.join(home, ".gemini/config/mcp_config.json");
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(mcp), { recursive: true });
  await fs.writeFile(
    mcp,
    JSON.stringify({
      other: "preserve",
      mcpServers: {
        other: { command: "unrelated" },
        ...(foreign ? { [SERVER]: { command: "foreign" } } : {}),
      },
    }),
  );
  let ready = false,
    opened = 0,
    closed = 0,
    created = 0;
  const options = {
    home,
    configDir,
    idleTimeout,
    adapter: {
      detect: async () => ({
        available: [
          { id: "brave", label: "Brave" },
          { id: "edge", label: "Edge" },
        ],
        defaultBrowser: "brave",
      }),
      openDebug: async () => {
        opened++;
      },
    },
    resolve: async () => ({ entry: "/official/engine.js", version: "1.12.0" }),
    probe: async () => ready,
    engineFactory: () => {
      created++;
      return {
        request: async (method, params, timeout) =>
          request
            ? request(method, params, timeout)
            : method === "initialize"
              ? { protocolVersion: "2024-11-05", capabilities: { tools: {} } }
              : method === "tools/list"
                ? { tools: [{ name: "list_pages" }, { name: "take_snapshot" }] }
                : (timeout !== undefined && assert.equal(timeout, 240000),
                  { content: [{ type: "text", text: "fixture only" }] }),
        close() {
          closed++;
        },
      };
    },
  };
  const broker = await createCompanion(options);
  t.after(() => broker.close());
  return {
    broker,
    configDir,
    mcp,
    setReady: () => (ready = true),
    get opened() {
      return opened;
    },
    get closed() {
      return closed;
    },
    get created() {
      return created;
    },
  };
}
test("one browser choice replaces extension setup; native consent auto-completes after the debug endpoint appears", async (t) => {
  const f = await fixture(t);
  let s = await f.broker.perform("setupBrowser", true);
  assert.equal(s.browser.enabled, true);
  assert.equal(s.browser.selectedBrowser, "brave");
  assert.equal(s.browser.registered, true);
  assert.equal(s.browser.connected, false);
  await f.broker.perform("connectBrowser", true);
  assert.equal(f.opened, 1);
  f.setReady();
  await f.broker.perform("connectBrowser", true);
  await new Promise(setImmediate);
  s = await f.broker.snapshot();
  assert.equal(s.browser.connected, true);
  const m = JSON.parse(await fs.readFile(f.mcp, "utf8"));
  assert.equal(m.other, "preserve");
  assert.equal(m.mcpServers.other.command, "unrelated");
  assert.equal(m.mcpServers[SERVER].enabledTools, undefined);
  await assert.rejects(
    connect(
      "browser",
      () => {},
      () => {},
      f.configDir,
    ),
    /Unauthorized/,
  );
  const client = await connect(
    "mcp",
    () => {},
    () => {},
    f.configDir,
  );
  t.after(() => client.close());
  assert.deepEqual(
    (await client.request("rpc", { method: "tools/list" })).tools.map(
      (t) => t.name,
    ),
    ["list_pages", "take_snapshot", "release_browser"],
  );
  await assert.rejects(
    client.request("rpc", { method: "eval" }),
    /Unsupported/,
  );
});
test("disable immediately closes the engine, removes only the owned MCP registration and does not regrant browser access", async (t) => {
  const f = await fixture(t);
  await f.broker.perform("setupBrowser", true);
  await f.broker.rpc("tools/list", {});
  assert.equal(f.created, 1);
  await f.broker.perform("disableBrowser", true);
  assert.equal(f.closed, 1);
  await assert.rejects(f.broker.rpc("tools/call", {}), /disabled/);
  assert.equal(
    JSON.parse(await fs.readFile(f.mcp)).mcpServers[SERVER],
    undefined,
  );
  const s = await f.broker.perform("setupBrowser", true);
  assert.equal(s.browser.connected, false);
  assert.equal(f.created, 1);
});
test("switching browsers closes the previous session and keeps choice across restarts", async (t) => {
  const f = await fixture(t);
  await f.broker.perform("setupBrowser", true);
  await f.broker.rpc("initialize", {});
  await f.broker.perform("selectBrowser", "edge");
  assert.equal(f.closed, 1);
  assert.equal(
    (await createSettings(f.configDir)).settings.selectedBrowser,
    "edge",
  );
  await assert.rejects(
    f.broker.perform("selectBrowser", "arbitrary-path"),
    /Unsupported/,
  );
});
test("foreign MCP entries are never overwritten", async (t) => {
  const f = await fixture(t, { foreign: true });
  await assert.rejects(
    f.broker.perform("setupBrowser", true),
    /belongs to another/,
  );
  assert.equal(
    JSON.parse(await fs.readFile(f.mcp)).mcpServers[SERVER].command,
    "foreign",
  );
});
test("settings migration drops old Activity state and retains only browser choice and activation", async (t) => {
  const f = await fixture(t),
    loc = locations(f.configDir);
  await fs.writeFile(
    loc.settings,
    JSON.stringify({
      browserEnabled: true,
      selectedBrowser: "edge",
      recordActivity: true,
      retentionDays: 30,
    }),
  );
  await fs.writeFile(path.join(loc.directory, "activity.json"), "[]");
  const s = await createSettings(f.configDir);
  assert.deepEqual(s.settings, {
    browserEnabled: true,
    selectedBrowser: "edge",
  });
  await assert.rejects(fs.stat(path.join(loc.directory, "activity.json")), {
    code: "ENOENT",
  });
});

test("idle release preserves setup and polling does not reconnect; next tool reconnects", async (t) => {
  const f = await fixture(t, { idleTimeout: 25 });
  await f.broker.perform("setupBrowser", true);
  f.setReady();
  await f.broker.perform("connectBrowser", true);
  await new Promise(setImmediate);
  assert.equal((await f.broker.snapshot()).browser.active, true);
  await new Promise((r) => setTimeout(r, 60));
  let s = await f.broker.snapshot();
  assert.equal(s.browser.connected, true);
  assert.equal(s.browser.active, false);
  assert.equal(f.closed, 1);
  await f.broker.snapshot();
  await f.broker.snapshot();
  assert.equal(f.created, 1);
  await f.broker.rpc("tools/call", { name: "take_snapshot" });
  assert.equal(f.created, 2);
  s = await f.broker.snapshot();
  assert.equal(s.browser.active, true);
});
test("release_browser closes control without opening or closing browser tabs", async (t) => {
  const f = await fixture(t);
  await f.broker.perform("setupBrowser", true);
  await f.broker.rpc("tools/call", { name: "take_snapshot" });
  const result = await f.broker.rpc("tools/call", { name: "release_browser" });
  assert.equal(result.isError, undefined);
  assert.equal(f.closed, 1);
  assert.equal(f.opened, 0);
  await f.broker.rpc("tools/call", { name: "release_browser" });
  assert.equal(f.created, 1);
});
test("idle timeout never interrupts an operation; release refuses concurrent work", async (t) => {
  let finish;
  const f = await fixture(t, {
    idleTimeout: 25,
    request: async (method) => {
      if (method !== "tools/call") return {};
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await f.broker.perform("setupBrowser", true);
  const job = f.broker.rpc("tools/call", { name: "take_snapshot" });
  while (!finish) await new Promise(setImmediate);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.closed, 0);
  assert.equal(
    (await f.broker.rpc("tools/call", { name: "release_browser" })).isError,
    true,
  );
  finish({ content: [] });
  await job;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.closed, 1);
});
test("startup and metadata requests never verify the browser in the background", async (t) => {
  const f = await fixture(t, { idleTimeout: 25 });
  await f.broker.perform("setupBrowser", true);
  await f.broker.perform("disableBrowser", true);
  await f.broker.perform("setupBrowser", true);
  f.setReady();
  await f.broker.rpc("tools/list");
  await new Promise((r) => setTimeout(r, 60));
  await f.broker.snapshot();
  assert.equal(f.closed, 1);
  assert.equal(f.created, 1);
});
