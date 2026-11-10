"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const {
  profileRoot,
  probeEndpoint,
  resolveEngine,
  createEngine,
} = require("../common/browser-engine.cjs");
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-official-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("known profile roots honor XDG, roaming Opera, and Windows LocalAppData without reading browser preferences", () => {
  assert.equal(
    profileRoot("brave", {
      platform: "linux",
      home: "/home/lab",
      env: { XDG_CONFIG_HOME: "/config" },
    }),
    "/config/BraveSoftware/Brave-Browser",
  );
  assert.equal(
    profileRoot("edge", {
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Local" },
    }),
    "C:\\Local\\Microsoft\\Edge\\User Data",
  );
  assert.equal(
    profileRoot("opera", {
      platform: "win32",
      env: { APPDATA: "C:\\Roaming" },
    }),
    "C:\\Roaming\\Opera Software\\Opera Stable",
  );
  assert.throws(() => profileRoot("unknown"));
});
test("permission-based discovery works without HTTP endpoints and rejects stale, malformed or symlinked discovery files", async (t) => {
  const root = await directory(t),
    file = path.join(root, "DevToolsActivePort");
  let calls = 0;
  const connectPort = async (port) => {
    calls++;
    assert.equal(port, 12345);
    return true;
  };
  await fs.writeFile(file, "12345\n/devtools/browser/abc-1\n");
  assert.equal(await probeEndpoint(root, { connectPort }), true);
  for (const value of [
    "65536\n/devtools/browser/a",
    "12345\nhttps://external.test/",
    "a\n/devtools/browser/a",
    "x".repeat(3000),
  ]) {
    await fs.writeFile(file, value);
    assert.equal(await probeEndpoint(root, { connectPort }), false);
  }
  assert.equal(calls, 1);
  await fs.writeFile(file, "12345\n/devtools/browser/abc-1\n");
  assert.equal(
    await probeEndpoint(root, { connectPort: async () => false }),
    false,
  );
  await fs.rename(file, file + ".real");
  await fs.symlink(file + ".real", file);
  assert.equal(await probeEndpoint(root, { connectPort }), false);
});
test("engine resolves only the named bundled component, including the actual Linux process location", async (t) => {
  const root = await directory(t),
    resources = path.join(root, "resources"),
    base = path.join(
      resources,
      "app.asar.unpacked/node_modules/chrome-devtools-mcp",
    ),
    entry = path.join(base, "build/src/bin/chrome-devtools-mcp.js"),
    proc = path.join(root, "proc");
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, "");
  await fs.writeFile(
    path.join(base, "package.json"),
    JSON.stringify({ name: "wrong", version: "1.9.0" }),
  );
  assert.equal(await resolveEngine({ resources, proc, home: root }), null);
  await fs.writeFile(
    path.join(base, "package.json"),
    JSON.stringify({ name: "chrome-devtools-mcp", version: "1.9.0" }),
  );
  await fs.mkdir(path.join(proc, "123"), { recursive: true });
  await fs.symlink(path.join(root, "antigravity"), path.join(proc, "123/exe"));
  assert.deepEqual(await resolveEngine({ proc, home: root }), {
    entry,
    version: "1.9.0",
  });
});
test("official transport negotiates MCP, propagates tool errors, disables telemetry and cancels pending work", async (t) => {
  const root = await directory(t),
    entry = path.join(root, "official.cjs");
  await fs.writeFile(
    entry,
    `const readline=require('readline');const input=readline.createInterface({input:process.stdin});input.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined||m.method==='hang')return;let result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'official'}}:m.method==='tools/list'?{tools:[{name:'list_pages'}]}:{args:process.argv.slice(2),telemetry:process.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...(m.method==='fail'?{error:{code:-1,message:'native refusal'}}:{result})})+'\\n')});`,
  );
  const engine = createEngine({ entry, profile: root });
  t.after(() => engine.close());
  assert.equal(
    (await engine.request("initialize", {})).serverInfo.name,
    "official",
  );
  assert.equal(
    (await engine.request("tools/list", {})).tools[0].name,
    "list_pages",
  );
  const result = await engine.request("tools/call", {});
  assert.ok(result.args.includes("--userDataDir=" + root));
  assert.equal(result.telemetry, "1");
  await assert.rejects(engine.request("fail", {}), /native refusal/);
  const hanging = engine.request("hang", {});
  await new Promise(setImmediate);
  engine.close();
  await assert.rejects(hanging, /closed/);
});

test("managed engine compares stable versions and rejects unverified downloads before installing", async (t) => {
  const { atLeast, prepare } = require("../common/browser-engine-install.cjs"),
    root = await directory(t);
  assert.equal(atLeast("1.12.0", "1.9.0"), true);
  assert.equal(atLeast("1.9.0", "1.12.0"), false);
  assert.equal(atLeast("1.12.0-rc.1", "1.12.0"), false);
  await assert.rejects(
    prepare({
      configDir: root,
      fetcher: async () => new Response("unverified"),
    }),
    /integrity/,
  );
  await assert.rejects(fs.stat(path.join(root, "browser")), { code: "ENOENT" });
});
test("portable package extraction rejects traversal, links, duplicates and expansion bombs", async (t) => {
  const { unpack } = require("../common/browser-engine-install.cjs"),
    zlib = require("node:zlib");
  function tar(entries) {
    const parts = [];
    for (const [name, type = "0"] of entries) {
      const h = Buffer.alloc(512);
      h.write(name);
      h.write("00000000000\0", 124);
      h.write(type, 156);
      parts.push(h);
    }
    return zlib.gzipSync(Buffer.concat(parts));
  }
  for (const entries of [
    [["package/../escape"]],
    [["package/build/x", "2"]],
    [["package/a"], ["package/a"]],
  ]) {
    const root = await directory(t);
    await assert.rejects(unpack(tar(entries), root), /Invalid/);
  }
  const root = await directory(t);
  await assert.rejects(
    unpack(zlib.gzipSync(Buffer.alloc(33 * 1024 * 1024)), root),
  );
});
