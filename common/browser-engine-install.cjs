"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib");
const release = require("./browser-engine-release.cjs"),
  { getPaths } = require("./platform-paths.cjs");
function atLeast(a, b) {
  const x = /^(\d+)\.(\d+)\.(\d+)$/.exec(a || ""),
    y = /^(\d+)\.(\d+)\.(\d+)$/.exec(b || "");
  if (!x || !y) return false;
  for (let i = 1; i < 4; i++) {
    if (+x[i] !== +y[i]) return +x[i] > +y[i];
  }
  return true;
}
async function installed(configDir) {
  const root = path.join(configDir, "browser", "engine-" + release.version),
    entry = path.join(root, "build/src/bin/chrome-devtools-mcp.js");
  try {
    if (
      !(await fs.lstat(root)).isDirectory() ||
      (await fs.lstat(root)).isSymbolicLink()
    )
      return null;
    const meta = JSON.parse(
        await fs.readFile(path.join(root, "package.json"), "utf8"),
      ),
      receipt = JSON.parse(
        await fs.readFile(path.join(root, ".receipt.json"), "utf8"),
      );
    if (
      meta.name !== "chrome-devtools-mcp" ||
      meta.version !== release.version ||
      receipt.integrity !== release.integrity ||
      !(await fs.lstat(entry)).isFile() ||
      (await fs.lstat(entry)).isSymbolicLink()
    )
      return null;
    return { entry, version: release.version };
  } catch {
    return null;
  }
}
async function unpack(archive, root) {
  const tar = zlib.gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  let count = 0;
  const seen = new Set();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every((n) => n === 0)) break;
    const text = (a, b) => h.subarray(a, b).toString().split("\0")[0];
    const prefix = text(345, 500),
      name = (prefix ? prefix + "/" : "") + text(0, 100),
      raw = text(124, 136).trim();
    const size = /^[0-7]+$/.test(raw) ? parseInt(raw, 8) : NaN,
      type = text(156, 157);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length ||
      !["0", ""].includes(type) ||
      !name.startsWith("package/")
    )
      throw Error("Invalid browser package.");
    const relative = name.slice(8),
      parts = relative.split("/");
    if (
      !relative ||
      parts.some(
        (x) => !x || x === "." || x === ".." || /[\\<>:"|?*\x00-\x1f]/.test(x),
      ) ||
      seen.has(relative) ||
      ++count > 1000
    )
      throw Error("Invalid browser package path.");
    seen.add(relative);
    const target = path.join(root, ...parts);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(
      target,
      tar.subarray(offset + 512, offset + 512 + size),
      { flag: "wx", mode: 0o600 },
    );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (
    !seen.has("package.json") ||
    !seen.has("build/src/bin/chrome-devtools-mcp.js") ||
    !seen.has("LICENSE")
  )
    throw Error("Incomplete browser package.");
}
let installing;
async function prepare({
  configDir = getPaths().configDir,
  fetcher = fetch,
} = {}) {
  const old = await installed(configDir);
  if (old) return old;
  if (installing) return installing;
  installing = (async () => {
    const response = await fetcher(release.url, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error("Browser tools download failed.");
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 8 * 1024 * 1024) throw Error("Browser package too large.");
      chunks.push(Buffer.from(chunk));
    }
    const archive = Buffer.concat(chunks);
    if (
      "sha512-" +
        crypto.createHash("sha512").update(archive).digest("base64") !==
      release.integrity
    )
      throw Error("Browser package integrity failed.");
    const parent = path.join(configDir, "browser");
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const stage = await fs.mkdtemp(path.join(parent, ".engine-")),
      target = path.join(parent, "engine-" + release.version);
    try {
      await unpack(archive, stage);
      const meta = JSON.parse(
        await fs.readFile(path.join(stage, "package.json"), "utf8"),
      );
      if (
        meta.name !== "chrome-devtools-mcp" ||
        meta.version !== release.version
      )
        throw Error("Invalid browser package version.");
      await fs.writeFile(
        path.join(stage, ".receipt.json"),
        JSON.stringify({
          version: release.version,
          integrity: release.integrity,
        }) + "\n",
        { mode: 0o600, flag: "wx" },
      );
      try {
        await fs.rename(stage, target);
      } catch (e) {
        if (await installed(configDir)) return installed(configDir);
        throw e;
      }
      return await installed(configDir);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  })();
  try {
    return await installing;
  } finally {
    installing = null;
  }
}
module.exports = { prepare, installed, unpack, atLeast };
