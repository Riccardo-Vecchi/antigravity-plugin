"use strict";
// Read-only artifact discovery. Never edits the official profile or transcripts.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { createHash } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { createReadStream } = require("node:fs");
const { createInterface } = require("node:readline");
const TYPES = {
  images: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
  documents: ["docx", "odt", "rtf", "md", "txt", "tex"],
  spreadsheets: ["xlsx", "ods", "csv", "tsv"],
  presentations: ["pptx", "odp"],
  pdf: ["pdf"],
  models: ["glb", "gltf", "stl", "obj", "ply"],
  interactive: ["html", "htm"],
  media: ["mp4", "webm", "mp3", "wav", "ogg", "m4a"],
};
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const MAX_FILE = 25 * 1024 * 1024,
  MAX_TRANSCRIPT = 16 * 1024 * 1024,
  MAX_ITEMS = 5000;
function category(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return Object.keys(TYPES).find((k) => TYPES[k].includes(ext)) || null;
}
function filePath(value) {
  try {
    return value?.startsWith("file:")
      ? fileURLToPath(value)
      : typeof value === "string" && path.isAbsolute(value)
        ? value
        : null;
  } catch {
    return null;
  }
}
function idFor(file) {
  return createHash("sha256").update(file).digest("hex");
}
async function regular(file, max = Infinity) {
  const s = await fs.lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max)
    throw Error("unavailable");
  return s;
}
async function readBounded(file, max) {
  const before = await regular(file, max),
    handle = await fs.open(file, "r");
  try {
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.size > max
    )
      throw Error("unavailable");
    const bytes = Buffer.alloc(Math.min(max + 1, current.size + 1));
    let used = 0;
    while (used < bytes.length) {
      const result = await handle.read(bytes, used, bytes.length - used, used);
      if (!result.bytesRead) break;
      used += result.bytesRead;
    }
    if (used > max) throw Error("tooLarge");
    return bytes.subarray(0, used);
  } finally {
    await handle.close();
  }
}
// Source, format and favorite filters are independent; originals are deduplicated by path.
function filterItems(items, { source = "generated", type = "all", favorites = false, query = "" } = {}) {
  const search = String(query).toLocaleLowerCase().trim();
  return items.filter((item) => {
    const sources = item.sources || [item.source];
    return (source === "all" || sources.includes(source) ||
        (source === "uploaded" && sources.includes("added"))) &&
      (type === "all" || item.category === type) && (!favorites || item.favorite) &&
      (!search || [item.name, item.summary].some((v) => v?.toLocaleLowerCase().includes(search)));
  });
}
function createLibrary({
  brain = path.join(os.homedir(), ".gemini", "antigravity", "brain"),
  configDir = require("./platform-paths.cjs").getPaths().configDir,
} = {}) {
  const settings = path.join(configDir, "library.json"),
    entries = new Map(),
    transcripts = new Map();
  let preferences = { version: 1, favorites: [], files: [] },
    enabled = true,
    epoch = 0,
    loaded = false,
    scanning = null,
    lastScan = 0,
    truncated = false,
    unavailable = false;
  async function load() {
    if (loaded) return;
    try {
      await regular(settings, 1024 * 1024);
      const d = JSON.parse(await fs.readFile(settings, "utf8"));
      if (d.version === 1) {
        preferences.favorites = (d.favorites || [])
          .filter((x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x))
          .slice(0, MAX_ITEMS);
        preferences.files = (d.files || [])
          .filter((x) => filePath(x) && category(x))
          .slice(0, 1000);
      }
    } catch (e) {
      if (e.code !== "ENOENT" && e.message !== "unavailable") throw e;
    }
    loaded = true;
  }
  async function save(next) {
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    const tmp = settings + "." + process.pid + ".tmp";
    try {
      await fs.writeFile(tmp, JSON.stringify(next) + "\n", { mode: 0o600 });
      await fs.rename(tmp, settings);
      preferences = next;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  async function remember(catalog, file, conversationId, source, summary = "") {
    if (!enabled) return;
    if (catalog.size >= MAX_ITEMS && !catalog.has(idFor(file))) {
      truncated = true;
      return;
    }
    if (!file || !category(file) || file.includes("\0")) return;
    try {
      const stat = await regular(file);
      const real = await fs.realpath(file);
      if (real !== path.resolve(file)) return;
      const id = idFor(real),
        old = catalog.get(id),
        sources = [...new Set([...(old?.sources || []), source])];
      catalog.set(id, {
        id,
        name: path.basename(file),
        path: real,
        category: category(file),
        extension: path.extname(file).slice(1).toLowerCase(),
        size: stat.size,
        modified: stat.mtimeMs,
        conversationId: conversationId || old?.conversationId || null,
        source: ["generated", "uploaded", "added"].find((s) => sources.includes(s)),
        sources,
        summary: String(summary || old?.summary || "").slice(0, 500),
        previewable: stat.size <= MAX_FILE,
      });
    } catch {
      /* Missing, remote and linked files are not opened or copied. */
    }
  }
  async function discover(catalog, folder, cid, source, depth = 0, scanEpoch = epoch) {
    if (!enabled || epoch !== scanEpoch || depth > 5) return;
    let list;
    try {
      list = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (!enabled || epoch !== scanEpoch) return;
      if (e.name.startsWith(".") || e.name === "scratch" || e.isSymbolicLink())
        continue;
      const file = path.join(folder, e.name);
      if (e.isDirectory()) {
        await discover(catalog, file, cid, source, depth + 1, scanEpoch);
        continue;
      }
      if (!e.isFile() || !category(e.name)) continue;
      let meta;
      try {
        await regular(file + ".metadata.json", 65536);
        meta = JSON.parse(await fs.readFile(file + ".metadata.json", "utf8"));
      } catch {}
      if (meta?.userFacing === false) continue;
      await remember(catalog, file, cid, source, meta?.summary);
    }
  }
  async function references(file) {
    let s;
    try {
      s = await regular(file, MAX_TRANSCRIPT);
    } catch (e) {
      if (e.message === "unavailable") truncated = true;
      return [];
    }
    const cached = transcripts.get(file);
    if (cached?.size === s.size && cached?.mtime === s.mtimeMs)
      return cached.files;
    const referenceEpoch = epoch, found = new Set();
    const input = createReadStream(file, {
        encoding: "utf8",
        end: Math.max(0, s.size - 1),
      }),
      lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!enabled || epoch !== referenceEpoch) break;
        if (line.length > 2 * 1024 * 1024) {
          truncated = true;
          continue;
        }
        let d;
        try {
          d = JSON.parse(line);
        } catch {
          continue;
        }
        // Only paths emitted by write tools, or file links in assistant output.
        for (const t of d.tool_calls || []) {
          if (!/^(?:write_file|write_to_file|edit_file)$/.test(t.name))
            continue;
          const a = t.args || {};
          const p = filePath(a.Path || a.TargetFile);
          if (p && category(p)) found.add(p);
        }
        if (
          /assistant|model/i.test(d.source || "") &&
          typeof d.content === "string"
        )
          for (const m of d.content.matchAll(
            /\]\((file:\/\/\/[^)\n]+|\/[^)\n]+|[A-Za-z]:[\\/][^)\n]+)\)/g,
          )) {
            const p = filePath(m[1]);
            if (p && category(p)) found.add(p);
          }
      }
    } finally {
      lines.close();
      input.destroy();
    }
    const files = [...found].slice(0, MAX_ITEMS);
    if (enabled && epoch === referenceEpoch)
      transcripts.set(file, { size: s.size, mtime: s.mtimeMs, files });
    return files;
  }
  async function refresh(force = false) {
    if (!enabled) throw Error("disabled");
    await load();
    if (scanning) {
      await scanning;
      return refresh(force);
    }
    if (!enabled) throw Error("disabled");
    if (!force && Date.now() - lastScan < 20000) return;
    const scanEpoch = epoch, catalog = new Map();
    const job = scanning = (async () => {
      truncated = false;
      unavailable = false;
      let folders = [];
      try {
        const root = await fs.lstat(brain);
        if (!root.isDirectory() || root.isSymbolicLink())
          throw Error("unavailable");
        folders = await fs.readdir(brain, { withFileTypes: true });
      } catch {
        unavailable = true;
      }
      for (const f of folders) {
        if (!UUID.test(f.name) || !f.isDirectory() || f.isSymbolicLink())
          continue;
        const folder = path.join(brain, f.name);
        if (!enabled || epoch !== scanEpoch) return;
        await discover(catalog, folder, f.name, "generated");
        const uploads = path.join(folder, ".user_uploaded");
        const uploadStat = await fs.lstat(uploads).catch(() => null);
        if (uploadStat?.isDirectory() && !uploadStat.isSymbolicLink())
          await discover(catalog, uploads, f.name, "uploaded");
        for (const file of await references(
          path.join(folder, ".system_generated", "logs", "transcript.jsonl"),
        ))
          await remember(catalog, file, f.name,
            path.relative(uploads, file).split(path.sep)[0] !== ".." &&
              !path.isAbsolute(path.relative(uploads, file)) ? "uploaded" : "generated");
      }
      for (const file of preferences.files) await remember(catalog, file, null, "added");
      if (!enabled || epoch !== scanEpoch) return;
      entries.clear();
      for (const [id, entry] of catalog) entries.set(id, entry);
      lastScan = Date.now();
    })();
    try {
      await job;
    } finally {
      if (scanning === job) scanning = null;
    }
  }
  function snapshot() {
    return {
      items: [...entries.values()]
        .map((e) => ({ ...e, favorite: preferences.favorites.includes(e.id) }))
        .sort((a, b) => b.modified - a.modified),
      truncated,
      unavailable,
    };
  }
  async function list(force = false) {
    await refresh(force);
    if (!enabled) throw Error("disabled");
    return snapshot();
  }
  async function item(id) {
    await refresh();
    if (typeof id !== "string" || !entries.has(id)) throw Error("unavailable");
    const e = entries.get(id);
    await regular(e.path);
    if ((await fs.realpath(e.path)) !== e.path) throw Error("unavailable");
    if (!enabled) throw Error("disabled");
    return e;
  }
  async function preview(id, { thumbnail = false } = {}) {
    const e = await item(id);
    const stat = await regular(e.path);
    if (stat.size > (thumbnail ? 512 * 1024 : MAX_FILE))
      throw Error("tooLarge");
    const bytes = await readBounded(e.path, thumbnail ? 512 * 1024 : MAX_FILE);
    if (!enabled) throw Error("disabled");
    if (bytes.length > MAX_FILE) throw Error("tooLarge");
    return {
      id: e.id,
      name: e.name,
      category: e.category,
      extension: e.extension,
      data: bytes.toString("base64"),
    };
  }
  async function favorite(id, value) {
    await item(id);
    if (typeof value !== "boolean") throw Error("unavailable");
    const favorites = preferences.favorites.filter((x) => x !== id);
    if (value) favorites.push(id);
    await save({ ...preferences, favorites });
    return snapshot();
  }
  async function add(files) {
    if (!enabled) throw Error("disabled");
    await load();
    if (!Array.isArray(files) || files.length > 50) throw Error("unavailable");
    const next = new Set(preferences.files);
    for (const file of files) {
      const p = filePath(file);
      if (!p || !category(p)) throw Error("unsupported");
      await regular(p);
      if ((await fs.realpath(p)) !== p) throw Error("unavailable");
      next.add(p);
    }
    if (next.size > 1000) throw Error("tooMany");
    await save({ ...preferences, files: [...next] });
    return list(true);
  }
  async function remove(id) {
    const e = await item(id);
    if (!e.sources.includes("added")) throw Error("unavailable");
    await save({
      ...preferences,
      files: preferences.files.filter((p) => p !== e.path),
      favorites: preferences.favorites.filter((p) => p !== id),
    });
    return list(true);
  }
  function setEnabled(value) {
    if (typeof value !== "boolean") throw Error("unavailable");
    if (enabled === value) return;
    enabled = value;
    epoch++;
    entries.clear();
    transcripts.clear();
    lastScan = 0;
  }
  return { list, preview, favorite, add, remove, item, setEnabled };
}
module.exports = { createLibrary, category, filePath, idFor, MAX_FILE, filterItems };
