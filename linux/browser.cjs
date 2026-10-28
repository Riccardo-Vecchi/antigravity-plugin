"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { save, privateRead } = require("../common/companion-core.cjs");
const identity = require("../common/browser-identity.json");
const browsers = [
  ["Chrome", "google-chrome"],
  ["Chrome Beta", "google-chrome-beta"],
  ["Chromium", "chromium"],
  ["Chrome for Testing", "google-chrome-for-testing"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Edge", "microsoft-edge"],
  ["Vivaldi", "vivaldi"],
  ["Opera", "opera"],
];
async function install({
  home,
  configDir,
  runtime,
  hostScript,
  configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
}) {
  const base = configHome,
    directory = path.join(configDir, "companion");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const wrapper = path.join(directory, "browser-host.sh");
  const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  await fs.writeFile(
    wrapper,
    "#!/bin/sh\nunset NODE_OPTIONS\nexport ELECTRON_RUN_AS_NODE=1\nexec " +
      quote(runtime) +
      " " +
      quote(hostScript) +
      ' "$@"\n',
    { mode: 0o700 },
  );
  await fs.chmod(wrapper, 0o700);
  const installed = [];
  for (const [name, folder] of browsers) {
    const profile = path.join(base, folder);
    const exists = await fs
      .stat(profile)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists) continue;
    const file = path.join(
        profile,
        "NativeMessagingHosts",
        identity.host + ".json",
      ),
      previous = await privateRead(file);
    if (previous) {
      let old;
      try {
        old = JSON.parse(previous);
      } catch {
        throw Error("A browser host manifest needs manual review.");
      }
      if (old.name !== identity.host || old.path !== wrapper)
        throw Error(
          "A browser host manifest already belongs to another installation.",
        );
    }
    await save(file, {
      name: identity.host,
      description: "Antigravity Plugin browser bridge",
      path: wrapper,
      type: "stdio",
      allowed_origins: ["chrome-extension://" + identity.extensionId + "/"],
    });
    installed.push(name);
  }
  return installed;
}
module.exports = { install, browsers };
