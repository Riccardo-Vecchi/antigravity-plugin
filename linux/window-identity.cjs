"use strict";
// Tray-created Wayland windows have an app ID, but no launcher startup token.
// Give that ID a hidden desktop entry even when the user's launcher has a
// generic filename (for example alacarte-made.desktop). Never replace a foreign entry.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {parseDesktop, IDENTITY_MARKER: MARKER} = require("./installation.cjs");

async function sync({desktopFile, icon}) {
  const file = path.join(path.dirname(desktopFile), "antigravity.desktop");
  if (file === desktopFile) return {changed: false};
  const source = parseDesktop(await fs.readFile(desktopFile, "utf8"));
  if (!source || !source.executable.toLowerCase().endsWith(".appimage"))
    throw Error("Invalid Antigravity desktop identity.");
  const content = ["[Desktop Entry]", "Type=Application", "Name=Antigravity",
    "Exec=" + source.Exec, "Icon=" + icon, "NoDisplay=true",
    "StartupWMClass=antigravity", MARKER, ""].join("\n");
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  try {
    const stat = await fs.lstat(file).catch(e => {if (e.code !== "ENOENT") throw e;});
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) return {changed: false, conflict: true};
    const previous = stat ? await fs.readFile(file, "utf8") : null;
    if (previous !== null && !previous.split(/\r?\n/).includes(MARKER))
      return {changed: false, conflict: true};
    if (previous === content) return {changed: false};
    await fs.writeFile(temporary, content, {flag: "wx", mode: 0o644});
    if (previous === null) {
      // An unrelated entry created concurrently must win.
      try {await fs.link(temporary, file);} catch (e) {if (e.code === "EEXIST") return {changed: false, conflict: true};throw e;}
    } else {
      const current = await fs.lstat(file);
      if (current.ino !== stat.ino || current.isSymbolicLink() || await fs.readFile(file, "utf8") !== previous)
        return {changed: false, conflict: true};
      await fs.rename(temporary, file);
    }
    return {changed: true};
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

async function remove(desktopFile) {
  const file = path.join(path.dirname(desktopFile), "antigravity.desktop");
  if (file === desktopFile) return;
  const stat = await fs.lstat(file).catch(e => {if (e.code !== "ENOENT") throw e;});
  if (!stat?.isFile() || stat.isSymbolicLink()) return;
  const data = await fs.readFile(file, "utf8");
  if (data.split(/\r?\n/).includes(MARKER)) await fs.unlink(file);
}
module.exports = {sync, remove};
