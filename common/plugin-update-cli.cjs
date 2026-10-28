#!/usr/bin/env node
"use strict";
const path = require("node:path");
const root = path.resolve(process.argv[3] || path.join(__dirname, ".."));
if (process.argv[2] !== "receipt") throw Error("Expected receipt command.");
require("./plugin-update-core.cjs")
  .receipt(
    root,
    process.platform,
    require(path.join(root, "common/versions.cjs")).suite,
  )
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
