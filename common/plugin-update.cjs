"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { execFile, spawn } = require("node:child_process"),
  { promisify } = require("node:util");
const core = require("./plugin-update-core.cjs"),
  { getPaths } = require("./platform-paths.cjs");
const run = promisify(execFile);
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
function createUpdater({
  paths = getPaths(),
  current = require("./versions.cjs").suite,
  platform = process.platform,
  arch = os.arch(),
  fetcher,
  canApply = async () => true,
  dispatch,
  managed = path.resolve(__dirname, "..") === path.resolve(paths.installDir),
} = {}) {
  const directory = path.join(paths.configDir, "updates"),
    preferences = path.join(directory, "preferences.json");
  let prefs = { schema: 1, automatic: true, lastChecked: 0 },
    candidate = null,
    checking = null,
    installing = false,
    error = null,
    timer;
  let writes = Promise.resolve();
  async function persist() {
    writes = writes.then(() => core.atomic(preferences, JSON.stringify(prefs)));
    await writes;
  }
  async function load() {
    try {
      const raw = JSON.parse(await core.plain(preferences, 100000));
      if (raw.schema === 1) {
        prefs = {
          schema: 1,
          automatic: raw.automatic !== false,
          lastChecked: Number.isFinite(raw.lastChecked) ? raw.lastChecked : 0,
          lastAttempt:
            typeof raw.lastAttempt === "string" ? raw.lastAttempt : null,
          latest: typeof raw.latest === "string" ? raw.latest : null,
        };
      }
    } catch {}
  }
  async function status() {
    let result = null;
    try {
      result = JSON.parse(
        await core.plain(path.join(directory, "result.json"), 100000),
      );
    } catch {}
    const preview = core.version(current).preview;
    const modified =
      managed && !preview ? !(await core.pristine(paths.installDir)) : false;
    return {
      current,
      automatic: prefs.automatic,
      lastChecked: prefs.lastChecked,
      latest: candidate?.version || prefs.latest || null,
      available:
        candidate?.available ??
        !!(prefs.latest && core.newer(prefs.latest, current)),
      checking: !!checking,
      installing:
        installing ||
        (!!result &&
          ["preparing", "installing", "restarting"].includes(result.phase) &&
          Date.now() - result.at < 120000),
      paused: preview
        ? "preview"
        : !managed
          ? "source"
          : modified
            ? "localChanges"
            : null,
      error,
      result:
        result?.phase === "done" && result.version === current
          ? result
          : result?.phase === "error"
            ? result
            : null,
      supported: ["linux", "win32"].includes(platform) && arch === "x64",
    };
  }
  async function check() {
    if (checking) return checking;
    checking = (async () => {
      error = null;
      try {
        if (arch !== "x64") throw Error("unsupported");
        candidate = await core.latest(current, platform, fetcher);
        prefs.lastChecked = Date.now();
        prefs.latest = candidate.version;
        await persist();
      } catch (e) {
        error = ["invalidUpdate", "rateLimited", "unsupported"].includes(
          e.message,
        )
          ? e.message
          : "network";
        prefs.lastChecked = Date.now();
        await persist();
      } finally {
        checking = null;
      }
      return status();
    })();
    return checking;
  }
  async function launch(id) {
    if (dispatch) return dispatch(id);
    const worker = path.join(__dirname, "plugin-update-worker.cjs");
    if (platform === "linux") {
      await run(
        "systemd-run",
        [
          "--user",
          "--unit=antigravity-plugin-update-" + id,
          "--collect",
          "--quiet",
          "--property=Type=exec",
          process.execPath,
          worker,
          id,
        ],
        { timeout: 10000 },
      );
    } else {
      const child = spawn(process.execPath, [worker, id], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    }
  }
  async function install(manual = false) {
    if (installing) return status();
    const before = await status();
    if (
      !candidate?.available ||
      before.paused ||
      !before.supported ||
      before.checking
    )
      return before;
    if (!(await canApply(manual))) {
      if (manual) error = "busy";
      return status();
    }
    installing = true;
    error = null;
    const id = crypto.randomUUID();
    try {
      prefs.lastAttempt = candidate.version;
      await persist();
      const data = await core.download(candidate, fetcher);
      const again = await status();
      if (again.paused || !(await canApply(manual))) throw Error("busy");
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await core.atomic(
        path.join(directory, id + ".json"),
        JSON.stringify({
          schema: 1,
          current,
          version: candidate.version,
          platform,
          data,
        }),
      );
      prefs.lastAttempt = candidate.version;
      await persist();
      await core.atomic(
        path.join(directory, "result.json"),
        JSON.stringify({
          schema: 1,
          phase: "preparing",
          version: candidate.version,
          at: Date.now(),
        }),
      );
      await launch(id);
    } catch (e) {
      await fs
        .rm(path.join(directory, id + ".json"), { force: true })
        .catch(() => {});
      installing = false;
      if (e.message === "busy") {
        prefs.lastAttempt = null;
        await persist();
      }
      error =
        e.message === "busy" && !manual
          ? null
          : ["invalidUpdate", "busy", "localChanges"].includes(e.message)
            ? e.message
            : "installFailed";
      if (error)
        await core.atomic(
          path.join(directory, "result.json"),
          JSON.stringify({
            schema: 1,
            phase: "error",
            version: candidate.version,
            error,
            at: Date.now(),
          }),
        );
    }
    return status();
  }
  async function tick() {
    if (!prefs.automatic) return;
    const before = await status();
    if (before.installing) return;
    if (Date.now() - prefs.lastChecked >= CHECK_INTERVAL) await check();
    if (
      candidate?.available &&
      prefs.lastAttempt !== candidate.version &&
      !before.paused
    )
      await install(false);
  }
  return {
    status,
    async initialize() {
      await load();
      await core.atomic(
        path.join(directory, "runtime.json"),
        JSON.stringify({
          schema: 1,
          version: current,
          pid: process.pid,
          at: Date.now(),
          ready: false,
        }),
      );
    },
    async ready() {
      await core.atomic(
        path.join(directory, "runtime.json"),
        JSON.stringify({
          schema: 1,
          version: current,
          pid: process.pid,
          at: Date.now(),
          ready: true,
        }),
      );
    },
    start() {
      timer = setTimeout(() => {
        tick().catch(() => {});
        timer = setInterval(() => tick().catch(() => {}), 60000);
        timer.unref();
      }, 30000);
      timer.unref();
    },
    async perform(action, value) {
      if (action === "status") return status();
      if (action === "check") return check();
      if (action === "install") {
        if (!candidate) await check();
        return install(true);
      }
      if (action === "automatic") {
        prefs.automatic = value;
        await persist();
        return status();
      }
      throw Error("invalidAction");
    },
    close() {
      clearTimeout(timer);
      clearInterval(timer);
    },
    check,
    install,
    tick,
  };
}
module.exports = { createUpdater };
