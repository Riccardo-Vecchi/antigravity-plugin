"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "../../common/browser-extension"),
  messages = require("../../common/browser-extension/_locales/en/messages.json");
async function setup(page, allow = true) {
  await page.route("https://extension.test/**", (route) => {
    const file =
      new URL(route.request().url()).pathname.slice(1) || "popup.html";
    if (
      !["popup.html", "popup.js", "popup.css", "assets/icon32.png"].includes(
        file,
      )
    )
      return route.abort();
    return route.fulfill({
      body: fs.readFileSync(path.join(root, file)),
      contentType: file.endsWith("js")
        ? "text/javascript"
        : file.endsWith("css")
          ? "text/css"
          : file.endsWith("png")
            ? "image/png"
            : "text/html",
    });
  });
  await page.addInitScript(
    ({ allow, messages }) => {
      const state = {
        ready: true,
        scope: "tabs",
        profile: { label: "Test browser" },
        shared: [],
        current: { id: 1, shared: false },
      };
      globalThis.mock = { state, requests: [], gestures: [] };
      globalThis.chrome = {
        i18n: { getMessage: (key) => messages[key]?.message || key },
        permissions: {
          async request() {
            globalThis.mock.gestures.push(navigator.userActivation.isActive);
            return allow;
          },
        },
        runtime: {
          async sendMessage({ action, ...args }) {
            globalThis.mock.requests.push(action);
            if (action === "scope") {
              state.scope = args.scope;
              state.shared =
                args.scope === "profile"
                  ? [{ id: 1, title: "Example page" }]
                  : [];
            }
            if (action === "revokeAll") {
              state.scope = "tabs";
              state.shared = [];
            }
            return { ok: true, result: structuredClone(state) };
          },
        },
      };
    },
    { allow, messages },
  );
  await page.goto("https://extension.test/popup.html");
}
test("one primary browser connection authorizes once from a gesture; disconnect restores onboarding", async ({
  page,
}) => {
  await setup(page);
  const connect = page.getByRole("button", {
    name: "Connect this browser",
    exact: true,
  });
  await expect(connect).toBeVisible();
  await expect(page.locator("#scope")).toBeHidden();
  await connect.click();
  await expect(page.locator("#accessTitle")).toHaveText(
    "Ready for Antigravity",
  );
  await expect(connect).toBeHidden();
  expect(await page.evaluate(() => globalThis.mock.gestures)).toEqual([true]);
  await expect(page.locator("#accessHelp")).toContainText(
    "No need to share tabs one by one",
  );
  await page
    .getByRole("button", { name: "Disconnect this browser", exact: true })
    .click();
  await expect(connect).toBeVisible();
  await page.getByText("Access settings", { exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /Selected tabs/ }),
  ).toBeChecked();
});
test("declining optional tab permission leaves manual sharing intact", async ({
  page,
}) => {
  await setup(page, false);
  await page
    .getByRole("button", { name: "Connect this browser", exact: true })
    .click();
  await expect(page.locator("#error")).toContainText(
    "Allow access to all tabs",
  );
  expect(await page.evaluate(() => globalThis.mock.state.scope)).toBe("tabs");
  expect(
    await page.evaluate(() => globalThis.mock.requests.includes("scope")),
  ).toBe(false);
  await page.getByText("Access settings", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Share this tab", exact: true }),
  ).toBeVisible();
});
