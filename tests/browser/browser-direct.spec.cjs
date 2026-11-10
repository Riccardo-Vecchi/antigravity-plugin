"use strict";
const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "../.."),
  script = fs.readFileSync(path.join(root, "common/companion-ui.js"), "utf8");
async function setup(page, enabled = false) {
  await page.route("https://native.test/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<html lang="en"><head></head><body style="background:#111;color:#ddd;font-family:Arial"><main style="width:620px;margin:40px auto"></main></body></html>',
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate((picker) => {
    globalThis.requests = [];
    globalThis.fake = {
      browser: {
        enabled: false,
        registered: false,
        selectedBrowser: "brave",
        available: [
          { id: "brave", label: "Brave" },
          { id: "edge", label: "Edge" },
        ],
        engineAvailable: true,
        connected: false,
        connecting: false,
      },
    };
    globalThis.__AGPAI18n = {
      language: "en",
      t: (k) => k,
      set(n, k, v = {}, attr) {
        attr ? n.setAttribute(attr, k) : (n.textContent = k);
      },
      subscribe: () => () => {},
    };
    globalThis.__AGSettingsNavigation = {
      getPage: () => document.querySelector("main"),
      isOpen: () => true,
    };
    globalThis.__AGNativeMcp = { refresh: async () => true };
    globalThis.__AGPABrowserPicker = eval("(" + picker + ")");
    globalThis.__AGPA_BROWSER_ICONS__ = {};
    globalThis.__agpaCompanion = (raw) => {
      const p = JSON.parse(raw);
      globalThis.requests.push(p);
      if (p.action === "setupBrowser")
        globalThis.fake.browser.enabled =
          globalThis.fake.browser.registered = true;
      if (p.action === "disableBrowser") {
        globalThis.fake.browser.enabled = false;
        globalThis.fake.browser.connected = false;
      }
      if (p.action === "selectBrowser") {
        globalThis.fake.browser.selectedBrowser = p.value;
        globalThis.fake.browser.connected = false;
      }
      queueMicrotask(() =>
        globalThis.__AGCompanion.onResult(
          p.requestId,
          true,
          structuredClone(globalThis.fake),
        ),
      );
    };
  }, require("../../common/browser-picker.cjs").createBrowserPicker.toString());
  if (enabled)
    await page.evaluate(
      () =>
        (globalThis.fake.browser.enabled = globalThis.fake.browser.registered =
          true),
    );
  await page.evaluate(script);
}
test("disabled shows only the switch; enabling shows browser choice and native consent, with no extension UI", async ({
  page,
}) => {
  await setup(page);
  const toggle = page.getByRole("switch", { name: "Browser use" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("button")).toHaveCount(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("combobox")).toContainText("Brave");
  await expect(
    page.getByRole("button", { name: "Connect browser" }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Load unpacked");
  await expect(page.locator("main")).not.toContainText("extension folder");
  await page.getByRole("button", { name: "Connect browser" }).click();
  expect(await page.evaluate(() => globalThis.requests.at(-1).action)).toBe(
    "connectBrowser",
  );
  await toggle.click();
  await expect(page.locator("button")).toHaveCount(1);
});
test("browser choice persists through refresh and a connected state needs no setup controls", async ({
  page,
}) => {
  await setup(page, true);
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Edge" }).click();
  await expect(page.getByRole("combobox")).toContainText("Edge");
  expect(
    await page.evaluate(
      () => globalThis.requests.find((r) => r.action === "selectBrowser").value,
    ),
  ).toBe("edge");
  await page.evaluate(() => {
    globalThis.fake.browser.connected = true;
    globalThis.__AGCompanion.receive(structuredClone(globalThis.fake));
  });
  await expect(page.locator("[data-agpa-browser-connection]")).toHaveAttribute(
    "data-agpa-browser-connection",
    "ready",
  );
  await expect(
    page.getByRole("button", { name: "Connect browser" }),
  ).toHaveCount(0);
  await expect(page.locator("main")).toContainText(
    "Control is released after the task",
  );
});
test("polling preserves an open picker and pending permission has a moving spinner", async ({
  page,
}) => {
  await setup(page, true);
  await page.getByRole("combobox").click();
  await page.evaluate(() => {
    globalThis.fake.browser.connecting = true;
    globalThis.__AGCompanion.receive(structuredClone(globalThis.fake));
  });
  await expect(page.getByRole("combobox")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    globalThis.__AGCompanion.receive(structuredClone(globalThis.fake)),
  );
  const spinner = page.locator(".agpa-comp-spinner");
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveCSS("animation-name", "agpa-browser-spin");
});

test("reopening a recreated settings dialog restores controls even when connection state is unchanged", async ({
  page,
}) => {
  await setup(page, true);
  await expect(page.getByRole("combobox")).toContainText("Brave");
  await page.evaluate(() => {
    document
      .querySelector("main")
      .replaceWith(document.querySelector("main").cloneNode(false));
    window.dispatchEvent(new Event("agpa:settings-page"));
  });
  await expect(page.getByRole("switch", { name: "Browser use" })).toBeVisible();
  await expect(page.getByRole("combobox")).toContainText("Brave");
  await page.evaluate(() => {
    globalThis.fake.browser.connected = true;
    globalThis.__AGCompanion.receive(structuredClone(globalThis.fake));
  });
  await page.evaluate(() => {
    document
      .querySelector("main")
      .replaceWith(document.querySelector("main").cloneNode(false));
    window.dispatchEvent(new Event("agpa:settings-page"));
  });
  await expect(page.locator("[data-agpa-browser-connection]")).toHaveAttribute(
    "data-agpa-browser-connection",
    "ready",
  );
});

test("released browser is ready without claiming active control", async ({
  page,
}) => {
  await setup(page, true);
  await page.evaluate(() => {
    globalThis.fake.browser.connected = true;
    globalThis.fake.browser.active = false;
    globalThis.__AGCompanion.receive(structuredClone(globalThis.fake));
  });
  await expect(page.locator("main")).toContainText("Ready when needed");
  await expect(page.locator("main")).toContainText(
    "Browser control has been released.",
  );
  await expect(
    page.getByRole("button", { name: "Connect browser" }),
  ).toHaveCount(0);
});
