"use strict";
// Per-user native messaging registration. No policy injection or administrator rights.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const { save } = require("../common/companion-core.cjs");
const identity = require("../common/browser-identity.json");
const keys = [
  "Google\\Chrome",
  "Chromium",
  "Microsoft\\Edge",
  "BraveSoftware\\Brave-Browser",
  "Vivaldi",
  "Opera Software",
];
async function install({ configDir, runtime, hostScript }) {
  const directory = path.join(configDir, "companion");
  await fs.mkdir(directory, { recursive: true });
  if ([runtime, hostScript].some((s) => /[\r\n%"!]/.test(s)))
    throw Error("Unsupported native host path.");
  const wrapper = path.join(directory, "browser-host.cmd"),
    manifest = path.join(directory, "browser-host.json");
  await fs.writeFile(
    wrapper,
    '@echo off\r\nset "NODE_OPTIONS="\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"' +
      runtime +
      '" "' +
      hostScript +
      '" %*\r\n',
  );
  await save(manifest, {
    name: identity.host,
    description: "Antigravity Plugin browser bridge",
    path: wrapper,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + identity.extensionId + "/"],
  });
  for (const key of keys) {
    const registry =
      "HKCU\\Software\\" + key + "\\NativeMessagingHosts\\" + identity.host;
    const old = await run("reg.exe", ["query", registry, "/ve"], {
      windowsHide: true,
    })
      .then((r) => r.stdout)
      .catch(() => null);
    if (
      old &&
      old
        .match(/REG_SZ\s+([^\r\n]+)/)?.[1]
        .trim()
        .toLowerCase() !== manifest.toLowerCase()
    )
      throw Error("Native host registration belongs to another installation.");
    await run(
      "reg.exe",
      ["add", registry, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"],
      { windowsHide: true },
    );
  }
  return ["Chrome", "Edge", "Brave", "Vivaldi", "Opera"];
}
module.exports = { install };
