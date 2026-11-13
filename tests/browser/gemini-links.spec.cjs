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

test("Antigravity moves beside Share when Gemini opens a conversation", async ({
  page,
}) => {
  await page.route("https://gemini.google.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div class="top-bar-actions"><div class="buttons-container" style="display:flex;justify-content:flex-end"><temp-chat-button><button>Temporary chat</button></temp-chat-button></div></div>',
    }),
  );
  await page.goto("https://gemini.google.com/app");
  await page.evaluate(
    `(${install})({icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',signal:'test-proof',returnLabel:'Return'},${createShortcutRules.toString()},${externalURL.toString()})`,
  );
  await expect(
    page.locator("#agpa-inline-return + temp-chat-button"),
  ).toBeVisible();
  await page.locator(".buttons-container").evaluate((row) => {
    row.querySelector("temp-chat-button").remove();
    row.insertAdjacentHTML(
      "beforeend",
      '<gem-button class="persistent-share-button"><button aria-label="Condividi conversazione">Condividi</button></gem-button><button aria-label="More">⋮</button>',
    );
  });
  const back = page.locator("#agpa-inline-return");
  const share = page.getByRole("button", { name: "Condividi conversazione" });
  await expect(
    page.locator("#agpa-inline-return + .persistent-share-button"),
  ).toBeVisible();
  const [a, b] = await Promise.all([back.boundingBox(), share.boundingBox()]);
  expect(a.x + a.width).toBeLessThanOrEqual(b.x);
  expect(a.y).toBeLessThan(b.y + b.height);
  expect(b.y).toBeLessThan(a.y + a.height);
});
