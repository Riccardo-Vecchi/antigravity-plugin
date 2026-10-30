"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { classifyGuestURL } = require("../../common/gemini-origin.cjs");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/gemini-origin.js"),
  "utf8",
);

async function setup(page) {
  await page.route("https://native.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://native.test/");
  await page.setContent(
    '<title>Native conversation</title><dialog class="agpa-gemini" data-agpa-gemini open><webview></webview></dialog>',
  );
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
    const guest = document.querySelector("webview");
    window.testGuest = guest;
    guest.url = "https://gemini.google.com/app";
    guest.getURL = () => guest.url;
    window.navigate = (url, eventName = "did-navigate", isMainFrame = true) => {
      if (isMainFrame) guest.url = url;
      const event = new Event(eventName);
      Object.assign(event, { url, isMainFrame });
      guest.dispatchEvent(event);
    };
  });
  await page.evaluate(
    `globalThis.__AGPAClassifyGuestURL=${classifyGuestURL.toString()}`,
  );
  await page.evaluate(source);
}
test("host identity follows authentication, redirects, history and unknown pages", async ({
  page,
}) => {
  await setup(page);
  const strip = page.locator("[data-agpa-guest-identity]");
  await expect(strip).toBeHidden();
  await page.evaluate(() =>
    navigate("https://accounts.google.com/login?token=secret"),
  );
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Google sign-in");
  await expect(page.locator("webview")).toHaveAttribute(
    "aria-label",
    "Google sign-in — https://accounts.google.com",
  );
  await expect(page.locator("dialog")).toHaveAttribute(
    "aria-label",
    "Google sign-in — https://accounts.google.com",
  );
  await expect(strip).not.toContainText("secret");
  await page.evaluate(() =>
    navigate("https://sso.example/login", "did-redirect-navigation"),
  );
  await expect(strip).toContainText("https://sso.example");
  await page.evaluate(() =>
    navigate("https://gemini.google.com/app", "did-navigate-in-page", false),
  );
  await expect(strip).toContainText("https://sso.example");
  for (const url of [
    "data:text/html,hello",
    "about:blank",
    "blob:https://gemini.google.com/id",
    "malformed",
  ]) {
    await page.evaluate((url) => navigate(url), url);
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Origin unavailable");
  }
  await page.evaluate(() =>
    navigate("https://gemini.google.com/app", "did-navigate-in-page"),
  );
  await expect(strip).toBeHidden();
});
test("navigation start cannot hide a foreign identity before Gemini commits", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    navigate("https://evil.example", "did-start-navigation"),
  );
  await expect(page.locator("[data-agpa-guest-identity]")).toContainText(
    "https://evil.example",
  );
  await page.evaluate(() =>
    navigate("https://gemini.google.com", "did-start-navigation"),
  );
  await expect(page.locator("[data-agpa-guest-identity]")).toBeVisible();
  await page.evaluate(() => navigate("https://gemini.google.com"));
  await expect(page.locator("[data-agpa-guest-identity]")).toBeHidden();
});
test("adoption, reload handoff, guest replacement and cleanup preserve the guest", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(source);
  await expect(page.locator("[data-agpa-guest-identity]")).toHaveCount(1);
  expect(
    await page.evaluate(() => document.querySelector("webview") === testGuest),
  ).toBe(true);
  await page.evaluate(() => {
    __AGGeminiOrigin.destroy();
    testGuest.url = "https://sso.example";
  });
  await page.evaluate(
    `globalThis.__AGPAClassifyGuestURL=${classifyGuestURL.toString()}`,
  );
  await page.evaluate(source);
  await expect(page.locator("[data-agpa-guest-identity]")).toContainText(
    "https://sso.example",
  );
  expect(
    await page.evaluate(() => document.querySelector("webview") === testGuest),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Return to Gemini", exact: true })
    .click();
  expect(await page.evaluate(() => testGuest.src)).toBe(
    "https://gemini.google.com/",
  );
  await page.evaluate(() => {
    const next = document.createElement("webview");
    next.getURL = () => "https://other.example";
    testGuest.replaceWith(next);
  });
  await expect(page.locator("[data-agpa-guest-identity]")).toContainText(
    "https://other.example",
  );
  await page.evaluate(() => __AGGeminiOrigin.destroy());
  await expect(page.locator("webview")).toHaveCount(1);
  await expect(page.locator("[data-agpa-guest-identity]")).toHaveCount(0);
});
test("native window and menu identities follow the guest and restore on close", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const menu = document.createElement("nav");
    menu.dataset.testid = "title-menu-bar";
    document.body.prepend(menu);
    window.__AGPA_WORKSPACE__ = { sidebarMode: null };
    window.__AGPAPrimaryLayout = () => ({});
    window.__AGPACreateHoverIntent = () => ({ hide() {}, destroy() {} });
  });
  await page.evaluate(
    fs.readFileSync(
      path.join(__dirname, "../../common/workspace-ui.js"),
      "utf8",
    ),
  );
  await expect(page).toHaveTitle("Google Gemini");
  await page.evaluate(() => navigate("https://sso.example/login?token=secret"));
  await expect(page).toHaveTitle("External website — https://sso.example");
  await expect(page.locator("[data-agpa-gemini-menu-title]")).toHaveText(
    "External website — https://sso.example",
  );
  await page.evaluate(() => navigate("about:blank"));
  await expect(page).toHaveTitle("Web page");
  await page.evaluate(() => document.querySelector("dialog").close());
  await expect(page).toHaveTitle("Native conversation");
  expect(
    await page.evaluate(() => document.querySelector("webview") === testGuest),
  ).toBe(true);
});
test("a script in an opaque guest document cannot remove host-owned identity", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    navigate("https://external.example");
    const frame = document.createElement("iframe");
    frame.sandbox = "allow-scripts";
    frame.srcdoc = `<body><script>try{parent.document.querySelector('[data-agpa-guest-identity]').remove()}catch{document.body.textContent='isolated'}</script>`;
    testGuest.append(frame);
  });
  await expect(page.frameLocator("iframe").locator("body")).toHaveText(
    "isolated",
  );
  await expect(page.locator("[data-agpa-guest-identity]")).toBeVisible();
});
test("recovery buttons remain clickable with the real inline fallback styles", async ({
  page,
}) => {
  await setup(page);
  await page.addStyleTag({
    content: fs.readFileSync(
      path.join(__dirname, "../../common/gemini-switch.css"),
      "utf8",
    ),
  });
  await page.evaluate(() => {
    window.__AGGeminiSwitch = { version: "fixture" };
    window.__AGPA_INLINE_ICON__ =
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    const native = document.createElement("button");
    native.setAttribute("data-agpa-return-antigravity", "");
    native.onclick = () => document.querySelector("dialog").close();
    document.querySelector("dialog").append(native);
    navigate("https://external.example");
  });
  await page.evaluate(
    fs.readFileSync(
      path.join(__dirname, "../../common/gemini-inline.js"),
      "utf8",
    ),
  );
  await expect(page.locator(".agpa-gemini-fallback")).toBeHidden();
  await page
    .getByRole("button", { name: "Return to Gemini", exact: true })
    .click();
  expect(await page.evaluate(() => testGuest.src)).toBe(
    "https://gemini.google.com/",
  );
  await page
    .getByRole("button", { name: "Return to Antigravity", exact: true })
    .click();
  await expect(page.locator("dialog")).not.toBeVisible();
});

test("origin and accessible labels follow the native app language", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => navigate("https://sso.example"));
  await page.evaluate(() => (document.documentElement.lang = "it"));
  await expect(page.locator("[data-agpa-guest-identity]")).toContainText(
    "Sito esterno",
  );
  await expect(page.locator("webview")).toHaveAttribute(
    "aria-label",
    "Sito esterno — https://sso.example",
  );
  await page.evaluate(() => {
    navigate("about:blank");
    document.documentElement.lang = "de";
  });
  await expect(page.locator("webview")).toHaveAttribute(
    "aria-label",
    "Webseite",
  );
});
