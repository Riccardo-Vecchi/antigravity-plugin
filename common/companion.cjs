"use strict";
const net = require("node:net");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("./companion-core.cjs");
const { getPaths } = require("./platform-paths.cjs");
const { read, parse, atomic } = require("./computer-use.cjs");
const { tools, validate } = require("./browser-tools.cjs");
const SERVER = "antigravity-plugin-browser";
function publicError(error) {
  if (["EACCES", "EPERM"].includes(error?.code)) return "permission";
  if (error?.code === "ENOSPC") return "space";
  if (
    ["invalidConfig", "unsafeConfig", "Invalid MCP configuration."].includes(
      error?.message,
    )
  )
    return "config";
  if (/server belongs to another/.test(error?.message || ""))
    return "serverConflict";
  if (/manifest|registration belongs/.test(error?.message || ""))
    return "hostConflict";
  if (error?.code === "EEXIST" || error?.message === "configChanged")
    return "configChanged";
  return "operation";
}
async function createCompanion({
  configDir = getPaths().configDir,
  home = os.homedir(),
  runtime = process.execPath,
  platform = process.platform,
  extensionDir = getPaths({platform,home}).extensionDir,
  onChange = () => {},
} = {}) {
  await require("./browser-extension.cjs").deploy(extensionDir);
  const loc = core.locations(configDir, platform),
    store = await core.createSettings(configDir),
    connections = new Map(),
    peers = new Set();
  const adapter=require(platform === "win32" ? "../windows/browser.cjs" : "../linux/browser.cjs");
  let discovery=adapter.detect().catch(()=>({available:[],defaultBrowser:"other"}));
  let mutations = Promise.resolve(),
    closed = false;
  const mcpFile = path.join(home, ".gemini/config/mcp_config.json"),
    script = path.join(__dirname, "browser-mcp.cjs");
  function entry() {
    return {
      command: runtime,
      args: [script],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      enabledTools: tools.map((t) => t.name),
    };
  }
  function owned(e) {
    return (
      e?.command === runtime &&
      Array.isArray(e.args) &&
      e.args.length === 1 &&
      e.args[0] === script
    );
  }
  async function register(enabled) {
    // Reuse the desktop integration's lock, preserving unrelated MCP servers.
    for (let attempt = 0; ; attempt++) {
      try {
        const previous = await read(mcpFile),
          data = parse(previous);
        if (
          data.mcpServers !== undefined &&
          (!data.mcpServers ||
            typeof data.mcpServers !== "object" ||
            Array.isArray(data.mcpServers))
        )
          throw Error("Invalid MCP configuration.");
        data.mcpServers ||= {};
        if (data.mcpServers[SERVER] && !owned(data.mcpServers[SERVER]))
          throw Error("Browser server belongs to another installation.");
        if (enabled) data.mcpServers[SERVER] = entry();
        else delete data.mcpServers[SERVER];
        await atomic(mcpFile, JSON.stringify(data, null, 2) + "\n", previous);
        return;
      } catch (e) {
        if (
          (!["EEXIST"].includes(e.code) && e.message !== "configChanged") ||
          attempt >= 4
        )
          throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  async function snapshot() {
    const data = parse(await read(mcpFile));
    return {
      browser: {
        enabled: store.settings.browserEnabled,
        registered: owned(data.mcpServers?.[SERVER]),
        extensionPath: extensionDir,
        ...await discovery,
        extensionId: require("./browser-identity.json").extensionId,
        connections: [...connections.entries()].map(([id, c]) => ({
          id,
          label: c.label,
          tabs: c.tabs.length,
          connectedAt: c.connectedAt,
          scope:c.scope||null,
        })),
      },
    };
  }
  function changed() {
    if (!closed) onChange();
  }
  async function browserCall(name, args) {
    validate(name, args);
    if (!store.settings.browserEnabled)
      throw Error("Browser access is disabled.");
    if (name === "browser_list_connections")
      return [...connections.entries()].map(([id, c]) => ({
        connection: id,
        label: c.label,
        tabs: c.tabs.length,
        scope:c.scope||null,
      }));
    const c = connections.get(args.connection);
    if (!c) throw Error("Browser disconnected. Reconnect the extension.");
    if (name === "browser_list_tabs") return c.tabs;
    if (!c.tabs.some((t) => t.id === args.tab))
      throw Error("Share this tab using the extension first.");
    const result = await c.peer.request("execute", { tool: name, args }, 20000);
    return result;
  }
  await fs.mkdir(loc.directory, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString("hex");
  if (platform !== "win32") {
    const stat = await fs
      .lstat(loc.endpoint)
      .catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
    if (stat) {
      if (!stat.isSocket() || stat.isSymbolicLink())
        throw Error("Unsafe local bridge path.");
      const alive = await new Promise((resolve) => {
        const s = net.createConnection(loc.endpoint);
        s.once("connect", () => {
          s.destroy();
          resolve(true);
        });
        s.once("error", () => resolve(false));
      });
      if (alive) throw Error("A plugin bridge is already running.");
      await fs.unlink(loc.endpoint);
    }
  }
  await fs.writeFile(loc.token, token + "\n", { mode: 0o600 });
  await fs.chmod(loc.token, 0o600);
  const server = net.createServer((socket) => {
    let role = null,
      connectionId = null,
      p;
    const authTimeout = setTimeout(() => socket.destroy(), 2000);
    p = core.peer(
      socket,
      async (m) => {
        let result;
        try {
          if (!role) {
            if (
              m.action !== "hello" ||
              !["browser", "mcp"].includes(m.value?.role) ||
              typeof m.value.token !== "string" ||
              m.value.token.length !== token.length ||
              !crypto.timingSafeEqual(
                Buffer.from(m.value.token),
                Buffer.from(token),
              )
            )
              throw Error("Unauthorized local connection.");
            role = m.value.role;
            clearTimeout(authTimeout);
            result = true;
          } else if (role === "browser") {
            if (!store.settings.browserEnabled)
              throw Error("Browser access disabled.");
            if (m.action === "announce") {
              if (
                typeof m.value?.id !== "string" ||
                !/^[\da-f-]{36}$/.test(m.value.id) ||
                typeof m.value.label !== "string" ||
                m.value.label.length > 60 ||
                /[\x00-\x1f]/.test(m.value.label)
              )
                throw Error("Invalid browser profile.");
              if (connectionId && connectionId !== m.value.id)
                throw Error("Browser identity changed.");
              connectionId = m.value.id;
              const old = connections.get(connectionId);
              if (old && old.peer !== p) old.peer.close();
              connections.set(connectionId, {
                peer: p,
                label: m.value.label,
                connectedAt: Date.now(),
                tabs: [],
              });
              result = true;
              changed();
            } else if (m.action === "rename") {
              const c = connections.get(connectionId);
              if (
                !c ||
                c.peer !== p ||
                typeof m.value !== "string" ||
                !m.value.trim() ||
                m.value.length > 60 ||
                /[\x00-\x1f]/.test(m.value)
              )
                throw Error("Invalid profile name.");
              c.label = m.value;
              changed();
              result = true;
            } else if (m.action === "tabs") {
              const c = connections.get(connectionId);
              if (
                !c ||
                c.peer !== p ||
                !Array.isArray(m.value) ||
                m.value.length > 2000
              )
                throw Error("Invalid shared tabs.");
              c.scope=["profile","tabs"].includes(m.scope)?m.scope:null;
              c.tabs = m.value.map((t) => {
                const url = new URL(t.url);
                if (
                  !Number.isInteger(t.id) ||
                  t.id < 1 ||
                  !["http:", "https:"].includes(url.protocol) ||
                  url.username ||
                  url.password
                )
                  throw Error("Invalid shared tab.");
                return {
                  id: t.id,
                  title: String(t.title || "").slice(0, 200),
                  url: url.href.slice(0, 4096),
                };
              });
              changed();
              result = true;
            } else throw Error("Unsupported browser event.");
          } else if (role === "mcp" && m.action === "call") {
            result = await browserCall(m.value?.name, m.value?.args);
          } else throw Error("Unsupported local request.");
          if (m.id) p.send({ reply: m.id, result });
        } catch (e) {
          if (m.id)
            p.send({ reply: m.id, error: role ? e.message : "Unauthorized." });
          if (!role || (role === "browser" && !store.settings.browserEnabled))
            socket.destroy();
        }
      },
      () => {
        clearTimeout(authTimeout);
        peers.delete(p);
        if (connectionId && connections.get(connectionId)?.peer === p)
          connections.delete(connectionId);
        changed();
      },
    );
    peers.add(p);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(loc.endpoint, resolve);
  });
  if (platform !== "win32") await fs.chmod(loc.endpoint, 0o600);
  return {
    store,
    snapshot,
    browserCall,
    async perform(action, value) {
      if (action === "status") return snapshot();
      if(action === "openExtensions"){
        if(!store.settings.browserEnabled)throw Error("Browser access is disabled.");
        await adapter.openExtensions(value);return snapshot();
      }
      const job = mutations.then(async () => {
        if (action === "setupBrowser") {
          const adapter = require(
            platform === "win32"
              ? "../windows/browser.cjs"
              : "../linux/browser.cjs",
          );
          const installed = await adapter.install({
            home,
            configDir,
            runtime,
            hostScript: path.join(__dirname, "browser-host.cjs"),
            availableBrowsers:(await discovery).available,
          });
          discovery=adapter.detect().catch(()=>({available:[],defaultBrowser:"other"}));
          await register(true);
          await store.configure({ browserEnabled: true });
          return { ...(await snapshot()), installedBrowsers: installed };
        }
        if (action === "disableBrowser") {
          await store.configure({ browserEnabled: false });
          for (const c of connections.values()) {
            try {
              c.peer.send({ action: "revoke" });
            } catch {}
            c.peer.close();
          }
          connections.clear();
          await register(false);
        } else if (action === "disconnectProfile") {
          const c = connections.get(value);
          if (c) {
            try {
              c.peer.send({ action: "revoke" });
            } catch {}
            c.peer.close();
            connections.delete(value);
          }
        } else
          throw Error("Unsupported companion action.");
        changed();
        return snapshot();
      });
      mutations = job.catch(() => {});
      return job;
    },
    async close() {
      closed = true;
      for (const p of peers) p.close();
      await new Promise((r) => server.close(r));
      if (platform !== "win32") await fs.rm(loc.endpoint, { force: true });
    },
  };
}
module.exports = { createCompanion, SERVER, publicError };
