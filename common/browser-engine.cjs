"use strict";
// Use Antigravity's bundled, Google-maintained browser implementation.
// This module discovers it and transports JSON-RPC; it does not implement browser tools.
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { getPaths } = require("./platform-paths.cjs");
const { BROWSERS } = require("./browser-setup.cjs");
const MAX = 8 * 1024 * 1024;
async function resolveEngine({
  platform = process.platform,
  home,
  env = process.env,
  resources,
  proc = "/proc",
} = {}) {
  const paths = getPaths({ platform, home, env }),
    candidates = [];
  const managed = await require("./browser-engine-install.cjs").installed(
    paths.configDir,
  );
  if (resources) candidates.push(resources);
  if (platform === "win32") {
    try {
      const data = JSON.parse(
        await fs.readFile(
          path.join(paths.configDir, "installation.json"),
          "utf8",
        ),
      );
      if (
        data.version === 1 &&
        path.win32.basename(data.appExe || "").toLowerCase() ===
          "antigravity.exe"
      )
        candidates.push(
          path.win32.join(path.win32.dirname(data.appExe), "resources"),
        );
    } catch {}
  } else {
    for (const pid of await fs.readdir(proc).catch(() => [])) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const exe = await fs.readlink(path.join(proc, pid, "exe"));
        if (path.basename(exe) === "antigravity")
          candidates.push(path.join(path.dirname(exe), "resources"));
      } catch {}
    }
  }
  const p = platform === "win32" ? path.win32 : path;
  candidates.push(p.join(p.dirname(paths.defaultExecutable), "resources"));
  for (const root of new Set(candidates)) {
    const base = p.join(
      root,
      "app.asar.unpacked",
      "node_modules",
      "chrome-devtools-mcp",
    );
    try {
      const info = await fs.stat(p.join(base, "package.json"));
      if (!info.isFile() || info.size > 65536) continue;
      const meta = JSON.parse(
        await fs.readFile(p.join(base, "package.json"), "utf8"),
      );
      const entry = p.join(
        base,
        "build",
        "src",
        "bin",
        "chrome-devtools-mcp.js",
      );
      if (
        meta.name === "chrome-devtools-mcp" &&
        typeof meta.version === "string" &&
        (await fs.stat(entry)).isFile()
      )
        return managed &&
          !require("./browser-engine-install.cjs").atLeast(
            meta.version,
            managed.version,
          )
          ? managed
          : { entry, version: meta.version };
    } catch {}
  }
  return managed;
}
function profileRoot(
  id,
  {
    platform = process.platform,
    home = require("node:os").homedir(),
    env = process.env,
  } = {},
) {
  const spec = BROWSERS.find((b) => b.id === id);
  if (!spec) throw Error("Unsupported browser.");
  const p = platform === "win32" ? path.win32 : path;
  const base =
    platform === "win32"
      ? id === "opera"
        ? env.APPDATA
        : env.LOCALAPPDATA
      : env.XDG_CONFIG_HOME || p.join(home, ".config");
  if (!base) throw Error("Browser profile location unavailable.");
  return p.join(base, ...spec.profiles[platform].split("/"));
}
// Chrome's permission-based discovery deliberately omits /json/version.
// Check only that the validated local discovery socket is listening. The
// official MCP connection and list_pages verify the actual browser afterwards.
function connectPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    }
    socket.setTimeout(800, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
}
async function probeEndpoint(root, { connectPort: check = connectPort } = {}) {
  try {
    const file = path.join(root, "DevToolsActivePort"),
      stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048)
      return false;
    const [raw, endpoint] = (await fs.readFile(file, "utf8"))
      .trim()
      .split(/\r?\n/);
    if (
      !/^\d{1,5}$/.test(raw) ||
      Number(raw) < 1 ||
      Number(raw) > 65535 ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint || "")
    )
      return false;
    return await check(Number(raw));
  } catch {
    return false;
  }
}
function createEngine({
  entry,
  profile,
  runtime = process.execPath,
  spawnProcess = spawn,
  onClose = () => {},
}) {
  let child,
    starting,
    initialized,
    closed = false,
    next = 0,
    buffer = Buffer.alloc(0);
  const pending = new Map();
  function rejectAll(error) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  }
  function stop() {
    if (closed) return;
    closed = true;
    rejectAll(Error("Browser connection closed."));
    child?.stdin.destroy();
    child?.kill();
    onClose();
  }
  function send(method, params, timeout = 45000) {
    return new Promise((resolve, reject) => {
      if (closed || !child) {
        reject(Error("Browser connection closed."));
        return;
      }
      if (pending.size >= 32) {
        reject(Error("Too many browser requests."));
        return;
      }
      const id = ++next,
        line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      if (Buffer.byteLength(line) > MAX) {
        reject(Error("Browser request too large."));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Error(
            "Browser request timed out. Check the browser permission prompt.",
          ),
        );
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(line, (e) => {
        if (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        }
      });
    });
  }
  async function start() {
    if (closed) throw Error("Browser connection closed.");
    if (initialized) return initialized;
    starting ||= (async () => {
      const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
        CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: "1",
      };
      delete env.NODE_OPTIONS;
      delete env.NODE_INSPECT_RESUME_ON_START;
      child = spawnProcess(
        runtime,
        [
          entry,
          "--autoConnect",
          "--userDataDir=" + profile,
          "--no-usage-statistics",
          "--no-performance-crux",
        ],
        { env, stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
      );
      child.on("error", () => stop());
      child.on("exit", () => stop());
      child.stdin.on("error", () => stop());
      child.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX) {
          stop();
          return;
        }
        for (;;) {
          const end = buffer.indexOf(10);
          if (end < 0) break;
          const line = buffer.subarray(0, end);
          buffer = buffer.subarray(end + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            stop();
            return;
          }
          const p = pending.get(message.id);
          if (!p) continue;
          pending.delete(message.id);
          clearTimeout(p.timer);
          message.error
            ? p.reject(Error(message.error.message || "Browser tool failed."))
            : p.resolve(message.result);
        }
      });
      initialized = await send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "antigravity-plugin",
          version: require("./versions.cjs").suite,
        },
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );
      return initialized;
    })();
    return starting;
  }
  return {
    close: stop,
    async request(method, params, timeout) {
      const init = await start();
      return method === "initialize" ? init : send(method, params, timeout);
    },
  };
}
module.exports = { resolveEngine, profileRoot, probeEndpoint, createEngine };
