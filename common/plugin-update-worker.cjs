#!/usr/bin/env node
"use strict";
const path = require("node:path"),
  fs = require("node:fs/promises"),
  { execFile, spawn } = require("node:child_process"),
  { promisify } = require("node:util");
const run = promisify(execFile),
  core = require("./plugin-update-core.cjs"),
  defaultPaths = require("./platform-paths.cjs").getPaths();
async function main(
  id,
  {
    paths = defaultPaths,
    service = "antigravity-project-appearance.service",
    environment = process.env,
    healthAttempts = 60,
  } = {},
) {
  if (
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id || "")
  )
    throw Error("invalidUpdate");
  const directory = path.join(paths.configDir, "updates"),
    jobFile = path.join(directory, id + ".json"),
    result = path.join(directory, "result.json"),
    lock = path.join(directory, "install.lock");
  const job = JSON.parse(await core.plain(jobFile));
  if (
    job.schema !== 1 ||
    job.platform !== process.platform ||
    !core.newer(job.version, job.current)
  )
    throw Error("invalidUpdate");
  core.validatePackage(job.data, job);
  let handle,
    stopped = false;
  const progress = (phase) =>
    core.atomic(
      result,
      JSON.stringify({
        schema: 1,
        phase,
        version: job.version,
        at: Date.now(),
      }),
    );
  const env = { ...environment, ELECTRON_RUN_AS_NODE: "1" };
  async function lifecycle(action) {
    if (process.platform === "linux")
      return run("systemctl", ["--user", action, service], { timeout: 15000 });
    if (action === "stop")
      return run(
        process.execPath,
        [path.join(paths.installDir, "windows/launcher.cjs"), "--stop"],
        { env, timeout: 10000 },
      );
    const child = spawn(
      process.execPath,
      [path.join(paths.installDir, "windows/launcher.cjs"), "--watch"],
      { env, detached: true, stdio: "ignore", windowsHide: true },
    );
    await new Promise((r, j) => {
      child.once("spawn", r);
      child.once("error", j);
    });
    child.unref();
  }
  try {
    const stale = await core.plain(lock, 1000);
    if (stale) {
      const old = JSON.parse(stale);
      if (
        Number.isInteger(old.pid) &&
        old.pid > 0 &&
        Date.now() - old.at > 120000
      ) {
        try {
          process.kill(old.pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") await fs.rm(lock, { force: true });
        }
      }
    }
    handle = await fs.open(lock, "wx", 0o600);
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, at: Date.now() }),
    );
    const receipt = JSON.parse(
      await core.plain(
        path.join(paths.installDir, ".plugin-update-receipt.json"),
        200000,
      ),
    );
    if (receipt.version !== job.current) throw Error("localChanges");
    if (!(await core.pristine(paths.installDir))) throw Error("localChanges");
    await run(
      process.execPath,
      [path.join(paths.installDir, "common/prepare-reload.cjs")],
      { env, timeout: 12000 },
    );
    await progress("installing");
    await lifecycle("stop");
    stopped = true;
    await core.applyPackage(paths.installDir, job.data, job, async () => {
      try {
        await progress("restarting");
        const restartedAt = Date.now();
        await lifecycle("restart");
        for (let i = 0; i < healthAttempts; i++) {
          try {
            const health = JSON.parse(
              await core.plain(path.join(directory, "runtime.json"), 100000),
            );
            if (
              health.version === job.version &&
              health.ready &&
              health.at >= restartedAt &&
              Number.isInteger(health.pid) &&
              health.pid > 0
            ) {
              await run(
                process.execPath,
                [
                  path.join(paths.installDir, "common/prepare-reload.cjs"),
                  "--restore",
                ],
                { env, timeout: 12000 },
              );
              return;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 250));
        }
        throw Error("healthFailed");
      } catch (e) {
        await lifecycle("stop").catch(() => {});
        throw e;
      }
    });
    await progress("done");
  } catch (e) {
    if (stopped) await lifecycle("restart").catch(() => {});
    await run(
      process.execPath,
      [path.join(paths.installDir, "common/prepare-reload.cjs"), "--restore"],
      { env, timeout: 12000 },
    ).catch(() => {});
    await core.atomic(
      result,
      JSON.stringify({
        schema: 1,
        phase: "error",
        error: e.message === "localChanges" ? "localChanges" : "installFailed",
        version: job.version,
        at: Date.now(),
      }),
    );
    throw e;
  } finally {
    if (handle) {
      await handle.close();
      await fs.rm(lock, { force: true });
    }
    await fs.rm(jobFile, { force: true });
  }
}
if (require.main === module)
  main(process.argv[2]).catch(() => {
    console.error(
      "Plugin update failed. The previous files were restored when possible.",
    );
    process.exitCode = 1;
  });
module.exports = { main };
