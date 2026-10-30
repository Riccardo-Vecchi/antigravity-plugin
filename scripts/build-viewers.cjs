"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path");
async function build() {
  const root = path.resolve(__dirname, ".."),
    out = path.join(root, "assets", "viewers");
  await fs.mkdir(out, { recursive: true });
  const worker = await fs.readFile(
    path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    "utf8",
  );
  const result = await require("esbuild").build({
    entryPoints: [path.join(root, "common/viewers.js")],
    outfile: path.join(out, "viewers.js"),
    bundle: true,
    metafile: true,
    minify: true,
    format: "iife",
    target: "chrome130",
    legalComments: "eof",
    loader: { ".css": "text" },
    define: { AGPA_PDF_WORKER: JSON.stringify(worker) },
    logOverride: { "empty-import-meta": "silent" },
  });
  // Only licenses for code actually included in the shipped bundle. Developer
  // tools in package-lock.json do not belong in the runtime's vendor notices.
  const packages = new Map();
  const modules = path.join(root, "node_modules") + path.sep;
  for (const input of Object.keys(result.metafile.inputs)) {
    let dir = path.dirname(path.resolve(root, input));
    while (dir.startsWith(modules)) {
      try {
        const pkg = JSON.parse(
          await fs.readFile(path.join(dir, "package.json"), "utf8"),
        );
        packages.set(dir, pkg);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      dir = path.dirname(dir);
    }
  }
  let notices =
    "Vendored preview libraries. Plugin source is 0BSD; these packages retain their own licenses.\n";
  for (const [dir, pkg] of [...packages].sort((a, b) =>
    a[1].name.localeCompare(b[1].name, "en"),
  )) {
    const name = pkg.name,
      files = (await fs.readdir(dir)).filter((f) =>
        /^licen[sc]e|^copying/i.test(f),
      );
    notices += `\n--- ${name} ${pkg.version} (${pkg.license}) ---\n`;
    if (files.length)
      for (const f of files)
        notices += (await fs.readFile(path.join(dir, f), "utf8")) + "\n";
    else {
      const readme = await fs.readFile(path.join(dir, "README.md"), "utf8");
      const start = readme.search(/^#+\s*licen[sc]e/im);
      if (start < 0) throw Error("Missing license for " + name);
      notices += readme.slice(start) + "\n";
    }
  }
  await fs.writeFile(path.join(out, "LICENSES.txt"), notices);
}
build().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
