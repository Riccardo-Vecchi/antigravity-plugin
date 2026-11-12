"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path");
const { execFile } = require("node:child_process"),
  { promisify } = require("node:util"),
  run = promisify(execFile);
const { BROWSERS } = require("../common/browser-setup.cjs");
async function executableFor(spec, env) {
  for (const root of [
    env.LOCALAPPDATA,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ].filter(Boolean))
    for (const file of spec.windows) {
      const exe = path.join(root, ...file.split("/"));
      try {
        if ((await fs.stat(exe)).isFile()) return exe;
      } catch {}
    }
  return null;
}
async function detect({ env = process.env } = {}) {
  const available = [];
  for (const b of BROWSERS)
    if (await executableFor(b, env))
      available.push({ id: b.id, label: b.label });
  let preferred = "";
  try {
    preferred = (
      await run(
        "reg.exe",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
          "/v",
          "ProgId",
        ],
        { env, windowsHide: true, timeout: 1500 },
      )
    ).stdout.toLowerCase();
  } catch {}
  return {
    available,
    defaultBrowser:
      available.find((b) => preferred.includes(b.id))?.id ||
      available[0]?.id ||
      "other",
  };
}
module.exports = { detect };
