"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/model-ui.js"),
  "utf8",
);
const { providerFor } = require("../../common/model-preferences.cjs");
async function setup(page) {
  await page.route("https://native.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<style>body{background:#171717;color:#eee;font:13px system-ui}[role=menuitem]{display:flex;gap:8px;padding:8px}button{color:inherit;background:#222;border:0}</style><button data-testid="model-selector-trigger" aria-expanded="false"><span>Gemini Fixture</span></button><div id="host"></div>',
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(
    ({ provider }) => {
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
      };
      const prefs = { version: 1, models: {} };
      globalThis.__agpaModelPreferences = (payload) => {
        const { requestId, name, field, value } = JSON.parse(payload);
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
          '<div role="menu"><div data-testid="model-selector-panel"><div data-testid="model-selector-header">Model</div><div class="rows"></div><div><div role="menuitem" aria-haspopup="menu" id="usage">View Usage</div></div></div></div>';
        const rows = host.querySelector(".rows");
        for (const name of [
          "Gemini Fixture",
          "Claude Fixture",
          "GPT-OSS Fixture",
        ]) {
          const row = document.createElement("div");
          row.setAttribute("role", "menuitem");
          row.tabIndex = -1;
          const label = document.createElement("span");
          label.dataset.testid = "model-selector-item";
          label.dataset.modelLabel = name;
          label.textContent = name;
          row.append(label);
          rows.append(row);
          row.onclick = () => {
            globalThis.fixture.changes++;
            trigger.firstElementChild.textContent = name;
            trigger.click();
          };
        }
        host.querySelector("#usage").onclick = () => {
          if (host.querySelector("[data-nested]")) return;
          const wrapper = document.createElement("div");
          wrapper.innerHTML =
            '<div role="menu" data-nested><div role="presentation">Gemini Models</div><div role="presentation">Claude and GPT models</div><div><span class="truncate">Gemini 4 Argon</span></div></div>';
          host.querySelector("#usage").parentElement.append(wrapper);
        };
        trigger.setAttribute("aria-expanded", "true");
      };
    },
    { provider: providerFor.toString() },
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
test("native quota headings show all relevant labs without changing quota text or duplicating icons", async ({
  page,
}) => {
  await setup(page);
  await page.locator("[data-testid=model-selector-trigger]").click();
  await page.evaluate(() =>
    globalThis.__AGModelUI.openUsage(
      document.querySelector("[data-testid=model-selector-trigger]"),
    ),
  );
  const headings = page.locator("[data-agpa-quota-heading]");
  await expect(headings).toHaveCount(3);
  const combined = headings.filter({ hasText: "Claude and GPT models" });
  await expect(combined.locator("img")).toHaveCount(2);
  await expect(combined.locator("[data-agpa-quota-logos]")).toHaveAttribute(
    "data-agpa-quota-logos",
    "anthropic openai",
  );
  await page.evaluate(() =>
    document
      .querySelector("[data-testid=model-selector-trigger] > span")
      .append(document.createTextNode(" ")),
  );
  await expect(combined.locator("img")).toHaveCount(2);
  await page.evaluate(() => globalThis.__AGModelUI.destroy());
  await expect(page.locator("[data-agpa-quota-logos]")).toHaveCount(0);
  await expect(page.locator("[data-agpa-quota-heading]")).toHaveCount(0);
  await page.locator("[data-testid=model-selector-trigger]").click();
  await expect(page.locator("#usage")).toHaveText("View Usage");
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
