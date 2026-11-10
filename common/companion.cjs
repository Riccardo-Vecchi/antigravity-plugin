"use strict";
const net = require("node:net"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const core = require("./companion-core.cjs"),
  { getPaths } = require("./platform-paths.cjs");
const { read, parse, atomic } = require("./computer-use.cjs"),
  { BROWSERS } = require("./browser-setup.cjs");
const official = require("./browser-engine.cjs");
const SERVER = "antigravity-plugin-browser",
  RPC = new Set([
    "initialize",
    "ping",
    "tools/list",
    "tools/call",
    "resources/list",
    "resources/templates/list",
    "prompts/list",
  ]);
const RELEASE_TOOL = {
  name: "release_browser",
  description:
    "Release control of the user's browser when your browser task is finished. Call this after the last browser operation, including on failure. Leaves all windows and tabs open. A later browser task may require browser approval again.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
function publicError(error) {
  if (["EACCES", "EPERM"].includes(error?.code)) return "permission";
  if (error?.code === "ENOSPC") return "space";
  if (/config|configuration/i.test(error?.message || "")) return "config";
  if (/belongs to another/.test(error?.message || "")) return "serverConflict";
  if (/engine|bundled/.test(error?.message || "")) return "engine";
  return "operation";
}
async function createCompanion({
  configDir = getPaths().configDir,
  home = os.homedir(),
  runtime = process.execPath,
  platform = process.platform,
  env = process.env,
  onChange = () => {},
  adapter = require(
    platform === "win32" ? "../windows/browser.cjs" : "../linux/browser.cjs",
  ),
  resolve = official.resolveEngine,
  probe = official.probeEndpoint,
  engineFactory = official.createEngine,
  profilePath = official.profileRoot,
  prepareEngine = require("./browser-engine-install.cjs").prepare,
  idleTimeout = 60000,
} = {}) {
  const loc = core.locations(configDir, platform),
    store = await core.createSettings(configDir),
    peers = new Set();
  const mcpFile = path.join(home, ".gemini/config/mcp_config.json"),
    script = path.join(__dirname, "browser-mcp.cjs");
  let detected = await adapter
    .detect()
    .catch(() => ({ available: [], defaultBrowser: null }));
  let generation = 0;
  let engine = null,
    verified = false,
    connecting = null,
    closed = false,
    mutation = Promise.resolve(),
    error = null,
    requested = false;
  let idleTimer = null,
    pendingRequests = 0,
    controlling = false;
  let component = null,
    lastResolve = 0,
    lastProbe = 0,
    endpoint = false;
  if (!store.settings.selectedBrowser)
    await store.configure({
      selectedBrowser:
        detected.defaultBrowser || detected.available[0]?.id || null,
    });
  function owned(e) {
    return (
      e?.command === runtime &&
      Array.isArray(e.args) &&
      e.args.length === 1 &&
      e.args[0] === script
    );
  }
  async function register(enabled) {
    for (let i = 0; ; i++)
      try {
        const previous = await read(mcpFile),
          data = parse(previous);
        data.mcpServers ||= {};
        if (
          typeof data.mcpServers !== "object" ||
          Array.isArray(data.mcpServers)
        )
          throw Error("Invalid MCP configuration.");
        if (data.mcpServers[SERVER] && !owned(data.mcpServers[SERVER]))
          throw Error("Browser server belongs to another installation.");
        if (enabled)
          data.mcpServers[SERVER] = {
            command: runtime,
            args: [script],
            env: { ELECTRON_RUN_AS_NODE: "1" },
          };
        else delete data.mcpServers[SERVER];
        const text = JSON.stringify(data, null, 2) + "\n";
        if (text !== previous) await atomic(mcpFile, text, previous);
        return;
      } catch (e) {
        if ((e.code !== "EEXIST" && e.message !== "configChanged") || i >= 4)
          throw e;
        await new Promise((r) => setTimeout(r, 100));
      }
  }
  function changed() {
    if (!closed) onChange();
  }
  function reset() {
    generation++;
    requested = false;
    clearTimeout(idleTimer);
    idleTimer = null;
    engine?.close();
    engine = null;
    controlling = false;
    verified = false;
    connecting = null;
    error = null;
    lastProbe = 0;
    endpoint = false;
  }
  function release() {
    clearTimeout(idleTimer);
    idleTimer = null;
    requested = false;
    const previous = engine;
    engine = null;
    controlling = false;
    // Retain the successful setup check, not an active debugging connection.
    previous?.close();
    changed();
  }
  function scheduleRelease() {
    if (!engine || pendingRequests || idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!pendingRequests) release();
    }, idleTimeout);
    idleTimer.unref?.();
  }
  function profile() {
    return profilePath(store.settings.selectedBrowser, { platform, home, env });
  }
  async function inspect(force = false) {
    if (force || Date.now() - lastResolve > 15000) {
      component = await resolve({ platform, home, env });
      lastResolve = Date.now();
    }
    if (
      store.settings.selectedBrowser &&
      (force || Date.now() - lastProbe > 2000)
    ) {
      endpoint = await probe(profile());
      lastProbe = Date.now();
      if (!endpoint) verified = false;
    }
  }
  async function rpc(method, params, { timeout } = {}) {
    if (!store.settings.browserEnabled) throw Error("Browser use is disabled.");
    if (!RPC.has(method)) throw Error("Unsupported browser request.");
    if (method === "tools/call" && params?.name === RELEASE_TOOL.name) {
      if (pendingRequests || connecting)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Browser operations are still running. Release after they finish.",
            },
          ],
        };
      release();
      return {
        content: [
          {
            type: "text",
            text: "Browser control released. Windows and tabs remain open.",
          },
        ],
      };
    }
    const revision = generation;
    await inspect();
    if (revision !== generation || !store.settings.browserEnabled)
      throw Error("Browser connection changed.");
    if (!component)
      throw Error(
        "The bundled browser engine is unavailable. Update Antigravity.",
      );
    if (!engine) {
      const current = engineFactory({
        entry: component.entry,
        profile: profile(),
        runtime,
        onClose() {
          if (engine !== current) return;
          engine = null;
          controlling = false;
          verified = false;
          changed();
        },
      });
      engine = current;
    }
    if (method === "tools/call") {
      controlling = true;
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    pendingRequests++;
    let result;
    try {
      result = await engine.request(method, params, timeout);
    } finally {
      pendingRequests--;
      scheduleRelease();
    }
    if (revision !== generation || !store.settings.browserEnabled)
      throw Error("Browser connection changed.");
    if (method === "tools/call" && !result?.isError) {
      verified = true;
      error = null;
      changed();
    }
    return method === "tools/list"
      ? { ...result, tools: [...(result.tools || []), RELEASE_TOOL] }
      : result;
  }
  function verify() {
    if (connecting || !store.settings.browserEnabled || !endpoint || !requested)
      return;
    const revision = generation;
    requested = false;
    connecting = (async () => {
      try {
        const r = await rpc(
          "tools/call",
          {
            name: "list_pages",
            arguments: {},
          },
          { timeout: 240000 },
        );
        if (r?.isError) throw Error("Browser permission required.");
      } catch {
        if (revision === generation) {
          verified = false;
          error = "browserPermission";
        }
      } finally {
        if (revision === generation) {
          connecting = null;
          changed();
        }
      }
    })();
  }
  async function snapshot() {
    await inspect();
    if (endpoint && !verified && !error) verify();
    let registered = false;
    try {
      registered = owned(parse(await read(mcpFile)).mcpServers?.[SERVER]);
    } catch {
      error = "config";
    }
    return {
      browser: {
        enabled: store.settings.browserEnabled,
        selectedBrowser: store.settings.selectedBrowser,
        available: detected.available,
        defaultBrowser: detected.defaultBrowser,
        registered,
        engineVersion: component?.version || null,
        engineAvailable: !!component,
        connected: !!(verified && endpoint),
        active: !!(verified && endpoint && controlling),
        connecting: !!connecting,
        debugging: !!endpoint,
        error,
        platform,
      },
    };
  }
  try {
    await register(store.settings.browserEnabled);
  } catch (e) {
    error = publicError(e);
  }
  await fs.mkdir(loc.directory, { recursive: true, mode: 0o700 });
  if (platform !== "win32") {
    const stat = await fs
      .lstat(loc.endpoint)
      .catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
    if (stat) {
      if (!stat.isSocket() || stat.isSymbolicLink())
        throw Error("Unsafe local bridge path.");
      const alive = await new Promise((r) => {
        const s = net.createConnection(loc.endpoint);
        s.once("connect", () => {
          s.destroy();
          r(true);
        });
        s.once("error", () => r(false));
      });
      if (alive) throw Error("A plugin bridge is already running.");
      await fs.unlink(loc.endpoint);
    }
  }
  const token = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(loc.token, token + "\n", { mode: 0o600 });
  await fs.chmod(loc.token, 0o600);
  const server = net.createServer((socket) => {
    let authenticated = false,
      p;
    const timer = setTimeout(() => socket.destroy(), 2000);
    p = core.peer(
      socket,
      async (m) => {
        try {
          let result;
          if (!authenticated) {
            if (
              m.action !== "hello" ||
              m.value?.role !== "mcp" ||
              typeof m.value.token !== "string" ||
              m.value.token.length !== token.length ||
              !crypto.timingSafeEqual(
                Buffer.from(m.value.token),
                Buffer.from(token),
              )
            )
              throw Error("Unauthorized local connection.");
            authenticated = true;
            clearTimeout(timer);
            result = true;
          } else if (m.action === "rpc" && typeof m.value?.method === "string")
            result = await rpc(m.value.method, m.value.params);
          else throw Error("Unsupported browser request.");
          if (m.id) p.send({ reply: m.id, result });
        } catch (e) {
          if (m.id)
            p.send({
              reply: m.id,
              error: authenticated
                ? e.message
                : "Unauthorized local connection.",
            });
          if (!authenticated) p.close();
        }
      },
      () => {
        clearTimeout(timer);
        peers.delete(p);
      },
    );
    peers.add(p);
  });
  await new Promise((r, j) => {
    server.once("error", j);
    server.listen(loc.endpoint, r);
  });
  if (platform !== "win32") await fs.chmod(loc.endpoint, 0o600);
  return {
    store,
    snapshot,
    rpc,
    async perform(action, value) {
      if (action === "status") return snapshot();
      if (
        ![
          "setupBrowser",
          "disableBrowser",
          "selectBrowser",
          "connectBrowser",
        ].includes(action)
      )
        throw Error("Unsupported browser action.");
      const job = mutation.then(async () => {
        if (action === "disableBrowser") {
          await store.configure({ browserEnabled: false });
          reset();
          await register(false);
        } else if (action === "setupBrowser") {
          await register(true);
          await store.configure({ browserEnabled: true });
          requested = true;
          error = null;
        } else if (action === "selectBrowser") {
          detected = await adapter.detect();
          if (
            !BROWSERS.some((b) => b.id === value) ||
            !detected.available.some((b) => b.id === value)
          )
            throw Error("Unsupported browser.");
          reset();
          await store.configure({ selectedBrowser: value });
        } else {
          if (!store.settings.browserEnabled)
            throw Error("Browser use is disabled.");
          await inspect(true);
          if (
            !component ||
            !require("./browser-engine-install.cjs").atLeast(
              component.version,
              require("./browser-engine-release.cjs").version,
            )
          ) {
            const prepared = await prepareEngine({ configDir });
            if (!prepared)
              throw Error("The official browser engine could not be prepared.");
            reset();
            component = prepared;
            lastResolve = Date.now();
            endpoint = await probe(profile());
            lastProbe = Date.now();
          }
          requested = true;
          error = null;
          if (!endpoint)
            await adapter.openDebug(store.settings.selectedBrowser, { env });
          else verify();
        }
        changed();
        return snapshot();
      });
      mutation = job.catch(() => {});
      return job;
    },
    async close() {
      closed = true;
      reset();
      for (const p of peers) p.close();
      await new Promise((r) => server.close(r));
      if (platform !== "win32") await fs.rm(loc.endpoint, { force: true });
    },
  };
}
module.exports = { createCompanion, SERVER, publicError };
