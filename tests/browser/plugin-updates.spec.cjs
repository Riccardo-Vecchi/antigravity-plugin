"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
test("DOM changes during plugin disable keep the correct operation state", async ({
  page,
}) => {
  await page.route("https://native.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<button data-testid="settings-nav-item-App">Application</button><div role="dialog"><div class="p-6"><h2>Application</h2></div></div>',
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(
    (catalogs) => {
      window.__AGPA_TRANSLATIONS__ = catalogs;
    },
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../common/locales.json")),
    ),
  );
  await page.evaluate(
    fs.readFileSync(path.join(__dirname, "../../common/i18n.js"), "utf8"),
  );
  await page.evaluate(() => {
    window.__agpaPluginUpdate = (raw) => {
      const payload = JSON.parse(raw);
      if (payload.action === "enabled") window.pendingDisable = payload;
      else
        queueMicrotask(() =>
          window.__AGPluginUpdates.onResult(payload.requestId, true, {
            pluginEnabled: true,
            current: "fixture",
            automatic: false,
          }),
        );
    };
  });
  await page.evaluate(
    fs.readFileSync(
      path.join(__dirname, "../../common/plugin-update-settings.js"),
      "utf8",
    ),
  );
  await page.evaluate(() => {
    window.__AGPA_APP_SETTINGS__ = {
      version: 2,
      platform: "linux",
      taskbarIcon: "antigravity",
      startupView: "antigravity",
    };
    const icon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    window.__AGPA_APP_ICON_ASSETS__ = { antigravity: icon, gemini: icon };
    window.__agpaAppSettings = (raw) => {
      const payload = JSON.parse(raw);
      if (payload.action === "setStartupView")
        queueMicrotask(() =>
          window.__AGAppSettings.onSaved(payload.requestId, true, null, {
            platform: "linux",
            taskbarIcon: "antigravity",
            startupView: payload.value,
          }),
        );
    };
  });
  await page.evaluate(
    fs.readFileSync(
      path.join(__dirname, "../../common/app-settings.js"),
      "utf8",
    ),
  );
  await expect(
    page.getByText("Plugin customizations", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      "[data-agpa-patch-setting],[data-pu-diagnostics],.agpa-pu-details",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check Plugin Updates", exact: true }),
  ).toBeVisible();
  await page.locator('[data-agpa-startup-view="gemini"]').click();
  await expect(
    page.locator('[data-agpa-startup-view="gemini"]'),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.locator("[data-agpa-startup-setting] [role=status]"),
  ).toHaveText("Saved for the next window.");
  await page.locator("[data-pu-enabled]").click();
  await page.locator("[data-pu-disable-confirm]").click();
  await expect(page.locator("[data-pu-summary]")).toHaveText("Applying…");
  await page.evaluate(() =>
    document.body.append(document.createElement("aside")),
  );
  await expect(page.locator("[data-pu-check] .agpa-pu-spin")).toHaveCount(0);
  await expect(page.locator("[data-pu-summary]")).toHaveText("Applying…");
  await page.evaluate(() =>
    window.__AGPluginUpdates.onResult(window.pendingDisable.requestId, true, {
      pluginEnabled: false,
    }),
  );
  await expect(page.locator("[data-pu-enabled]")).not.toBeChecked();
  await expect(page.locator("[data-pu-enabled]")).toBeEnabled();
});
