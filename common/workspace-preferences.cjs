"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path");
function createStore(file) {
  let state = { version: 1, sidebarMode: null, libraryEnabled: true };
  async function save(patch) {
    const next = { ...state, ...patch };
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + "." + process.pid + ".tmp";
    try {
      await fs.writeFile(tmp, JSON.stringify(next) + "\n", { mode: 0o600 });
      await fs.rename(tmp, file);
      state = next;
    } finally {
      await fs.rm(tmp, { force: true });
    }
    return { ...state };
  }
  return {
    current: () => ({ ...state }),
    async load() {
      try {
        const s = await fs.stat(file);
        if (s.size > 4096) throw Error("Invalid workspace preferences.");
        const d = JSON.parse(await fs.readFile(file, "utf8"));
        if (
          d.version !== 1 ||
          !["open", "compact", "hover", null].includes(d.sidebarMode)
        )
          throw Error("Invalid workspace preferences.");
        if (d.libraryEnabled !== undefined && typeof d.libraryEnabled !== "boolean")
          throw Error("Invalid Library preference.");
        state = {
          version: 1,
          sidebarMode: d.sidebarMode,
          libraryEnabled: d.libraryEnabled !== false,
        };
        if (Object.hasOwn(d, "sidebarMotion")) await save(state);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return this.current();
    },
    async update(sidebarMode) {
      if (!["open", "compact", "hover"].includes(sidebarMode))
        throw Error("Invalid sidebar mode.");
      return save({ sidebarMode });
    },
    async updateLibrary(libraryEnabled) {
      if (typeof libraryEnabled !== "boolean") throw Error("Invalid Library preference.");
      return save({ libraryEnabled });
    },
  };
}
module.exports = { createStore };
