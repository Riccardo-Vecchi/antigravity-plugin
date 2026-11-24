"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { BROWSERS } = require("../common/browser-setup.cjs");
const { spawn, execFile } = require("node:child_process"),
  { promisify } = require("node:util"),
  run = promisify(execFile);

async function findBundle(
  spec,
  {
    home = os.homedir(),
    applicationsDirs = ["/Applications", path.join(home, "Applications")],
  } = {},
) {
  if (!spec?.macos) return null;
  for (const dir of applicationsDirs) {
    const bundle = path.join(dir, spec.macos.app);
    const exe = path.join(bundle, ...spec.macos.bin.split("/"));
    try {
      await fs.access(exe, require("node:fs").constants.X_OK);
      if ((await fs.stat(exe)).isFile()) return { bundle, exe };
    } catch {}
  }
  return null;
}

async function detect({
  env = process.env,
  home = os.homedir(),
  applicationsDirs,
  plistPath = path.join(
    home,
    "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
  ),
  runCommand = run,
} = {}) {
  const found = [];
  for (const b of BROWSERS) {
    if (await findBundle(b, { home, applicationsDirs }))
      found.push({ id: b.id, label: b.label, bundleId: b.macos.bundleId });
  }
  let preferredId = "";
  try {
    const { stdout } = await runCommand(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", plistPath],
      { env, timeout: 1500 },
    );
    const data = JSON.parse(stdout);
    const handlers = Array.isArray(data?.LSHandlers) ? data.LSHandlers : [];
    const role = (h) => h?.LSHandlerRoleAll || h?.LSHandlerRoleViewer;
    const https =
      handlers.find((h) => String(h?.LSHandlerURLScheme || "").toLowerCase() === "https" && role(h)) ||
      handlers.find((h) => String(h?.LSHandlerURLScheme || "").toLowerCase() === "http" && role(h));
    preferredId = String(role(https) || "").toLowerCase();
  } catch {}
  const defaultBrowser =
    found.find((b) => b.bundleId === preferredId)?.id ||
    found[0]?.id ||
    "other";
  return {
    available: found.map(({ id, label }) => ({ id, label })),
    defaultBrowser,
  };
}

async function openDebug(
  id,
  { env = process.env, home = os.homedir(), applicationsDirs, spawnProcess = spawn } = {},
) {
  const spec = BROWSERS.find((b) => b.id === id);
  if (!spec) throw Error("Unsupported browser.");
  const installed = await findBundle(spec, { home, applicationsDirs });
  if (!installed) throw Error("Browser executable not found.");
  const clean = { ...env };
  delete clean.ELECTRON_RUN_AS_NODE;
  delete clean.NODE_OPTIONS;
  const child = spawnProcess("/usr/bin/open", ["-a", installed.bundle], {
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

module.exports = { detect, openDebug, findBundle };
