"use strict";
const { test, expect } = require("@playwright/test"),
  fs = require("node:fs");
const { externalURL } = require("../../common/gemini-links.cjs"),
  { createShortcutRules } = require("../../common/shortcut-config.cjs");
const source = fs.readFileSync(
  require.resolve("../../common/gemini-inline.js"),
  "utf8",
);
const install = source.slice(
  source.indexOf("function installInGuest("),
  source.indexOf("\n  async function isolated"),
);
test("trusted outbound links route externally once while sign-in and internal links retain native behavior", async ({
  page,
}) => {
  const opened = [];
  page.on("console", (msg) => {
    if (msg.text().startsWith("test-proof:external:"))
      opened.push(JSON.parse(msg.text().slice("test-proof:external:".length)));
  });
  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<a id="activity" href="https://myactivity.google.com/product/gemini" target="_blank">Activity</a><a id="internal" href="#section">Internal</a><a id="signin" href="https://accounts.google.com/signin">Sign in</a><a id="unsafe" href="javascript:void(0)">Unsafe</a>',
    }),
  );
  await page.goto("https://gemini.google.com/app");
  await page.evaluate(
    `(${install})({icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',signal:'test-proof',returnLabel:'Return'},${createShortcutRules.toString()},${externalURL.toString()})`,
  );
  await page.evaluate(() => document.querySelector("#activity").click());
  expect(opened).toEqual([]);
  await page.locator("#activity").click();
  await expect.poll(() => opened.length).toBe(1);
  expect(opened[0]).toBe("https://myactivity.google.com/product/gemini");
  expect(page.url()).toBe("https://gemini.google.com/app");
  await page.locator("#internal").click();
  expect(page.url()).toMatch(/#section$/);
  expect(opened).toHaveLength(1);
  await page.locator("#unsafe").click();
  expect(opened).toHaveLength(1);
  await page.locator("#signin").click();
  await expect(page).toHaveURL("https://accounts.google.com/signin");
  expect(opened).toHaveLength(1);
});
