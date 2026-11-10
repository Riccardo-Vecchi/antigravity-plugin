"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path");
const { BROWSERS } = require("../common/browser-setup.cjs");
const { spawn, execFile } = require("node:child_process"),
  { promisify } = require("node:util");
async function detect({ env = process.env } = {}) {
  const found = [];
  for (const b of BROWSERS) {
    let executable;
    for (const name of b.linux) {
      for (const folder of (env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)) {
        const file = path.join(folder, name);
        try {
          await fs.access(file, require("node:fs").constants.X_OK);
          if ((await fs.stat(file)).isFile()) {
            executable = file;
            break;
          }
        } catch {}
      }
      if (executable) break;
    }
    if (executable) found.push({ id: b.id, label: b.label });
  }
  let preferred = "";
  try {
    preferred = (
      await promisify(execFile)(
        "xdg-settings",
        ["get", "default-web-browser"],
        { env, timeout: 1500 },
      )
    ).stdout.toLowerCase();
  } catch {}
  const defaultBrowser =
    found.find((b) => preferred.includes(b.id))?.id || found[0]?.id || "other";
  return {
    available: found.map(({ id, label }) => ({ id, label })),
    defaultBrowser,
  };
}
async function openDebug(id, { env = process.env } = {}) {
  const spec = BROWSERS.find((b) => b.id === id);
  if (!spec) throw Error("Unsupported browser.");
  for (const name of spec.linux)
    for (const folder of (env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)) {
      const executable = path.join(folder, name);
      try {
        await fs.access(executable, require("node:fs").constants.X_OK);
      } catch {
        continue;
      }
      const clean = { ...env };
      delete clean.ELECTRON_RUN_AS_NODE;
      delete clean.NODE_OPTIONS;
      const child = spawn(executable, [spec.debugUrl], {
        env: clean,
        detached: true,
        stdio: "ignore",
      });
      await new Promise((r, j) => {
        child.once("spawn", r);
        child.once("error", j);
      });
      child.unref();
      return true;
    }
  throw Error("Browser executable not found.");
}
module.exports = { detect, openDebug };

// Historical profile roots are retained solely for owned-path migration.
module.exports.browsers = [
  ["Chrome", "google-chrome"],
  ["Chrome Beta", "google-chrome-beta"],
  ["Chromium", "chromium"],
  ["Chrome for Testing", "google-chrome-for-testing"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Edge", "microsoft-edge"],
  ["Vivaldi", "vivaldi"],
  ["Opera", "opera"],
];
