"use strict";
// Private local IPC. Never opens a TCP port or stores tool arguments/results.
const net = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { getPaths } = require("./platform-paths.cjs");
const MAX_FRAME = 8 * 1024 * 1024;
function locations(
  configDir = getPaths().configDir,
  platform = process.platform,
) {
  const directory = path.join(configDir, "companion");
  return {
    directory,
    token: path.join(directory, "ipc-token"),
    settings: path.join(directory, "settings.json"),
    endpoint:
      platform === "win32"
        ? "\\\\.\\pipe\\antigravity-plugin-" +
          crypto
            .createHash("sha256")
            .update(configDir)
            .digest("hex")
            .slice(0, 24)
        : path.join(directory, "bridge.sock"),
  };
}
async function privateRead(file, fallback = "") {
  try {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > MAX_FRAME)
      throw Error("Unsafe companion file.");
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function save(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, JSON.stringify(value) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
function peer(socket, onMessage, onClose = () => {}) {
  let buffer = Buffer.alloc(0),
    closed = false;
  const pending = new Map();
  function close() {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Local connection closed."));
    }
    pending.clear();
    onClose();
  }
  function send(message) {
    const text = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(text) > MAX_FRAME || socket.destroyed)
      throw Error("Local message unavailable.");
    socket.write(text);
  }
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_FRAME) return socket.destroy();
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      const line = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      try {
        const m = JSON.parse(line.toString());
        if (m.reply && pending.has(m.reply)) {
          const p = pending.get(m.reply);
          pending.delete(m.reply);
          clearTimeout(p.timer);
          m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
        } else Promise.resolve(onMessage(m)).catch(() => socket.destroy());
      } catch {
        socket.destroy();
        return;
      }
    }
  });
  socket.on("error", () => {});
  socket.on("close", close);
  return {
    send,
    socket,
    close: () => socket.destroy(),
    finish: () => socket.end(),
    request(action, value, timeout = 20000) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("Local request timed out."));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ id, action, value });
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        }
      });
    },
  };
}
async function connect(role, onMessage = () => {}, onClose, configDir) {
  const loc = locations(configDir),
    token = (await privateRead(loc.token)).trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Open Antigravity Plugin first.");
  const socket = net.createConnection(loc.endpoint);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.destroy();
      reject(Error("Local connection unavailable."));
    }, 1500);
    socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
    socket.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
  const p = peer(socket, onMessage, onClose);
  await p.request("hello", { role, token }, 2000);
  return p;
}
// Keep only browser preferences. Remove data from the unpublished Activity preview.
async function createSettings(configDir) {
  const loc = locations(configDir);
  let data = {};
  try { data = JSON.parse(await privateRead(loc.settings, "{}")); } catch {}
  let enabled = data?.browserEnabled === true;
  if (data && ("recordActivity" in Object(data) || "retentionDays" in Object(data)))
    await save(loc.settings, {browserEnabled: enabled});
  await fs.rm(path.join(loc.directory, "activity.json"), {force: true});
  return {
    get settings() { return {browserEnabled: enabled}; },
    async configure(next) {
      if (typeof next.browserEnabled !== "boolean") throw Error("Invalid browser preference.");
      await save(loc.settings, {browserEnabled: next.browserEnabled});
      enabled = next.browserEnabled;
    },
  };
}
module.exports = {locations, privateRead, save, peer, connect, createSettings, MAX_FRAME};
