"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib");
function json(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    throw Error("invalidUpdate");
  }
}
const REPO = "Riccardo-Vecchi/antigravity-plugin",
  LIMIT = 40 * 1024 * 1024;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function version(value) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z.-]+))?$/.exec(
    value || "",
  );
  if (
    !m ||
    value.length > 80 ||
    m.slice(1, 4).some((n) => !Number.isSafeInteger(Number(n)))
  )
    throw Error("invalidUpdate");
  return { numbers: m.slice(1, 4).map(Number), preview: !!m[4] };
}
function newer(candidate, current) {
  const a = version(candidate),
    b = version(current);
  for (let i = 0; i < 3; i++)
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i];
  return !a.preview && b.preview;
}
function safePath(value) {
  return (
    typeof value === "string" &&
    value.length < 240 &&
    !value.includes("\\") &&
    !/[\x00-\x1f:]/.test(value) &&
    !path.posix.isAbsolute(value) &&
    value
      .split("/")
      .every(
        (p) =>
          /^[A-Za-z0-9_.@-]+$/.test(p) &&
          !p.endsWith(".") &&
          !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p) &&
          p !== "." &&
          p !== "..",
      ) &&
    (/^(common|linux|windows|docs|assets|icons)\//.test(value) ||
      ["README.md", "LICENSE", "NOTICE.md"].includes(value)) &&
    !/^(icons\/(?:current|original)|.*\.agpa-lock)/.test(value)
  );
}
function targets(manifest, platform) {
  if (
    manifest?.version !== 1 ||
    !["linux", "win32"].includes(platform) ||
    !Array.isArray(manifest.common) ||
    !Array.isArray(manifest[platform === "win32" ? "windows" : "linux"])
  )
    throw Error("invalidUpdate");
  const files = [
    ...manifest.common,
    ...manifest[platform === "win32" ? "windows" : "linux"],
  ];
  if (files.length > 400) throw Error("invalidUpdate");
  const output = files.map((file) => {
    if (!safePath(file)) throw Error("invalidUpdate");
    const mapping = Object.entries(manifest.mappings || {}).find(([prefix]) =>
      file.startsWith(prefix),
    );
    const name = mapping ? mapping[1] + file.slice(mapping[0].length) : file;
    if (!safePath(name)) throw Error("invalidUpdate");
    return { source: file, name };
  });
  if (new Set(output.map((f) => f.name.toLowerCase())).size !== output.length)
    throw Error("invalidUpdate");
  return output;
}
function validatePackage(data, expected) {
  if (
    !data ||
    data.schema !== 1 ||
    data.version !== expected.version ||
    data.platform !== expected.platform ||
    data.arch !== "x64" ||
    version(data.version).preview ||
    !Array.isArray(data.files) ||
    data.files.length > 400
  )
    throw Error("invalidUpdate");
  const files = new Map();
  let total = 0;
  for (const item of data.files) {
    if (
      !safePath(item?.name) ||
      typeof item.data !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        item.data,
      ) ||
      files.has(item.name.toLowerCase())
    )
      throw Error("invalidUpdate");
    const bytes = Buffer.from(item.data, "base64");
    total += bytes.length;
    if (
      total > 25 * 1024 * 1024 ||
      item.size !== bytes.length ||
      hash(bytes) !== item.sha256
    )
      throw Error("invalidUpdate");
    files.set(item.name.toLowerCase(), {
      name: item.name,
      bytes,
      sha256: item.sha256,
    });
  }
  let manifest, versions;
  try {
    manifest = JSON.parse(files.get("common/distribution.json").bytes);
    versions = files.get("common/versions.cjs").bytes.toString();
  } catch {
    throw Error("invalidUpdate");
  }
  const wanted = targets(manifest, data.platform);
  if (
    wanted.length !== files.size ||
    wanted.some((f) => !files.has(f.name.toLowerCase())) ||
    !files.has("common/daemon.cjs") ||
    !files.has("common/plugin-update-worker.cjs") ||
    versions.match(/\bsuite\s*:\s*['"]([^'"]+)['"]/)?.[1] !== data.version
  )
    throw Error("invalidUpdate");
  return [...files.values()];
}
async function plain(file, limit = LIMIT) {
  try {
    const s = await fs.lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > limit)
      throw Error("unsafeUpdatePath");
    return await fs.readFile(file);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function atomic(file, bytes, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, bytes, { flag: "wx", mode });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
async function parents(root, name) {
  const base = await fs.lstat(root);
  if (!base.isDirectory() || base.isSymbolicLink())
    throw Error("unsafeUpdatePath");
  let directory = root;
  for (const part of name.split("/").slice(0, -1)) {
    directory = path.join(directory, part);
    const s = await fs
      .lstat(directory)
      .catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
    if (s && (!s.isDirectory() || s.isSymbolicLink()))
      throw Error("unsafeUpdatePath");
  }
  const s = await fs
    .lstat(path.join(root, name))
    .catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
  if (s && (!s.isFile() || s.isSymbolicLink())) throw Error("unsafeUpdatePath");
}
async function receipt(root, platform, current) {
  const manifest = JSON.parse(
    await plain(path.join(root, "common/distribution.json")),
  );
  const files = {};
  for (const f of targets(manifest, platform)) {
    await parents(root, f.name);
    files[f.name] = hash(await plain(path.join(root, f.name)));
  }
  const value = { schema: 1, version: current, platform, files };
  await atomic(
    path.join(root, ".plugin-update-receipt.json"),
    JSON.stringify(value),
  );
  return value;
}
async function pristine(root) {
  try {
    const record = JSON.parse(
      await plain(path.join(root, ".plugin-update-receipt.json"), 200000),
    );
    if (
      record.schema !== 1 ||
      !record.files ||
      typeof record.files !== "object" ||
      Object.keys(record.files).length > 400
    )
      return false;
    for (const [name, digest] of Object.entries(record.files)) {
      if (!safePath(name)) return false;
      if (name.startsWith("icons/")) continue;
      await parents(root, name);
      const bytes = await plain(path.join(root, name));
      if (!bytes || hash(bytes) !== digest) return false;
    }
    return true;
  } catch {
    return false;
  }
}
async function applyPackage(root, data, expected, afterApply = async () => {}) {
  const files = validatePackage(data, expected);
  if (!(await pristine(root))) throw Error("localChanges");
  for (const f of files) await parents(root, f.name);
  const originals = new Map(),
    oldReceipt = await plain(path.join(root, ".plugin-update-receipt.json"));
  try {
    for (const f of files) {
      originals.set(f.name, {
        bytes: await plain(path.join(root, f.name)),
        mode: await fs
          .stat(path.join(root, f.name))
          .then((s) => s.mode & 0o777)
          .catch(() => 0o600),
      });
      await atomic(
        path.join(root, f.name),
        f.bytes,
        f.name.endsWith(".sh") ? 0o700 : 0o600,
      );
    }
    await receipt(root, data.platform, data.version);
    await afterApply();
  } catch (e) {
    for (const [name, previous] of [...originals].reverse()) {
      const bytes = previous.bytes;
      if (bytes === null) await fs.rm(path.join(root, name), { force: true });
      else await atomic(path.join(root, name), bytes, previous.mode);
    }
    if (oldReceipt)
      await atomic(path.join(root, ".plugin-update-receipt.json"), oldReceipt);
    throw e;
  }
}
async function body(url, limit = 2 * 1024 * 1024, fetcher = fetch) {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Antigravity-Plugin-Updater",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw Error(
      response.status === 403 || response.status === 429
        ? "rateLimited"
        : "network",
    );
  if (response.url) {
    const final = new URL(response.url);
    if (
      final.protocol !== "https:" ||
      ![
        "github.com",
        "api.github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(final.hostname)
    )
      throw Error("invalidUpdate");
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw Error("invalidUpdate");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function asset(release, name) {
  if (
    typeof release?.tag_name !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
    release.draft ||
    release.prerelease
  )
    throw Error("invalidUpdate");
  const a = release.assets?.find((a) => a.name === name);
  const prefix =
    "https://github.com/" +
    REPO +
    "/releases/download/" +
    release.tag_name +
    "/";
  if (!a || a.browser_download_url !== prefix + name)
    throw Error("invalidUpdate");
  return a.browser_download_url;
}
async function latest(current, platform, fetcher) {
  const release = json(
    await body(
      "https://api.github.com/repos/" + REPO + "/releases/latest",
      2 * 1024 * 1024,
      fetcher,
    ),
  );
  const next = release.tag_name?.slice(1);
  version(next);
  const manifest = json(
    await body(asset(release, "plugin-update.json"), 200000, fetcher),
  );
  const spec = manifest?.packages?.[platform];
  if (
    manifest?.schema !== 1 ||
    manifest.repository !== REPO ||
    manifest.version !== next ||
    !spec ||
    spec.arch !== "x64" ||
    !Number.isInteger(spec.size) ||
    spec.size <= 0 ||
    spec.size > 15 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(spec.sha256) ||
    spec.name !== `antigravity-plugin-${next}-${platform}-x64.json.gz`
  )
    throw Error("invalidUpdate");
  return {
    version: next,
    available: newer(next, current),
    url: asset(release, spec.name),
    size: spec.size,
    sha256: spec.sha256,
    platform,
    releaseUrl:
      "https://github.com/" + REPO + "/releases/tag/" + release.tag_name,
  };
}
async function download(spec, fetcher) {
  const compressed = await body(spec.url, 15 * 1024 * 1024, fetcher);
  if (compressed.length !== spec.size || hash(compressed) !== spec.sha256)
    throw Error("invalidUpdate");
  let data;
  try {
    data = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: LIMIT }));
  } catch {
    throw Error("invalidUpdate");
  }
  validatePackage(data, spec);
  return data;
}
module.exports = {
  REPO,
  LIMIT,
  hash,
  version,
  newer,
  safePath,
  targets,
  validatePackage,
  plain,
  atomic,
  parents,
  receipt,
  pristine,
  applyPackage,
  body,
  asset,
  latest,
  download,
};
