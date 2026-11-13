"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const {
  connectionChecks,
  accessChanged,
  controlState,
} = require("../../common/computer-use-checks.cjs");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/computer-use-settings.js"),
  "utf8",
);

async function setup(page, state = {}) {
  await page.route("https://native.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main><div class="agpa-settings-page-title"><h2>Computer use</h2></div></main>',
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate((patch) => {
    window.fixtureState = {
      platform: "linux",
      session: "wayland",
      scope: "desktop",
      enabled: true,
      installed: true,
      registered: true,
      driverVersion: "0.47.23",
      protocol: { ok: true, desktop: { ok: true } },
      ...patch,
    };
    window.fixtureActions = [];
    window.__AGPAI18n = {
      attrs() {},
      set(element, value, params = {}, attr) {
        const label = value.replace(
          /\{(\w+)\}/g,
          (_, key) => params[key] || "",
        );
        if (attr) element.setAttribute(attr, label);
        else if (element.textContent !== label) element.textContent = label;
      },
      subscribe: () => () => {},
    };
    window.__AGSettingsNavigation = {
      getPage: () => document.querySelector("main"),
      isOpen: () => true,
    };
    window.__AGNativeMcp = {
      status: () => ({ detected: true }),
      refresh: () => new Promise(() => {}),
    };
    window.__agpaComputerUse = (payload) => {
      const { requestId, action, value } = JSON.parse(payload);
      window.fixtureActions.push({ action, value });
      if (action === "disconnect") window.fixtureState.enabled = false;
      if (action === "setup") Object.assign(window.fixtureState, value);
      queueMicrotask(() =>
        window.__AGComputerUse.onResult(requestId, true, window.fixtureState),
      );
    };
  }, state);
  await page.evaluate(`
    globalThis.__AGPAComputerUseChecks=${connectionChecks};
    globalThis.__AGPAComputerUseAccessChanged=${accessChanged};
    globalThis.__AGPAComputerUseControlState=${controlState};
  `);
  await page.evaluate(source);
}

test("connected settings keep diagnostics and removal behind details", async ({
  page,
}) => {
  await setup(page);
  const toggle = page.getByRole("switch", { name: "Computer use" });
  await expect(page.locator(".agpa-settings-page-title")).toContainText(
    "Computer use",
  );
  await expect(toggle).toBeChecked();
  await expect(page.locator("summary")).toContainText("Connected");
  await expect(page.locator(".agpa-cu-scope-option svg")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Remove computer use" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Apply access changes" }),
  ).toBeHidden();
  await page.locator("summary").click();
  await expect(
    page.getByRole("button", { name: "Remove computer use" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove computer use" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByText("Selected apps", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply access changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Allowed application executables" }),
  ).toBeVisible();
  await page.getByText("Entire desktop", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply access changes" }),
  ).toBeHidden();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByText("Let Antigravity use your desktop."),
  ).toBeVisible();
  await expect(page.locator("summary")).toBeHidden();
  await expect(page.getByText("Access scope")).toBeHidden();
});

test("a required Linux sign-in shows the recovery instructions with details closed", async ({
  page,
}) => {
  await setup(page, {
    needsHelper: true,
    helperInstalled: true,
    helperState: "signInRequired",
  });
  await expect(page.locator("summary")).toContainText("Needs attention");
  await expect(page.locator("[data-cu-operation]")).toContainText(
    "Log out of Linux",
  );
  await expect(page.locator(".agpa-cu-advanced")).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.locator(".agpa-cu-advanced")).toHaveAttribute("open", "");
  await expect(page.locator("[data-cu-status]")).toBeFocused();
});

test("disconnect releases the switch before native refresh finishes", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const request = window.__agpaComputerUse;
    window.__agpaComputerUse = (payload) => {
      if (JSON.parse(payload).action === "disconnect")
        window.finishDisconnect = () => request(payload);
      else request(payload);
    };
  });
  const toggle = page.getByRole("switch", { name: "Computer use" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.locator("[data-cu-operation]")).toHaveText("Disabling…");
  await expect(toggle).toBeDisabled();
  await page.evaluate(() => window.finishDisconnect());
  await expect(toggle).toBeEnabled({ timeout: 1500 });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("[data-cu-operation]")).toBeHidden();
  expect(
    await page.evaluate(() => window.__AGComputerUse.status().installed),
  ).toBe(true);
  await toggle.click();
  await expect(page.locator("[data-cu-progress-dialog]")).toBeHidden();
  expect(await page.evaluate(() => window.fixtureActions.at(-1).action)).toBe(
    "setup",
  );
});

test("a driver check keeps the installed driver marked passed", async ({
  page,
}) => {
  await setup(page, { operation: "check", progress: { step: "driver" } });
  await page.locator("summary").click();
  const driver = page.locator("[data-cu-checks] [data-cu-check-id=driver]");
  await expect(driver).toContainText("Passed");
  await expect(driver).toContainText("0.47.23");
  await expect(driver.locator(".agpa-cu-spinner")).toHaveCount(0);
});
