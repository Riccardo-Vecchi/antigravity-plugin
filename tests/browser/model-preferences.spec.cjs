"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/model-ui.js"),
  "utf8",
);
const { providerFor } = require("../../common/model-preferences.cjs");
async function setup(page, includeOrchestrator = false) {
  await page.route("https://native.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<style>body{background:#171717;color:#eee;font:13px system-ui}[role=menuitem]{display:flex;gap:8px;padding:8px}button{color:inherit;background:#222;border:0}</style><button data-testid="model-selector-trigger" aria-expanded="false"><span>Gemini Fixture</span></button><div id="host"></div>',
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(
    ({ provider, orchestrator }) => {
      const t = (key, p = {}) =>
        key.replace(/\{(\w+)\}/g, (_, key) => p[key] ?? `{${key}}`);
      globalThis.__AGPAI18n = {
        t,
        set(n, key, p = {}, attr = "text") {
          const value = t(key, p);
          if (attr === "text") n.textContent = value;
          else n.setAttribute(attr, value);
        },
        subscribe: () => () => {},
      };
      globalThis.__AGPAProviderFor = (0, eval)(`(${provider})`);
      globalThis.__AGPAPermissionFor = () => null;
      const icon =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='8' cy='8' r='7' fill='orange'/%3E%3C/svg%3E";
      globalThis.__AGPA_LAB_ICONS__ = {
        google: icon,
        anthropic: icon,
        openai: icon,
        orchestrator,
      };
      const prefs = { version: 1, models: {} };
      globalThis.__agpaModelPreferences = (payload) => {
        const { requestId, name, field, value } = JSON.parse(payload);
        if (field === "seenAnnouncements")
          prefs.seenAnnouncements = [
            ...new Set([...(prefs.seenAnnouncements || []), ...value]),
          ];
        else if (field === "order") prefs.order = value;
        else
          prefs.models[name] = {
            favorite: false,
            hidden: false,
            ...prefs.models[name],
            [field]: value,
          };
        queueMicrotask(() =>
          globalThis.__AGModelUI.onResult(
            requestId,
            true,
            structuredClone(prefs),
          ),
        );
      };
      const trigger = document.querySelector(
        "[data-testid=model-selector-trigger]",
      );
      globalThis.fixture = { changes: 0 };
      trigger.onclick = () => {
        const host = document.querySelector("#host");
        if (host.firstChild) {
          host.replaceChildren();
          trigger.setAttribute("aria-expanded", "false");
          return;
        }
        host.innerHTML =
          '<div role="menu"><div data-testid="model-selector-panel"><div data-testid="model-selector-header">Model</div><div class="rows"></div><div><div role="menuitem" aria-haspopup="menu" id="usage">View Usage</div><div role="menuitem" aria-haspopup="menu">Main Agent</div></div></div></div>';
        const rows = host.querySelector(".rows");
        for (const name of [
          "Gemini Fixture",
          "Claude Fixture",
          "GPT-OSS Fixture",
          ...(orchestrator ? ["Orchestrator (Argon)"] : []),
        ]) {
          const row = document.createElement("div");
          row.setAttribute("role", "menuitem");
          row.tabIndex = -1;
          const label = document.createElement("span");
          label.dataset.testid = "model-selector-item";
          label.dataset.modelLabel = name;
          label.textContent = name;
          row.append(label);
          const badge = document.createElement("div");
          badge.className = "rounded-full";
          if (name === "Gemini Fixture") {
            badge.dataset.tooltipId = "details";
            badge.innerHTML =
              "<span>New</span><svg width='12' height='12'></svg>";
          } else
            badge.textContent = name === "Claude Fixture" ? "New" : "Notice";
          if (!name.startsWith("Orchestrator")) row.append(badge);
          rows.append(row);
          row.onclick = () => {
            globalThis.fixture.changes++;
            trigger.querySelector("span").textContent = name;
            trigger.click();
          };
        }
        trigger.setAttribute("aria-expanded", "true");
      };
    },
    {
      provider: providerFor.toString(),
      orchestrator: includeOrchestrator
        ? "data:image/svg+xml;base64," +
          fs
            .readFileSync(
              path.join(__dirname, "../../assets/labs/orchestrator.svg"),
            )
            .toString("base64")
        : null,
    },
  );
  await page.evaluate(source);
}
test("models move to a separate Other group and restore without changing the selected model", async ({
  page,
}) => {
  await setup(page);
  const trigger = page.locator("[data-testid=model-selector-trigger]");
  await trigger.click();
  const claude = page.locator('[data-agpa-model-key="Claude Fixture"]');
  await claude.hover();
  await page
    .getByRole("button", { name: "Move Claude Fixture to Other", exact: true })
    .click();
  await expect(claude).toBeHidden();
  await expect(trigger).toContainText("Gemini Fixture");
  const other = page.locator("[data-agpa-model-footer]");
  await expect(other).toHaveText("▸ Other (1)");
  await other.click();
  await expect(claude).toBeVisible();
  await expect(other).toHaveAttribute("aria-expanded", "true");
  const bounds = await Promise.all(
    [
      other,
      claude,
      page.locator('[data-agpa-model-key="GPT-OSS Fixture"]'),
    ].map((n) => n.boundingBox()),
  );
  expect(bounds[1].y).toBeGreaterThan(bounds[0].y);
  expect(bounds[0].y).toBeGreaterThan(bounds[2].y);
  await trigger.click();
  await trigger.click();
  await expect(claude).toBeHidden();
  await expect(other).toHaveAttribute("aria-expanded", "false");
  await other.focus();
  await page.keyboard.press("Enter");
  await expect(claude).toBeVisible();
  await claude.hover();
  await page
    .getByRole("button", {
      name: "Move Claude Fixture to main menu",
      exact: true,
    })
    .click();
  await expect(other).toBeHidden();
  await expect(claude).toBeVisible();
  expect(await page.evaluate(() => globalThis.fixture.changes)).toBe(0);
  await claude.click();
  await expect(trigger).toContainText("Claude Fixture");
  expect(await page.evaluate(() => globalThis.fixture.changes)).toBe(1);
});
test("Usage belongs to the sidebar and the host entry returns on teardown", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("model-selector-trigger").click();
  await expect(page.locator("#usage")).toBeHidden();
  await expect(
    page.getByRole("menuitem", { name: "Main Agent" }),
  ).toBeVisible();
  await page.evaluate(() => globalThis.__AGModelUI.destroy());
  await expect(page.locator("#usage")).toBeVisible();
});

test("existing New labels expire, future labels last one opening, native information survives", async ({
  page,
}) => {
  await setup(page);
  const trigger = page.getByTestId("model-selector-trigger");
  await trigger.click();
  const rows = page.locator(".rows > [role=menuitem]");
  const info = rows.first().locator("[data-tooltip-id]");
  await expect(info.locator("span")).toBeHidden();
  await expect(info.locator("svg")).toBeVisible();
  await expect(rows.nth(1).locator(".rounded-full")).toBeHidden();
  await trigger.click();
  await trigger.click();
  await rows
    .nth(2)
    .locator(".rounded-full")
    .evaluate((el) => {
      el.textContent = "New";
    });
  await expect(rows.nth(2).locator(".rounded-full")).toBeVisible();
  await trigger.click();
  await trigger.click();
  await expect(rows.nth(2).getByText("Notice")).toBeVisible();
  await rows
    .nth(2)
    .locator(".rounded-full")
    .evaluate((el) => {
      el.textContent = "New";
    });
  await expect(rows.nth(2).locator(".rounded-full")).toBeHidden();
  await page.evaluate(() => globalThis.__AGModelUI.destroy());
  await expect(info.locator("span")).toBeVisible();
});

test("standalone quota uses the same provider logos outside conversations", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    document.querySelector("[data-testid=model-selector-trigger]").remove();
    const settings = document.createElement("button");
    settings.dataset.testid = "settings-button";
    settings.textContent = "Settings";
    document.body.append(settings);
    settings.__reactFiber$fixture = {
      memoizedProps: {
        value: {
          core: {
            cloudCodeService: {
              async retrieveUserQuotaSummary() {
                return {
                  response: {
                    groups: [
                      {
                        displayName: "Claude and GPT models",
                        buckets: [
                          {
                            window: "weekly",
                            remaining: {
                              case: "remainingFraction",
                              value: 0.5,
                            },
                          },
                        ],
                      },
                      {
                        displayName: "Gemini 4 Argon",
                        buckets: [
                          {
                            window: "5h",
                            remaining: {
                              case: "remainingFraction",
                              value: 0.73,
                            },
                          },
                        ],
                      },
                    ],
                  },
                };
              },
            },
          },
        },
      },
    };
    globalThis.__AGModelUI.openUsage(settings);
  });
  const popup = page.locator(".agpa-standalone-usage");
  await expect(popup).toContainText("50% left");
  await expect(popup).toContainText("73% left");
  await expect(
    popup.locator('[data-agpa-quota-logos="anthropic openai"] img'),
  ).toHaveCount(2);
  await expect(
    popup.locator('[data-agpa-quota-logos="google"] img'),
  ).toHaveCount(1);
});

test("Orchestrator has its own Google icon in the menu and selected model", async ({
  page,
}) => {
  await setup(page, true);
  const trigger = page.locator("[data-testid=model-selector-trigger]");
  await trigger.click();
  const row = page.getByRole("menuitem", { name: "Orchestrator (Argon)" });
  const logo = '[data-agpa-lab="google"][data-agpa-icon="orchestrator"]';
  const google = '[data-agpa-icon="google"][title="Google"]';
  await expect(row.locator(google)).toBeVisible();
  await expect(row.locator(logo)).toHaveJSProperty("complete", true);
  await row.click();
  await expect(trigger.locator(google)).toBeVisible();
  await expect(trigger.locator(logo)).toHaveJSProperty("complete", true);
});

test("Automations decorates its native picker and portaled options without reordering them", async ({
  page,
}) => {
  await setup(page, true);
  await page.evaluate(() => {
    const editor = document.createElement("section");
    editor.innerHTML =
      '<div role="combobox" aria-controls="automation-model-list" data-testid="new-sidecar-model"><span>Gemini 4 Argon (Medium)</span><svg></svg></div><button data-testid="schedule-repeat">Daily</button>';
    document.body.append(editor);
    const list = document.createElement("div");
    list.role = "listbox";
    list.id = "automation-model-list";
    for (const model of [
      "Gemini 4 Argon (Medium)",
      "Orchestrator (Argon)",
      "Claude Sonnet 5.5",
      "GPT-OSS 120B",
      "Unknown model",
    ]) {
      const option = document.createElement("div");
      option.role = "option";
      option.dataset.testid = "sidecar-model-option";
      const label = document.createElement("div");
      label.textContent = model;
      option.append(label);
      option.onclick = () => (editor.querySelector("span").textContent = model);
      list.append(option);
    }
    document.body.append(list);
  });
  const picker = page.getByTestId("new-sidecar-model");
  const list = page.locator("#automation-model-list");
  await expect(picker.locator("img")).toHaveAttribute(
    "data-agpa-icon",
    "google",
  );
  await expect(picker.locator("img[data-element]")).toHaveCount(0);
  await expect(list.locator("img[data-agpa-icon]")).toHaveCount(5);
  const orchestrator = list.getByRole("option", {
    name: "Orchestrator (Argon)",
  });
  await expect(
    orchestrator.locator('img[data-agpa-icon="orchestrator"]'),
  ).toHaveAttribute("data-agpa-icon", "orchestrator");
  await expect(list.getByRole("option").first()).toHaveText(
    "Gemini 4 Argon (Medium)",
  );
  await expect(list.locator("[data-agpa-model-favorite]")).toHaveCount(0);
  await expect(page.getByTestId("schedule-repeat").locator("img")).toHaveCount(
    0,
  );
  await orchestrator.click();
  await expect(
    picker.locator('img[data-agpa-icon="orchestrator"]'),
  ).toBeVisible();
  await expect(picker.locator('img[data-agpa-icon="google"]')).toBeVisible();
  await expect(picker.locator("svg")).toHaveCount(1);
  await page.evaluate(() => globalThis.__AGModelUI.destroy());
  await expect(list.locator("img")).toHaveCount(0);
});

test("custom order follows keyboard navigation and can be reset independently", async ({
  page,
}) => {
  await setup(page);
  const trigger = page.getByTestId("model-selector-trigger");
  await trigger.click();
  const manage = page.getByRole("button", { name: "Manage models" });
  await manage.click();
  await page.getByRole("button", { name: "Move Claude Fixture up" }).click();
  await expect(page.locator(".agpa-model-setting").first()).toContainText(
    "Claude Fixture",
  );
  await page.getByRole("button", { name: "Done" }).click();
  await trigger.click();
  const claude = page.locator('[data-agpa-model-key="Claude Fixture"]');
  const gemini = page.locator('[data-agpa-model-key="Gemini Fixture"]');
  expect((await claude.boundingBox()).y).toBeLessThan(
    (await gemini.boundingBox()).y,
  );
  await claude.focus();
  await page.keyboard.press("ArrowDown");
  await expect(gemini).toBeFocused();
  await manage.click();
  await page.getByRole("button", { name: "Reset order" }).click();
  await expect(page.locator(".agpa-model-setting").first()).toContainText(
    "Gemini Fixture",
  );
  expect(await page.evaluate(() => globalThis.fixture.changes)).toBe(0);
});

test("Gemini element badges follow the native model name and preference chips support Space", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("model-selector-trigger").click();
  let model = page.locator('[data-model-label="Gemini Fixture"]');
  async function rename(name) {
    await model.evaluate((label, next) => {
      label.dataset.modelLabel = next;
      label.textContent = next;
    }, name);
    model = page.locator(`[data-model-label="${name}"]`);
  }
  await rename("Gemini 4 Neon");
  const row = page.locator('[data-agpa-model-key="Gemini 4 Neon"]');
  await expect(
    row.locator('[data-agpa-icon="google"] + [data-agpa-element="Ne"]'),
  ).toHaveAttribute("title", "Deep reasoning with fast turnaround");
  await rename("Gemini 4 Hydrogen");
  await expect(page.locator('[data-agpa-element="Ne"]')).toHaveCount(0);
  await expect(page.locator('[data-agpa-element="H"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Manage models" }).click();
  const setting = page
    .locator(".agpa-model-setting")
    .filter({ hasText: "Gemini 4 Hydrogen" });
  await expect(setting).toContainText("Fast everyday tasks");
  const favorite = setting.getByRole("checkbox", { name: "Favorite" });
  await favorite.focus();
  await page.keyboard.press("Space");
  await expect(favorite).toBeChecked();
  await expect(favorite).toBeFocused();
  expect(await page.evaluate(() => globalThis.fixture.changes)).toBe(0);
});

test("the toolbar pairs the Google logo with the selected Gemini element independently of effort", async ({
  page,
}) => {
  await setup(page, true);
  const trigger = page.getByTestId("model-selector-trigger");
  const label = trigger.locator(":scope > span:not([data-agpa-model-ui])");
  const badge = trigger.locator(
    '[data-agpa-icon="google"] + [data-agpa-element]',
  );
  await label.evaluate((el) => {
    const effort = document.createElement("span");
    effort.textContent = " High";
    el.replaceChildren("Gemini 4 Neon", effort);
  });
  await expect(badge).toHaveAttribute("data-agpa-element", "Ne");
  await label.locator("span").evaluate((el) => {
    el.textContent = " Extra";
  });
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveAttribute("data-agpa-element", "Ne");
  for (const [name, symbol] of [
    ["Hydrogen", "H"],
    ["Argon", "Ar"],
    ["Carbon", "C"],
  ]) {
    await label.evaluate((el, name) => {
      el.firstChild.textContent = "Gemini 4 " + name;
    }, name);
    await expect(badge).toHaveAttribute("data-agpa-element", symbol);
  }
  await label.evaluate((el) => {
    el.textContent = "Orchestrator (Neon)";
  });
  await expect(trigger.locator("[data-agpa-element]")).toHaveCount(0);
  await expect(
    trigger.locator('[data-agpa-icon="orchestrator"]'),
  ).toBeVisible();
});

test("per-model shortcuts select only the assigned entry and preserve selection when unavailable", async ({
  page,
}) => {
  await setup(page, true);
  const createRules =
    require("../../common/shortcut-config.cjs").createShortcutRules;
  await page.evaluate(
    "globalThis.__AGPAShortcutRules=(" + createRules.toString() + ")()",
  );
  await page.evaluate(
    fs.readFileSync(path.join(__dirname, "../../common/shortcuts.js"), "utf8"),
  );
  const trigger = page.getByTestId("model-selector-trigger");
  await trigger.click();
  await page.getByRole("button", { name: "Manage models" }).click();
  const choose = page.getByRole("combobox", {
    name: "Shortcut for Claude Fixture",
    exact: true,
  });
  await expect(choose.locator('option[value="Ctrl+Alt+G"]')).toBeDisabled();
  await choose.selectOption("Ctrl+Alt+C");
  await expect(
    page
      .getByRole("combobox", {
        name: "Shortcut for Gemini Fixture",
        exact: true,
      })
      .locator('option[value="Ctrl+Alt+C"]'),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Done" }).click();
  await page.keyboard.press("Control+Alt+c");
  await expect(trigger).toContainText("Claude Fixture");
  await page.evaluate(() =>
    globalThis.__AGModelUI.setPreferences({
      version: 1,
      models: {
        "Orchestrator (Neon)": {
          favorite: false,
          hidden: false,
          shortcut: "Ctrl+Alt+O",
        },
      },
    }),
  );
  await page.keyboard.press("Control+Alt+o");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Orchestrator (Neon) is unavailable." }),
  ).toBeVisible();
  await expect(trigger).toContainText("Claude Fixture");
  await trigger.click();
  await page.getByRole("button", { name: "Manage models" }).click();
  const missing = page.getByRole("combobox", {
    name: "Shortcut for Orchestrator (Neon)",
    exact: true,
  });
  await expect(missing).toHaveValue("Ctrl+Alt+O");
  for (const width of [1000, 640, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.getByRole("dialog").evaluate((dialog) => {
      const selectors = [...dialog.querySelectorAll("select")];
      return {
        bounds: selectors.map((select) => {
          const { left, right } = select.getBoundingClientRect();
          return [left, right];
        }),
        fits: dialog.scrollWidth <= dialog.clientWidth,
      };
    });
    expect(layout.fits).toBe(true);
    expect(layout.bounds.length).toBeGreaterThan(1);
    for (const bounds of layout.bounds)
      expect(bounds).toEqual(layout.bounds[0]);
  }
  await missing.selectOption("");
  await expect(missing).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.fixture.changes)).toBe(1);
});
