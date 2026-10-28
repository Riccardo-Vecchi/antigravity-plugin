"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { createLibrary, MAX_FILE } = require("../common/library.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-library-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const brain = path.join(root, "brain"),
    configDir = path.join(root, "config"),
    cid = "12345678-1234-1234-1234-123456789abc",
    folder = path.join(brain, cid);
  await fs.mkdir(folder, { recursive: true });
  return {
    root,
    brain,
    configDir,
    cid,
    folder,
    store: createLibrary({ brain, configDir }),
  };
}
test("discovery excludes internal logs, uploads, scratch, hidden metadata and symlinks", async (t) => {
  const f = await fixture(t);
  for (const name of [
    "report.md",
    "picture.png",
    "internal.txt",
    "report.md.metadata.json",
  ])
    await fs.writeFile(path.join(f.folder, name), name);
  await fs.writeFile(
    path.join(f.folder, "internal.txt.metadata.json"),
    JSON.stringify({ userFacing: false }),
  );
  for (const dir of [".system_generated", ".user_uploaded", "scratch"]) {
    await fs.mkdir(path.join(f.folder, dir));
    await fs.writeFile(
      path.join(f.folder, dir, "private.txt"),
      "not an artifact",
    );
  }
  if (process.platform !== "win32")
    await fs.symlink(
      path.join(f.folder, "report.md"),
      path.join(f.folder, "linked.md"),
    );
  const before = await fs.readFile(path.join(f.folder, "report.md"));
  const result = await f.store.list();
  assert.deepEqual(result.items.map((i) => i.name).sort(), [
    "picture.png",
    "report.md",
  ]);
  assert.ok(result.items.every((i) => i.conversationId === f.cid));
  assert.deepEqual(await fs.readFile(path.join(f.folder, "report.md")), before);
});
test("write references index outputs outside brain while read tools and user text do not", async (t) => {
  const f = await fixture(t),
    external = path.join(f.root, "chart.csv"),
    secret = path.join(f.root, "read-only.txt");
  await fs.writeFile(external, "a,b\n1,2");
  await fs.writeFile(secret, "private");
  const logs = path.join(f.folder, ".system_generated", "logs");
  await fs.mkdir(logs, { recursive: true });
  const transcript = path.join(logs, "transcript.jsonl");
  await fs.writeFile(
    transcript,
    [
      {
        source: "assistant",
        tool_calls: [
          {
            name: "write_file",
            args: { Path: external, Content: "NEVER PERSIST CONTENT" },
          },
          { name: "read_file", args: { Path: secret } },
        ],
      },
      { source: "user", content: `[secret](${secret})` },
    ]
      .map(JSON.stringify)
      .join("\n"),
  );
  let data = await f.store.list();
  assert.deepEqual(
    data.items.map((i) => i.name),
    ["chart.csv"],
  );
  assert.equal(
    Buffer.from(
      (await f.store.preview(data.items[0].id)).data,
      "base64",
    ).toString(),
    "a,b\n1,2",
  );
  await fs.appendFile(
    transcript,
    "\n" +
      JSON.stringify({
        source: "assistant",
        tool_calls: [{ name: "write_to_file", args: { TargetFile: secret } }],
      }),
  );
  data = await f.store.list(true);
  assert.equal(data.items.length, 2);
  await assert.rejects(fs.stat(path.join(f.configDir, "library.json")), {
    code: "ENOENT",
  });
});
test("favorites and explicit additions persist without copying originals or storing conversation content", async (t) => {
  const f = await fixture(t),
    file = path.join(f.root, "sample.obj");
  await fs.writeFile(file, "v 0 0 0");
  let data = await f.store.add([file]);
  const id = data.items[0].id;
  await f.store.favorite(id, true);
  data = await createLibrary(f).list();
  assert.equal(data.items[0].favorite, true);
  assert.equal(data.items[0].source, "added");
  assert.equal(data.items[0].conversationId, null);
  assert.deepEqual(await fs.readdir(f.configDir), ["library.json"]);
  assert.deepEqual(
    Object.keys(
      JSON.parse(await fs.readFile(path.join(f.configDir, "library.json"))),
    ).sort(),
    ["favorites", "files", "version"],
  );
  if (process.platform !== "win32")
    assert.equal(
      (await fs.stat(path.join(f.configDir, "library.json"))).mode & 0o777,
      0o600,
    );
});
test("stale, forged and oversized preview requests cannot read files outside the catalog", async (t) => {
  const f = await fixture(t),
    file = path.join(f.folder, "large.png");
  await fs.writeFile(file, "");
  await fs.truncate(file, MAX_FILE + 1);
  const data = await f.store.list();
  assert.equal(data.items[0].previewable, false);
  await assert.rejects(f.store.preview(data.items[0].id));
  await assert.rejects(f.store.preview("/etc/passwd"));
  await assert.rejects(f.store.add(["/etc/passwd"]));
  await assert.rejects(f.store.favorite(data.items[0].id, "yes"));
  await fs.rm(file);
  await assert.rejects(f.store.preview(data.items[0].id));
});
test("missing artifact folder still supports explicitly added files", async (t) => {
  const f = await fixture(t);
  await fs.rm(f.brain, { recursive: true });
  const file = path.join(f.root, "file.txt");
  await fs.writeFile(file, "text");
  const data = await f.store.add([file]);
  assert.equal(data.unavailable, true);
  assert.equal(data.items.length, 1);
});
test("removing an explicitly added artifact preserves its original and cannot remove generated files", async (t) => {
  const f = await fixture(t),
    file = path.join(f.root, "added.txt"),
    generated = path.join(f.folder, "generated.txt");
  await fs.writeFile(file, "keep this");
  await fs.writeFile(generated, "keep that");
  const data = await f.store.add([file]);
  const added = data.items.find((i) => i.source === "added"),
    native = data.items.find((i) => i.source === "generated");
  await f.store.favorite(added.id, true);
  await assert.rejects(f.store.remove(native.id));
  const next = await f.store.remove(added.id);
  assert.equal(
    next.items.some((i) => i.id === added.id),
    false,
  );
  assert.equal(await fs.readFile(file, "utf8"), "keep this");
  assert.equal(await fs.readFile(generated, "utf8"), "keep that");
});
