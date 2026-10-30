"use strict";
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests/browser",
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  outputDir: "output/playwright",
  use: {
    headless: true,
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
});
