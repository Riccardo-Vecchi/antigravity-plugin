"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../..");
const presentation = fs.readFileSync(
  path.join(root, "common/project-presentation.js"),
  "utf8",
);
const renderer = fs.readFileSync(path.join(root, "common/renderer.js"), "utf8");
async function setup(page, duplicate = false) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<style>body{font:14px system-ui} .w-6{width:24px}.h-6{height:24px}[role=menu]{position:fixed;top:10px;left:100px;z-index:1000;background:white;padding:10px}</style>
 <div><button data-testid="sidebar-search-button">Search</button><button data-testid="sidebar-toggle" aria-expanded="true">Toggle</button></div>
 <div><div><nav role="navigation"><div data-testid="sidebar-navigation-items"><a data-testid="new-conversation-button" href="/">New</a><button data-testid="automations-button">Automations</button></div>
 <div data-sidebar-section-drop-id="project-a"><div><button data-testid="project-header" data-project-label="Demo"><div class="w-6 h-6"><div><svg><path d="M1 1h2"/></svg></div></div>Demo</button></div><button id="project-menu-a" aria-haspopup="menu">Options</button><a href="/?project=project-a">New Conversation in Project</a></div>
 ${duplicate ? '<div data-sidebar-section-drop-id="project-b"><button data-testid="project-header" data-project-label="Demo">Demo</button><a href="/?project=project-b">New</a></div>' : ""}
 <button data-testid="settings-button">Settings</button></nav></div></div>
 <button data-testid="project-selector-trigger"><svg data-project-icon="folder"></svg><span class="truncate">Demo</span></button><main id="conversation"></main>`,
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(() => {
    globalThis.__AGPAI18n = {
      language: "en",
      iconName: (n) => n,
      attrs() {},
      set(n, k, values = {}, attr = "text") {
        if (attr === "text") n.textContent = k;
        else n.setAttribute(attr, k);
      },
      subscribe: () => () => {},
    };
    document.querySelectorAll("a[href]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        history.pushState(null, "", a.getAttribute("href"));
      }),
    );
    globalThis.__AGPAPrimaryLayout = () => ({
      toggle: document.querySelector("[data-testid=sidebar-toggle]"),
    });
    globalThis.__AGPA_CONFIG__ = {
      projects: {
        "project-a": { kind: "icon", icon: "flask", color: "#ff83c2" },
      },
    };
  });
  await page.evaluate(presentation);
  await page.evaluate(() => {
    const original = globalThis.__AGProjectPresentation.projectFrom;
    globalThis.projectReads = 0;
    globalThis.__AGProjectPresentation.projectFrom = (...args) => {
      globalThis.projectReads++;
      return original(...args);
    };
  });
  await page.evaluate(renderer);
}
test("2.29 headers, selectors, edit menus and compact project actions keep stable IDs", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".agpa-project-icon")).toHaveCount(1);
  await expect(page.locator(".agpa-project-icon")).toHaveCSS(
    "color",
    "rgb(255, 131, 194)",
  );
  await expect(page.locator(".agpa-inline-icon")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => globalThis.__AGProjectAppearance.status().projectsResolved,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    document.querySelector("#project-menu-a").click = () =>
      document.querySelector("[role=menu]")?.remove();
    const menu = document.createElement("div");
    menu.role = "menu";
    menu.dataset.open = "";
    menu.setAttribute("aria-labelledby", "project-menu-a");
    menu.innerHTML =
      '<button role="menuitem" data-testid="group-header-settings-item">Project Settings</button>';
    document.body.append(menu);
  });
  await expect(page.locator("[data-agpa-menu-edit]")).toHaveCount(1);
  await page.locator("[data-agpa-menu-edit]").click();
  await expect(page.locator("[data-agpa-editor]")).toBeVisible();
  await page.locator(".agpa-close").click();
  await page
    .locator("[data-testid=sidebar-toggle]")
    .evaluate((n) => n.setAttribute("aria-expanded", "false"));
  const rail = page.locator("[data-agpa-rail]");
  await expect(rail).toBeVisible();
  await expect(
    rail.locator('[data-agpa-native="[data-testid=sidebar-search-button]"]'),
  ).toHaveCount(1);
  await rail.locator("[data-agpa-project=project-a]").click();
  await expect(page).toHaveURL(/project=project-a/);
  await page.evaluate(() => globalThis.__AGProjectAppearance.destroy());
  await expect(
    page.locator(".agpa-project-icon,.agpa-inline-icon,[data-agpa-rail]"),
  ).toHaveCount(0);
  await expect(page.locator("[data-testid=project-header] svg")).toBeVisible();
});
test("ambiguous names never apply a different project color; chat streaming does not rescan projects", async ({
  page,
}) => {
  await setup(page, true);
  await expect(page.locator(".agpa-inline-icon")).toHaveCount(0);
  await page.waitForTimeout(50);
  const before = await page.evaluate(() => globalThis.projectReads);
  await page.evaluate(() => {
    for (let i = 0; i < 200; i++) {
      const text = document.createElement("span");
      text.textContent = "streamed text";
      document.querySelector("#conversation").append(text);
    }
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => globalThis.projectReads)).toBe(before);
  await page.evaluate(() => {
    const section = document.querySelector(
      "[data-sidebar-section-drop-id=project-a]",
    );
    section.setAttribute(
      "data-sidebar-section-drop-id",
      "unconfigured-project",
    );
  });
  await expect(page.locator(".agpa-project-icon")).toHaveCount(0);
});

test("legacy section links retain project identity without the new drop marker", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const section = document.querySelector("[data-sidebar-section-drop-id]");
    section.removeAttribute("data-sidebar-section-drop-id");
    section.querySelector("a").setAttribute("href", "/?section=project-a");
    const header = section.querySelector("[data-testid=project-header]");
    return globalThis.__AGProjectPresentation.projectFrom(header)?.id;
  });
  expect(result).toBe("project-a");
  await page.evaluate(() => globalThis.__AGProjectAppearance.reapply());
  await expect(page.locator(".agpa-project-icon")).toHaveCount(1);
});
