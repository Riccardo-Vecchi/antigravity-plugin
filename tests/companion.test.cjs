"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {createSettings, connect, locations} = require("../common/companion-core.cjs");
const { createCompanion } = require("../common/companion.cjs");
const { validate } = require("../common/browser-tools.cjs");
const policy = require("../common/browser-extension/policy.js");
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-comp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("removing the preview deletes history and recording preferences but preserves browser access", async (t) => {
  const root = await directory(t), loc = locations(root);
  await fs.mkdir(loc.directory, {recursive:true});
  await fs.writeFile(path.join(loc.directory,"activity.json"), '[{"old":"history"}]');
  await fs.writeFile(loc.settings, JSON.stringify({browserEnabled:true,recordActivity:true,retentionDays:30}));
  const store = await createSettings(root);
  assert.deepEqual(store.settings,{browserEnabled:true});
  assert.deepEqual(JSON.parse(await fs.readFile(loc.settings)), {browserEnabled:true});
  await assert.rejects(fs.stat(path.join(loc.directory,"activity.json")),{code:"ENOENT"});
  await store.configure({browserEnabled:false});
  assert.deepEqual((await createSettings(root)).settings,{browserEnabled:false});
});
test("browser schemas reject eval, extra arguments, unsafe numbers and ambiguous targets", () => {
  assert.throws(() => validate("browser_eval", {}));
  assert.throws(() =>
    validate("browser_snapshot", {
      connection: "abc",
      tab: 1,
      expression: "secret",
    }),
  );
  assert.throws(() =>
    validate("browser_scroll", { connection: "abc", tab: 1, y: NaN }),
  );
  assert.throws(() =>
    validate("browser_press_key", { connection: "abc", tab: 1, key: "Ctrl+L" }),
  );
  assert.throws(() =>
    validate("browser_click", { connection: "abc", tab: 1, ref: "e1" }),
  );
  assert.doesNotThrow(() => validate("browser_list_connections", {}));
});
test("browser policy excludes protected URLs, password/noneditable fields and origin confusion", () => {
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "https://user:pass@example.com",
  ])
    assert.throws(() => policy.origin(value));
  assert.equal(
    policy.origin("https://example.com/a?q=x"),
    "https://example.com",
  );
  assert.throws(() =>
    policy.editable({ nodeName: "INPUT", attributes: ["type", "password"] }),
  );
  assert.throws(() => policy.editable({ nodeName: "DIV", attributes: [] }));
  assert.throws(() =>
    policy.editable({ nodeName: "TEXTAREA", attributes: ["readonly", ""] }),
  );
  assert.throws(() =>
    policy.editable({
      nodeName: "INPUT",
      attributes: ["type", "text", "autocomplete", "current-password"],
    }),
  );
  assert.throws(() =>
    policy.editable({
      nodeName: "INPUT",
      attributes: ["autocomplete", "one-time-code"],
    }),
  );
  assert.ok(policy.editable({ nodeName: "TEXTAREA", attributes: [] }));
});
test("private broker routes only shared tabs, revokes profiles and preserves unrelated MCP settings", async (t) => {
  const root = await directory(t),
    configDir = path.join(root, "config"),
    mcp = path.join(root, ".gemini/config/mcp_config.json");
  await fs.mkdir(path.dirname(mcp), { recursive: true });
  await fs.writeFile(
    mcp,
    JSON.stringify({
      other: "preserved",
      mcpServers: { existing: { command: "untouched" } },
    }),
  );
  const broker = await createCompanion({ configDir, home: root });
  t.after(() => broker.close());
  await broker.store.configure({ browserEnabled: true });
  const browser = await connect(
    "browser",
    (m) => {
      if (m.action === "execute")
        browser.send({ reply: m.id, result: { elements: [{ name: "lab" }] } });
    },
    undefined,
    configDir,
  );
  t.after(() => browser.close());
  const id = crypto.randomUUID();
  await browser.request("announce", { id, label: "Laboratory" });
  await browser.request("tabs", [
    { id: 4, title: "Lab", url: "https://example.com/" },
  ]);
  assert.equal(
    (await broker.browserCall("browser_list_connections", {}))[0].connection,
    id,
  );
  await assert.rejects(
    broker.browserCall("browser_snapshot", { connection: id, tab: 5 }),
    /Share/,
  );
  assert.equal(
    (await broker.browserCall("browser_snapshot", { connection: id, tab: 4 }))
      .elements[0].name,
    "lab",
  );
  await broker.perform("disconnectProfile", id);
  assert.equal((await broker.snapshot()).browser.connections.length, 0);
  await broker.perform("disableBrowser", true);
  const data = JSON.parse(await fs.readFile(mcp));
  assert.equal(data.other, "preserved");
  assert.equal(data.mcpServers.existing.command, "untouched");
});
test("unauthenticated IPC cannot issue tool requests", async (t) => {
  const root = await directory(t),
    broker = await createCompanion({ configDir: root, home: root });
  t.after(() => broker.close());
  const net = require("node:net"),
    socket = net.createConnection(locations(root).endpoint);
  const p = require("../common/companion-core.cjs").peer(socket, () => {});
  t.after(() => p.close());
  await assert.rejects(
    p.request("hello", { role: "mcp", token: "0".repeat(64) }),
    /Unauthorized/,
  );
  assert.equal((await broker.snapshot()).browser.connections.length, 0);
});

test("browser error reporting exposes categories, not private paths", () => {
  const { publicError } = require("../common/companion.cjs");
  assert.equal(
    publicError({ code: "EACCES", message: "/private/profile" }),
    "permission",
  );
  assert.equal(
    publicError(Error("Browser server belongs to another installation.")),
    "serverConflict",
  );
  assert.equal(publicError(Error("/private/profile secret")), "operation");
});

test("the removed event-reporting channel and Activity commands are no longer accepted", async (t) => {
  const root = await directory(t), broker = await createCompanion({configDir:root, home:root});
  t.after(() => broker.close());
  await assert.rejects(connect("activity",()=>{},undefined,root), /Unauthorized/);
  for (const action of ["clearActivity", "activityPreferences", "disableDesktop"])
    await assert.rejects(broker.perform(action, true), /Unsupported/);
  const snapshot = await broker.snapshot();
  for(const key of ["running", "recent", "summary", "tokenUsage", "days"])
    assert.equal(Object.hasOwn(snapshot,key),false);
});

test("real browser MCP handles parallel calls and closes on EOF without recording history", async (t) => {
  const root = await directory(t),
    configDir = path.join(root, ".config", "antigravity-project-appearance"),
    broker = await createCompanion({ configDir, home: root });
  t.after(() => broker.close());
  await broker.store.configure({ browserEnabled: true });
  const { spawn } = require("node:child_process"),
    readline = require("node:readline");
  async function client(name, count) {
    const child = spawn(
      process.execPath,
      [path.resolve(__dirname, "../common/browser-mcp.cjs")],
      { env: { ...process.env, HOME: root }, stdio: ["pipe", "pipe", "pipe"] },
    );
    t.after(() => child.kill());
    let sequence = 0;
    const pending = new Map();
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const m = JSON.parse(line),
        p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      }
    });
    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence,
          timer = setTimeout(() => reject(Error("MCP timeout")), 3000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      });
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name, version: "test" },
    });
    const calls = await Promise.all(
      Array.from({ length: count }, () =>
        rpc("tools/call", { name: "browser_list_connections", arguments: {} }),
      ),
    );
    for (const call of calls) {
      assert.ok(!call.isError);
      assert.deepEqual(JSON.parse(call.content[0].text), []);
    }
    const exited = new Promise((resolve, reject) => {
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error("MCP exited with " + code)),
      );
    });
    child.stdin.end();
    await exited;
  }
  await client("test-agent", 8);
  await client("antigravity-plugin-check", 1);
  await assert.rejects(fs.stat(path.join(locations(configDir).directory,"activity.json")),{code:"ENOENT"});
});

test("extension identity remains stable and all privileged entry points are packaged", () => {
  const manifest = require("../common/browser-extension/manifest.json"),
    identity = require("../common/browser-identity.json");
  const id = crypto
    .createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  assert.equal(id, identity.extensionId);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_permissions,["tabs"]);
  assert.equal(manifest.incognito,"not_allowed");
  assert.deepEqual([...manifest.permissions].sort(), [
    "activeTab",
    "debugger",
    "nativeMessaging",
    "storage",
  ]);
  const distribution = require("../common/distribution.json").common;
  for (const resource of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
  ])
    assert.ok(distribution.includes("common/browser-extension/" + resource));
});

test("Linux host setup uses existing profiles and refuses to overwrite a foreign registration", async (t) => {
  const root = await directory(t),
    configHome = path.join(root, "profiles"),
    configDir = path.join(root, "plugin"),
    hostScript = path.resolve(__dirname, "../common/browser-host.cjs");
  await fs.mkdir(path.join(configHome, "chromium"), { recursive: true });
  const adapter = require("../linux/browser.cjs"),
    identity = require("../common/browser-identity.json"),
    options = {
      home: root,
      configDir,
      configHome,
      runtime: process.execPath,
      hostScript,
    };
  assert.deepEqual(await adapter.install(options), ["Chromium"]);
  const file = path.join(
      configHome,
      "chromium",
      "NativeMessagingHosts",
      identity.host + ".json",
    ),
    manifest = JSON.parse(await fs.readFile(file));
  assert.deepEqual(manifest.allowed_origins, [
    "chrome-extension://" + identity.extensionId + "/",
  ]);
  assert.ok(!(await fs.readdir(configHome)).includes("google-chrome"));
  const foreign = JSON.stringify({ ...manifest, path: "/foreign/host" });
  await fs.writeFile(file, foreign);
  await assert.rejects(adapter.install(options), /another installation/);
  assert.equal(await fs.readFile(file, "utf8"), foreign);
});
