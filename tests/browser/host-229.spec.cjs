"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../..");
const presentation = fs.readFileSync(
  path.join(root, "common/project-presentation.js"),
  "utf8",
);
const { primaryLayout } = require("../../common/sidebar-layout.cjs");
const renderer = fs.readFileSync(path.join(root, "common/renderer.js"), "utf8");
async function setup(
  page,
  duplicate = false,
  remote = false,
  knowledge = false,
) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<style>body{font:14px system-ui} .w-6{width:24px}.h-6{height:24px}[role=menu]{position:fixed;top:10px;left:100px;z-index:1000;background:white;padding:10px}</style>
 <div><button data-testid="app-icon-new-conversation-button"></button><button data-testid="sidebar-search-button">Search</button><button data-testid="sidebar-toggle" aria-expanded="true">Toggle</button></div>
 <div data-testid="sidebar-split" style="display:flex;height:400px"><div data-native-sidebar><div><div><nav role="navigation"><div data-testid="sidebar-navigation-items"><a data-testid="new-conversation-button" href="/">New</a><button data-testid="automations-button">Automations</button></div>
 <div data-sidebar-section-drop-id="project-a"><div><button data-testid="project-header" data-project-label="Demo" data-project-icon="${remote ? "cloud" : "folder"}"><div class="w-6 h-6"><div><svg><path d="M1 1h2"/></svg></div></div>Demo</button></div><button id="project-menu-a" aria-haspopup="menu">Options</button><a href="/?project=project-a">New Conversation in Project</a></div>
 ${duplicate ? '<div data-sidebar-section-drop-id="project-b"><button data-testid="project-header" data-project-label="Demo">Demo</button><a href="/?project=project-b">New</a></div>' : ""}
 <button data-testid="settings-button">Settings</button></nav></div></div></div><main><aside aria-label="Overview">${knowledge ? '<button>Folders</button><section aria-label="Documents"></section>' : "<button>Review</button><button>Files</button><button>Terminal</button>"}</aside></main></div>
 <button data-testid="project-selector-trigger"><svg data-project-icon="${remote ? "cloud" : "folder"}"></svg><span class="truncate">Demo</span></button><main id="conversation"></main>`,
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(() => {
    globalThis.__AGPAI18n = {
      language: "en",
      t: (key) => key,
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
  await page.evaluate(
    `globalThis.__AGPAPrimaryLayout=${primaryLayout.toString()}`,
  );
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

test("customized remote projects retain a cloud badge across sidebar, selectors, compact rail and Settings", async ({
  page,
}) => {
  await setup(page, false, true);
  await expect(
    page.locator(".agpa-project-icon > [data-agpa-remote-badge]"),
  ).toHaveCount(1);
  await expect(
    page.locator(".agpa-inline-icon > [data-agpa-remote-badge]"),
  ).toHaveCount(1);
  const badge = page.locator(".agpa-project-icon > [data-agpa-remote-badge]");
  const iconRect = await page.locator(".agpa-project-icon").boundingBox(),
    badgeRect = await badge.boundingBox();
  expect(badgeRect.x + badgeRect.width / 2).toBeGreaterThan(
    iconRect.x + iconRect.width / 2,
  );
  expect(badgeRect.y + badgeRect.height / 2).toBeGreaterThan(
    iconRect.y + iconRect.height / 2,
  );
  expect(badgeRect.x + badgeRect.width).toBeLessThanOrEqual(
    iconRect.x + iconRect.width + 4,
  );
  expect(badgeRect.width).toBeLessThanOrEqual(12);
  await expect(badge).toHaveCSS("border-top-width", "0px");
  await expect(badge).toHaveCSS("box-shadow", "none");
  await page
    .locator("[data-testid=sidebar-toggle]")
    .evaluate((n) => n.setAttribute("aria-expanded", "false"));
  await expect(
    page.locator(
      "[data-agpa-rail] [data-agpa-project=project-a] [data-agpa-remote-badge]",
    ),
  ).toHaveCount(1);
  await expect(
    page.locator("[data-agpa-rail] [data-agpa-project=project-a]"),
  ).toHaveAttribute("aria-label", "Demo (Remote project)");
  await page.evaluate(() => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML =
      '<div><button data-testid="settings-nav-item-App"><span>Application</span></button></div><button data-testid="settings-nav-item-project-a"><span>Demo</span></button>';
    document.body.append(dialog);
    globalThis.__AGPA_SETTINGS_PROJECT_STYLES__ = {
      projects: {
        "project-a": { kind: "emoji", emoji: "🎮", color: "#b17afb" },
      },
    };
  });
  await page.evaluate(
    fs.readFileSync(path.join(root, "common/settings-navigation.js"), "utf8"),
  );
  await expect(
    page.locator(
      "[data-testid=settings-nav-item-project-a] [data-agpa-remote-badge]",
    ),
  ).toHaveCount(1);
  await page.evaluate(() => {
    document
      .querySelector("[data-testid=project-header]")
      .setAttribute("data-project-icon", "folder");
    document
      .querySelector(
        "[data-testid=project-selector-trigger] > [data-project-icon]",
      )
      .setAttribute("data-project-icon", "folder");
  });
  await expect(page.locator("[data-agpa-remote-badge]")).toHaveCount(0);
  await expect(page.locator(".agpa-project-icon")).toHaveCount(1);
});
test("local cloud artwork never implies remote execution, and clearing remote customization restores native clouds", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    globalThis.__AGProjectAppearance.setConfig({
      projects: {
        "project-a": { kind: "icon", icon: "cloud", color: "#329bff" },
      },
    }),
  );
  await expect(page.locator(".agpa-project-icon")).toHaveCount(1);
  await expect(page.locator("[data-agpa-remote-badge]")).toHaveCount(0);
  await page.evaluate(() => {
    document
      .querySelector("[data-testid=project-header]")
      .setAttribute("data-project-icon", "cloud");
    document
      .querySelector(
        "[data-testid=project-selector-trigger] > [data-project-icon]",
      )
      .setAttribute("data-project-icon", "cloud");
    globalThis.__AGProjectAppearance.setConfig({
      projects: {
        "project-a": { kind: "emoji", emoji: "🎮", color: "#b17afb" },
      },
    });
  });
  await expect(
    page.locator(".agpa-project-icon > [data-agpa-remote-badge]"),
  ).toHaveCount(1);
  await expect(page.locator(".agpa-inline-icon")).toContainText("🎮");
  await page.evaluate(() =>
    globalThis.__AGProjectAppearance.setConfig({ projects: {} }),
  );
  await expect(page.locator("[data-agpa-remote-badge]")).toHaveCount(0);
  await expect(
    page.locator(
      "[data-testid=project-selector-trigger] > [data-project-icon=cloud]",
    ),
  ).toBeVisible();
  await expect(page.locator("[data-testid=project-header] svg")).toBeVisible();
  await page.evaluate(() => {
    globalThis.__AGProjectAppearance.destroy();
    globalThis.__AGProjectPresentation.destroy();
  });
  await expect(
    page.locator("[data-agpa-remote-host],#agpa-remote-project-styles"),
  ).toHaveCount(0);
});

test("pinned and grouped conversation subtitles keep custom icons without visible project headers", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const records = [
      { project: { id: "project-a", name: "Demo" } },
      { project: { id: "project-remote", name: "Remote demo" } },
    ];
    const service = {
      richProjectsProvider: {
        getState: () => new Map(records.map((r) => [r.project.id, r])),
      },
      cloudProjectIds: ["project-remote"],
    };
    globalThis.projectRegistry = records;
    document.querySelector(
      "[data-testid=settings-button]",
    ).__reactFiber$fixture = {
      memoizedProps: { value: { core: { projectManagementService: service } } },
    };
    for (const el of document.querySelectorAll(
      "[data-sidebar-section-drop-id]",
    ))
      el.remove();
    const nav = document.querySelector("[role=navigation]");
    for (const [key, label, glyph] of [
      ["pinned", "Demo", "folder"],
      ["remote", "Remote demo", "cloud"],
      ["unknown", "Unconfigured", "folder"],
    ]) {
      const row = document.createElement("div");
      row.dataset.testid = "conversation-row-sidebar";
      row.dataset.subtext = label;
      row.dataset.fixture = key;
      if (key === "pinned") row.dataset.pinned = "true";
      const title = document.createElement("span");
      title.textContent = "Conversation";
      const subtitle = document.createElement("span");
      subtitle.className = "subtitle";
      subtitle.innerHTML =
        '<svg width="14" height="14" data-project-glyph="' +
        glyph +
        '"></svg><span>' +
        label +
        "</span>";
      row.append(title, subtitle);
      nav.append(row);
    }
    globalThis.__AGProjectAppearance.setConfig({
      projects: {
        "project-a": { kind: "icon", icon: "flask", color: "#ff83c2" },
        "project-remote": { kind: "emoji", emoji: "🎮", color: "#b17afb" },
      },
    });
  });
  const pinned = page.locator("[data-fixture=pinned]"),
    remote = page.locator("[data-fixture=remote]");
  await expect(pinned.locator(".agpa-inline-icon")).toHaveCSS(
    "color",
    "rgb(255, 131, 194)",
  );
  await expect(pinned.locator("[data-project-glyph]")).toBeHidden();
  await expect(remote.locator(".agpa-inline-icon")).toContainText("🎮");
  await expect(remote.locator("[data-agpa-remote-badge] svg")).toHaveAttribute(
    "viewBox",
    "40 -800 880 660",
  );
  await expect(
    page.locator("[data-fixture=unknown] .agpa-inline-icon"),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const row = document.querySelector("[data-fixture=pinned]");
    row.dataset.subtext = "Remote demo";
    row
      .querySelector("[data-project-glyph]")
      .setAttribute("data-project-glyph", "cloud");
    row.querySelector(".subtitle > span:last-child").textContent =
      "Remote demo";
  });
  await expect(pinned.locator(".agpa-inline-icon")).toContainText("🎮");
  await expect(pinned.locator("[data-agpa-remote-badge]")).toHaveCount(1);
  await page.evaluate(() =>
    document
      .querySelector("[data-fixture=pinned] [data-project-glyph]")
      .remove(),
  );
  await expect(pinned.locator(".agpa-inline-icon")).toHaveCount(0);
  await page.evaluate(() =>
    globalThis.__AGProjectAppearance.setConfig({ projects: {} }),
  );
  await expect(remote.locator(".agpa-inline-icon")).toHaveCount(0);
  await expect(remote.locator("[data-project-glyph]")).toBeVisible();
});
test("duplicate registry names never apply another project's appearance to a conversation", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const records = new Map([
      ["project-a", { project: { id: "project-a", name: "Demo" } }],
      ["project-b", { project: { id: "project-b", name: "Demo" } }],
    ]);
    document.querySelector(
      "[data-testid=settings-button]",
    ).__reactFiber$fixture = {
      memoizedProps: {
        value: {
          core: {
            projectManagementService: {
              richProjectsProvider: { getState: () => records },
              cloudProjectIds: [],
            },
          },
        },
      },
    };
    document
      .querySelectorAll("[data-sidebar-section-drop-id]")
      .forEach((n) => n.remove());
    const row = document.createElement("div");
    row.dataset.testid = "conversation-row-sidebar";
    row.dataset.subtext = "Demo";
    row.innerHTML =
      '<span><svg width="14" data-project-glyph="folder"></svg><span>Demo</span></span>';
    document.body.append(row);
  });
  await expect(
    page.locator("[data-testid=conversation-row-sidebar] [data-project-glyph]"),
  ).toBeVisible();
  await expect(
    page.locator("[data-testid=conversation-row-sidebar] .agpa-inline-icon"),
  ).toHaveCount(0);
});

test("presentation reload repairs badges even while project styling signatures are cached", async ({
  page,
}) => {
  await setup(page, false, true);
  await expect(
    page.locator(".agpa-project-icon > [data-agpa-remote-badge]"),
  ).toBeVisible();
  await page.evaluate(() => globalThis.__AGProjectPresentation.destroy());
  await page.evaluate(presentation);
  const badge = page.locator(".agpa-project-icon > [data-agpa-remote-badge]");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveCSS("border-top-width", "0px");
});

test("Computer use and Browser use navigation inherit native text size", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent =
      "[role=dialog] button{font-size:14px;line-height:20px}.text-sm{font-size:12px}";
    document.head.append(style);
    const dialog = document.createElement("div");
    dialog.role = "dialog";
    dialog.innerHTML =
      '<div><button data-testid="settings-nav-item-App"><span>Application</span></button></div>';
    document.body.append(dialog);
  });
  await page.evaluate(
    fs.readFileSync(path.join(root, "common/settings-navigation.js"), "utf8"),
  );
  for (const key of ["computer", "browser"]) {
    await expect(
      page.locator(`[data-agpa-plugin-nav=${key}] > span`),
    ).toHaveCSS("font-size", "14px");
    await expect(
      page.locator(`[data-agpa-plugin-nav=${key}] > span`),
    ).toHaveCSS("line-height", "20px");
  }
});

for (const layout of ["Software Engineering", "Knowledge Work"])
  test(`compact navigation stays outside the zero-width native pane in ${layout}`, async ({
    page,
  }) => {
    await setup(page, false, false, layout === "Knowledge Work");
    await page.evaluate(() => {
      document.querySelector("[data-native-sidebar]").style.cssText =
        "width:0; overflow:hidden";
      document
        .querySelector("[data-testid=sidebar-toggle]")
        .setAttribute("aria-expanded", "false");
    });
    const rail = page.locator("[data-testid=sidebar-split] > [data-agpa-rail]");
    await expect(
      rail.getByRole("button", { name: "Automations" }),
    ).toBeInViewport();
    await expect(rail.getByRole("button", { name: "Demo" })).toBeInViewport();
    await expect(
      rail.getByRole("button", { name: "Settings" }),
    ).toBeInViewport();
    const overview = page.getByRole("complementary", { name: "Overview" });
    await expect(
      overview.getByRole("button", {
        name: layout === "Knowledge Work" ? "Folders" : "Review",
      }),
    ).toBeVisible();
  });

test("project search resolves exact IDs and the composer supports wrapped icons", async ({
  page,
}) => {
  await setup(page, true, true);
  await page.evaluate(() => {
    const trigger = document.querySelector(
      "[data-testid=project-selector-trigger]",
    );
    const native = trigger.querySelector("svg");
    const wrapper = document.createElement("span");
    trigger.prepend(wrapper);
    wrapper.append(native);
    const header = document.querySelector(
      "[data-sidebar-section-drop-id=project-b] [data-testid=project-header]",
    );
    header.setAttribute("data-project-label", "Different");
    const dialog = document.createElement("div");
    dialog.innerHTML =
      '<input data-testid="fastpick-input" aria-controls="search-list"><div role="listbox" id="search-list"></div>';
    const list = dialog.lastElementChild;
    for (const id of ["project-a", "project-b", "conversation-a"]) {
      const option = document.createElement("div");
      option.role = "option";
      option.dataset.itemId = id;
      option.dataset.testid = "fastpick-item-" + id;
      option.innerHTML =
        id === "conversation-a"
          ? '<div><span><svg width="14" data-project-glyph="cloud"></svg><span>Demo</span></span></div>'
          : '<div><svg width="14"></svg><span>Demo</span></div>';
      list.append(option);
    }
    document.body.append(dialog);
  });
  const trigger = page.getByTestId("project-selector-trigger");
  await expect(
    trigger.locator("span > .agpa-inline-icon [data-agpa-remote-badge]"),
  ).toBeVisible();
  const project = page.getByTestId("fastpick-item-project-a");
  await expect(project.locator(".agpa-inline-icon")).toHaveCSS(
    "color",
    "rgb(255, 131, 194)",
  );
  await expect(project.locator("[data-agpa-remote-badge]")).toBeVisible();
  await expect(
    page.getByTestId("fastpick-item-project-b").locator(".agpa-inline-icon"),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("fastpick-item-conversation-a")
      .locator("[data-agpa-conversation-project] [data-agpa-remote-badge]"),
  ).toBeVisible();
  await project.evaluate((row) =>
    row.setAttribute("data-item-id", "conversation-b"),
  );
  await expect(project.locator(".agpa-inline-icon")).toHaveCount(0);
  await expect(project.locator("svg")).toBeVisible();
});
