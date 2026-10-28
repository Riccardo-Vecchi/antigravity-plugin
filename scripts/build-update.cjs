#!/usr/bin/env node
"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  zlib = require("node:zlib");
const core = require("../common/plugin-update-core.cjs");
async function build(root, output) {
  const version = require(path.join(root, "common/versions.cjs")).suite;
  if (core.version(version).preview)
    throw Error("Only stable versions can be published.");
  const manifest = JSON.parse(
      await fs.readFile(path.join(root, "common/distribution.json")),
    ),
    packages = {};
  await fs.mkdir(output, { recursive: true });
  for (const platform of ["linux", "win32"]) {
    const files = [];
    for (const f of core.targets(manifest, platform)) {
      const bytes = await fs.readFile(path.join(root, f.source));
      files.push({
        name: f.name,
        size: bytes.length,
        sha256: core.hash(bytes),
        data: bytes.toString("base64"),
      });
    }
    const data = { schema: 1, version, platform, arch: "x64", files };
    core.validatePackage(data, { version, platform });
    const compressed = zlib.gzipSync(JSON.stringify(data), { level: 9 }),
      name = `antigravity-plugin-${version}-${platform}-x64.json.gz`;
    await fs.writeFile(path.join(output, name), compressed);
    packages[platform] = {
      name,
      size: compressed.length,
      sha256: core.hash(compressed),
      arch: "x64",
    };
  }
  await fs.writeFile(
    path.join(output, "plugin-update.json"),
    JSON.stringify(
      { schema: 1, repository: core.REPO, version, packages },
      null,
      2,
    ) + "\n",
  );
  return packages;
}
if (require.main === module)
  build(
    path.resolve(__dirname, ".."),
    path.resolve(process.argv[2] || "output/update"),
  )
    .then((v) => console.log(JSON.stringify(v)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
module.exports = { build };
