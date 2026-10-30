"use strict";
const js = require("@eslint/js"),
  globals = require("globals");
module.exports = [
  {
    ignores: [
      "node_modules/**",
      "assets/**",
      "output/**",
      "evidence/**",
      "diagnostics/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        chrome: "readonly",
        AGPA_PDF_WORKER: "readonly",
      },
    },
    rules: {
      // Empty catches are intentional for optional integrations and cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Configuration and text-input validators deliberately reject controls.
      "no-control-regex": "off",
      "no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["common/browser-extension/worker.js"],
    languageOptions: { globals: { ...globals.worker, AGPApolicy: "readonly" } },
  },
  {
    files: ["tests/fixtures/*.cjs"],
    languageOptions: {
      globals: { fixture: "readonly", __AGModelControls: "readonly" },
    },
  },
  {
    files: ["tests/browser/*.cjs"],
    languageOptions: {
      globals: {
        navigate: "readonly",
        testGuest: "readonly",
        __AGGeminiOrigin: "readonly",
        __AGPAI18n: "readonly",
        __AGLibrary: "readonly",
      },
    },
  },
];
