"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  zlib = require("node:zlib");
const core = require("../common/plugin-update-core.cjs"),
  { createUpdater } = require("../common/plugin-update.cjs"),
  { build } = require("../scripts/build-update.cjs");
const root = path.resolve(__dirname, "..");
let packages;
async function folder(t) {
  const p = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-updater-"));
  t.after(() => fs.rm(p, { recursive: true, force: true }));
  return p;
}
async function fixture(t) {
  if (!packages) {
    const output = await fs.mkdtemp(
      path.join(os.tmpdir(), "agpa-update-build-"),
    );
    let sourceRoot=root;
    const current=require('../common/versions.cjs').suite;
    if(core.version(current).preview){
      sourceRoot=await fs.mkdtemp(path.join(os.tmpdir(),'agpa-update-source-'));
      test.after(()=>fs.rm(sourceRoot,{recursive:true,force:true}));
      const manifest=require('../common/distribution.json');
      for(const name of new Set([...manifest.common,...manifest.linux,...manifest.windows])){const target=path.join(sourceRoot,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,name),target);}
      const versions=await fs.readFile(path.join(sourceRoot,'common/versions.cjs'),'utf8');
      await fs.writeFile(path.join(sourceRoot,'common/versions.cjs'),versions.replace(/suite\s*:\s*['"][^'"]+['"]/,'suite:'+JSON.stringify(current.split('-')[0])));
    }
    await build(sourceRoot, output);
    const metadata = JSON.parse(
      await fs.readFile(path.join(output, "plugin-update.json")),
    );
    packages = {
      metadata,sourceRoot,
      compressed: await fs.readFile(
        path.join(output, metadata.packages.linux.name),
      ),
    };
    await fs.rm(output, { recursive: true, force: true });
  }
  return {
    data: JSON.parse(zlib.gunzipSync(packages.compressed)),
    ...packages,
  };
}
async function installed(t) {
  const directory = await folder(t),
    f = await fixture(t);
  await fs.mkdir(directory, { recursive: true });
  for (const item of f.data.files) {
    const dest = path.join(directory, item.name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(item.data, "base64"));
  }
  await core.receipt(directory, "linux", f.data.version);
  return { ...f, directory };
}
function feed(f) {
  const release = {
    tag_name: "v" + f.data.version,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "plugin-update.json",
        browser_download_url: `https://github.com/${core.REPO}/releases/download/v${f.data.version}/plugin-update.json`,
      },
      {
        name: f.metadata.packages.linux.name,
        browser_download_url: `https://github.com/${core.REPO}/releases/download/v${f.data.version}/${f.metadata.packages.linux.name}`,
      },
    ],
  };
  let checks = 0;
  return {
    get checks() {
      return checks;
    },
    fetch: async (url) => {
      if (url.includes("/releases/latest")) {
        checks++;
        return new Response(JSON.stringify(release));
      }
      if (url.endsWith("plugin-update.json"))
        return new Response(JSON.stringify(f.metadata));
      if (url.endsWith(".json.gz")) return new Response(f.compressed);
      throw Error("Unexpected URL");
    },
  };
}
test("semantic versions never downgrade or accept arbitrary tag syntax", () => {
  assert.ok(core.newer("1.2.10", "1.2.9"));
  assert.ok(!core.newer("1.2.3", "1.3.0-dev.1"));
  assert.ok(core.newer("1.3.0", "1.3.0-dev.1"));
  for (const v of ["latest", "v1.2.3", "1.2.3/evil", "01.2.3"])
    assert.throws(() => core.version(v));
});
test("packaging is deterministic, platform-specific and contains no local state", async (t) => {
  const f = await fixture(t),
    dir = await folder(t);
  await build(f.sourceRoot, dir);
  assert.deepEqual(
    await fs.readFile(path.join(dir, f.metadata.packages.linux.name)),
    f.compressed,
  );
  const names = core.validatePackage(f.data, f.data).map((f) => f.name);
  assert.ok(names.includes("common/plugin-update-worker.cjs"));
  assert.ok(
    !names.some(
      (n) =>
        n === "projects.json" ||
        (n.startsWith("windows/") && !n.endsWith("README.md")),
    ),
  );
});
test("malformed packages, hash changes and traversal are rejected before installation", async (t) => {
  const f = await fixture(t);
  for (const name of [
    "../outside",
    "/tmp/outside",
    "common/../../outside",
    "common\\evil",
    "common/evil:stream",
  ]) {
    const data = structuredClone(f.data);
    data.files[0].name = name;
    assert.throws(() => core.validatePackage(data, f.data));
  }
  const corrupt = structuredClone(f.data);
  corrupt.files[0].data = Buffer.from("corrupted").toString("base64");
  assert.throws(() => core.validatePackage(corrupt, f.data));
  const extra = structuredClone(f.data);
  extra.files.push({ ...extra.files[0] });
  assert.throws(() => core.validatePackage(extra, f.data));
});
test("verified download rejects content corruption, wrong platform and untrusted asset URL", async (t) => {
  const f = await fixture(t),
    api = feed(f);
  const spec = await core.latest("1.2.2", "linux", api.fetch);
  assert.equal(spec.available, true);
  await core.download(spec, api.fetch);
  await assert.rejects(
    core.download({ ...spec, sha256: "0".repeat(64) }, api.fetch),
    /invalidUpdate/,
  );
  assert.throws(() =>
    core.validatePackage(f.data, { ...f.data, platform: "win32" }),
  );
  assert.throws(() =>
    core.asset(
      {
        tag_name: "v1.2.3",
        assets: [
          {
            name: "plugin-update.json",
            browser_download_url: "https://attacker.invalid/payload",
          },
        ],
      },
      "plugin-update.json",
    ),
  );
});
test("local modifications and symlink targets block an update without touching user data", async (t) => {
  const f = await installed(t),
    file = path.join(f.directory, "common/daemon.cjs");
  await fs.appendFile(file, "\n// local modification\n");
  assert.equal(await core.pristine(f.directory), false);
  await assert.rejects(
    core.applyPackage(f.directory, f.data, f.data),
    /localChanges/,
  );
  assert.ok((await fs.readFile(file, "utf8")).includes("local modification"));
  await fs.unlink(file);
  await fs.symlink("/tmp", file);
  assert.equal(await core.pristine(f.directory), false);
});
test("failed startup restores the previous payload and receipt, preserving private settings", async (t) => {
  const f = await installed(t),
    file = path.join(f.directory, "common/daemon.cjs"),
    before = await fs.readFile(file),
    receipt = await fs.readFile(
      path.join(f.directory, ".plugin-update-receipt.json"),
    );
  await fs.writeFile(
    path.join(f.directory, "projects.json"),
    "private settings",
  );
  const data = structuredClone(f.data),
    entry = data.files.find((v) => v.name === "common/daemon.cjs"),
    bytes = Buffer.concat([before, Buffer.from("\n// new version\n")]);
  entry.data = bytes.toString("base64");
  entry.size = bytes.length;
  entry.sha256 = core.hash(bytes);
  await assert.rejects(
    core.applyPackage(f.directory, data, data, async () => {
      throw Error("healthFailed");
    }),
    /healthFailed/,
  );
  assert.deepEqual(await fs.readFile(file), before);
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, ".plugin-update-receipt.json")),
    receipt,
  );
  assert.equal(
    await fs.readFile(path.join(f.directory, "projects.json"), "utf8"),
    "private settings",
  );
});
test("successful install preserves unrelated files and executable shell scripts", async (t) => {
  const f = await installed(t);
  await fs.writeFile(path.join(f.directory, "private-note.txt"), "keep");
  let verified = false;
  await core.applyPackage(f.directory, f.data, f.data, async () => {
    verified = true;
  });
  assert.ok(verified);
  assert.equal(await core.pristine(f.directory), true);
  assert.equal(
    await fs.readFile(path.join(f.directory, "private-note.txt"), "utf8"),
    "keep",
  );
  assert.equal(
    (await fs.stat(path.join(f.directory, "linux/disable.sh"))).mode & 0o700,
    0o700,
  );
});
test("forced checks always contact GitHub, even with automatic updates disabled", async (t) => {
  const f = await installed(t),
    api = feed(f),
    configDir = await folder(t);
  const updater = createUpdater({
    current: "1.2.2",
    paths: { configDir, installDir: f.directory },
    platform: "linux",
    arch: "x64",
    managed: true,
    fetcher: api.fetch,
  });
  await updater.initialize();
  await updater.perform("automatic", false);
  await updater.tick();
  assert.equal(api.checks, 0);
  await updater.perform("check");
  await updater.perform("check");
  assert.equal(api.checks, 2);
  assert.equal((await updater.status()).available, true);
  updater.close();
});
test("periodic checks respect six-hour schedule, install verified releases and avoid duplicate attempts", async (t) => {
  const f = await installed(t),
    api = feed(f),
    configDir = await folder(t);
  let dispatched = 0;
  const updater = createUpdater({
    current: "1.2.2",
    paths: { configDir, installDir: f.directory },
    platform: "linux",
    arch: "x64",
    managed: true,
    fetcher: api.fetch,
    dispatch: async (id) => {
      const job = JSON.parse(
        await fs.readFile(path.join(configDir, "updates", id + ".json")),
      );
      assert.equal(job.version, f.data.version);
      dispatched++;
    },
  });
  await updater.initialize();
  await updater.tick();
  assert.equal(api.checks, 1);
  assert.equal(dispatched, 1);
  await updater.tick();
  assert.equal(api.checks, 1);
  assert.equal(dispatched, 1);
  updater.close();
});
test("local previews check availability but never dispatch an automatic or manual overwrite", async (t) => {
  const f = await installed(t),
    api = feed(f),
    configDir = await folder(t);
  let dispatched = 0;
  const updater = createUpdater({
    current: "1.1.0-dev.1",
    paths: { configDir, installDir: f.directory },
    platform: "linux",
    arch: "x64",
    managed: true,
    fetcher: api.fetch,
    dispatch: async () => {
      dispatched++;
    },
  });
  await updater.initialize();
  await updater.tick();
  await updater.install(true);
  assert.equal((await updater.status()).paused, "preview");
  assert.equal(api.checks, 1);
  assert.equal(dispatched, 0);
  updater.close();
});
test("automatic installation waits while settings or setup are busy; a later idle tick retries", async (t) => {
  const f = await installed(t),
    api = feed(f),
    configDir = await folder(t);
  let idle = false,
    dispatched = 0;
  const updater = createUpdater({
    current: "1.2.2",
    paths: { configDir, installDir: f.directory },
    platform: "linux",
    arch: "x64",
    managed: true,
    fetcher: api.fetch,
    canApply: async () => idle,
    dispatch: async () => {
      dispatched++;
    },
  });
  await updater.initialize();
  await updater.tick();
  assert.equal(dispatched, 0);
  idle = true;
  await updater.tick();
  assert.equal(dispatched, 1);
  updater.close();
});
