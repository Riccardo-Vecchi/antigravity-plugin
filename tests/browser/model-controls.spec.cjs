"use strict";
const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
const models = require("../fixtures/model-controls.cjs"),
  team = require("../fixtures/swarm.cjs");
const { createSwarmBridge } = require("../../common/swarm.cjs");
const rules = require("../../common/model-controls.cjs");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/model-controls.js"),
  "utf8",
);
const teamworkIcon =
  "data:image/svg+xml;base64," +
  fs
    .readFileSync(path.join(__dirname, "../../assets/labs/teamwork.svg"))
    .toString("base64");
async function setup(page, swarm = false) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(`(${models.setup.toString()})()`);
  if (swarm) await page.evaluate(`(${team.setup.toString()})()`);
  await page.evaluate(
    `globalThis.__AGPA_TEAMWORK_ICON__=${JSON.stringify(teamworkIcon)};globalThis.__AGPA_SWARM_FACTORY__=${createSwarmBridge.toString()};globalThis.__AGPA_MODEL_CONTROLS__={selectionFor:${rules.selectionFor.toString()},optionsFor:${rules.optionsFor.toString()},layoutFor:${rules.layoutFor.toString()}}`,
  );
  await page.evaluate(source);
}
test("existing model and effort regression flow still passes", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(`(${models.verify.toString()})()`);
  expect(result.checks).toBeGreaterThan(10);
});
test("model rows hide the effort suffix at insertion, before any hover or submenu", async ({
  page,
}) => {
  await setup(page);
  const firstPaint = await page.evaluate(() => {
    const trigger = document.querySelector(
      "[data-testid=model-selector-trigger]",
    );
    trigger.click();
    const group = document.querySelector(
      "[data-testid=model-selector-effort-group]",
    );
    const summary = document.createElement("span");
    summary.className = "shrink-0 opacity-70 text-sm";
    summary.textContent = "High";
    const info = document.createElement("span");
    info.textContent = "Notice";
    group.after(summary, info);
    const arrow = document.createElement("span");
    arrow.innerHTML = '<svg><path d="M517.85-480l-184-184"/></svg>';
    group.closest("[role=menuitem]").append(arrow);
    return {
      arrow: arrow.checkVisibility(),
      effort: summary.checkVisibility(),
      notice: info.checkVisibility(),
    };
  });
  expect(firstPaint).toEqual({ arrow: false, effort: false, notice: true });
  const summary = page.locator(
    "[data-testid=model-selector-effort-group] + .shrink-0",
  );
  await page.getByTestId("model-selector-effort-group").first().hover();
  await expect(summary).toBeHidden();
  await expect(page.locator(".agpa-effort-trigger")).toHaveText("High");
  await page.evaluate(() => window.__AGModelControls.destroy());
  await expect(summary).toBeVisible();
});

test("Orchestrator master rows select directly and the slider owns effort", async ({
  page,
}) => {
  await setup(page);
  const trigger = page.getByTestId("model-selector-trigger");
  const effort = page.locator(".agpa-effort-trigger");
  await expect(effort).toHaveText("High");
  await trigger.evaluate((trigger) => {
    const label = trigger.querySelector(":scope > span");
    label.firstChild.textContent = "Orchestrator";
    const summary = label.lastElementChild;
    summary.textContent = " Claude Opus 5.5 High";
    const makeMenu = (owner) => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-labelledby", owner.id);
      document.body.append(menu);
      return menu;
    };
    const addSubmenu = (menu, id, testId, title, populate) => {
      const row = document.createElement("div");
      row.id = id;
      row.dataset.testid = testId;
      row.textContent = title;
      row.setAttribute("role", "menuitem");
      row.setAttribute("aria-haspopup", "menu");
      row.tabIndex = -1;
      row.onkeydown = (event) => {
        if (event.key === "ArrowRight") {
          const submenu = makeMenu(row);
          setTimeout(() => populate(submenu), 100);
        }
      };
      menu.append(row);
      return row;
    };
    const close = () => {
      for (const menu of document.querySelectorAll("[role=menu]"))
        menu.remove();
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.onclick = () => {
      if (trigger.getAttribute("aria-expanded") === "true") return close();
      trigger.setAttribute("aria-expanded", "true");
      const menu = makeMenu(trigger);
      const panel = document.createElement("div");
      panel.dataset.testid = "model-selector-panel";
      menu.append(panel);
      const root = addSubmenu(
        panel,
        "orchestrator",
        "model-selector-orchestrator",
        "Orchestrator",
        (masters) => {
          for (const [index, name] of [
            "Gemini 4 Neon",
            "Claude Opus 5.5",
          ].entries()) {
            const master = addSubmenu(
              masters,
              "master-" + index,
              "orchestrator-picker-row",
              name,
              (levels) => {
                for (const level of index === 0
                  ? ["Low", "High", "Extra High"]
                  : ["Medium", "High"]) {
                  const row = document.createElement("div");
                  row.setAttribute("role", "menuitem");
                  const option = document.createElement("span");
                  option.dataset.testid = "orchestrator-picker-effort";
                  option.dataset.effort = level.toLowerCase().replace(" ", "_");
                  option.textContent = level;
                  row.append(option);
                  row.onclick = () => {
                    summary.textContent = " " + name + " " + level;
                    close();
                  };
                  levels.append(row);
                }
              },
            );
            master.dataset.modelBase = name;
            master.innerHTML =
              '<span><span></span><span class="shrink-0">Medium</span></span><span><svg width="12" height="12"><path d="M517.85-480l-184-184"/></svg></span>';
            master.firstElementChild.firstElementChild.textContent = name;
            master.onmouseenter = () => {
              const submenu = makeMenu(master);
              submenu.dataset.testid = "duplicate-effort-menu";
            };
            master.onclick = () => {
              summary.textContent = " " + name + " Medium";
              close();
            };
          }
        },
      );
      const arrow = document.createElement("span");
      arrow.dataset.testid = "orchestrator-chevron";
      arrow.innerHTML =
        '<svg width="12" height="12"><path d="M517.85-480l-184-184"/></svg>';
      root.append(arrow);
    };
  });
  await expect(effort).toHaveAccessibleName("Reasoning effort: High");
  await expect(trigger).toHaveText("Orchestrator Claude Opus 5.5", {
    useInnerText: true,
  });
  await trigger.click();
  const rootArrow = page.getByTestId("orchestrator-chevron");
  await expect(rootArrow).toBeVisible();
  await rootArrow.locator("..").press("ArrowRight");
  const claude = page
    .getByTestId("orchestrator-picker-row")
    .filter({ hasText: "Claude Opus" });
  await expect(claude.locator("svg")).toBeHidden();
  await expect(claude.getByText("Medium")).toBeHidden();
  await claude.hover();
  await expect(page.getByTestId("duplicate-effort-menu")).toHaveCount(0);
  await claude.press("ArrowRight");
  await expect(page.getByTestId("orchestrator-picker-effort")).toHaveCount(0);
  await claude.press("Enter");
  await expect(claude).toHaveCount(0);
  await expect(effort).toHaveText("Medium");
  await effort.click();
  const range = page.getByRole("slider", { name: "Reasoning effort" });
  await expect(range).toHaveAttribute("max", "1");
  await expect(range).toHaveAttribute("aria-valuetext", "Medium");
  await range.press("End");
  await expect(trigger).toHaveText("Orchestrator Claude Opus 5.5", {
    useInnerText: true,
  });
  await expect(effort).toHaveText("High");
  await expect(range).toHaveCount(0);
  await expect(effort).toBeFocused();
});

test("the duplicate simple native effort submenu is hidden, and disabling restores it", async ({
  page,
}) => {
  await setup(page);
  await page.locator("[data-testid=model-selector-trigger]").click();
  const row = page
    .locator("[data-testid=model-selector-effort-group]")
    .first()
    .locator("..");
  await row.press("ArrowRight");
  await expect(
    page.locator("[data-testid=model-selector-effort-option]").first(),
  ).toBeHidden();
  await expect(
    page.locator("[data-testid=model-selector-panel]"),
  ).toBeVisible();
  await page.evaluate(() => window.__AGModelControls.destroy());
  await expect(
    page.locator("[data-testid=model-selector-effort-option]").first(),
  ).toBeVisible();
});
test("Swarm is independent of native effort and preserves the draft", async ({
  page,
}) => {
  await setup(page, true);
  const result = await page.evaluate(`(${team.verify.toString()})()`);
  expect(result.checks || result.passed.length).toBeGreaterThan(10);
});

test("Hydrogen ends at the native Extra stop", async ({ page }) => {
  await setup(page, true);
  await page.evaluate(() =>
    window.fixture.external("Gemini 4 Hydrogen", "high"),
  );
  const trigger = page.locator(".agpa-effort-trigger");
  const slider = page.getByRole("slider");
  await trigger.click();
  await expect(slider).toHaveAttribute("max", "3");
  await expect(
    page.locator(".agpa-effort-dots [title=Extra]:last-child"),
  ).toHaveCount(1);
  await expect(trigger).not.toHaveAttribute("data-agpa-extra-effort");
  await slider.evaluate((input) => {
    input.value = "3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator(".agpa-effort-popup")).toHaveAttribute(
    "data-agpa-extra-effort",
  );
  await expect(slider).toHaveCSS("--effort-color", "#a464f6");
  await slider.dispatchEvent("change");
  await expect(trigger).toHaveText("Extra");
  await expect(trigger).toHaveCSS("color", "rgb(212, 177, 255)");
  expect(await page.evaluate(() => window.fixture.selected.effort)).toBe(
    "xhigh",
  );
  expect(
    await page.evaluate(() =>
      window.fixture.editor.querySelector("[data-uri='slashCommand:swarm']"),
    ),
  ).toBeNull();
});
test("a slowly rendered native submenu still opens the slider", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const trigger = window.fixture.trigger,
      original = trigger.onclick;
    trigger.onclick = () => {
      original();
      const row = document
        .querySelector("[data-testid=model-selector-effort-group]")
        ?.closest("[role=menuitem]");
      if (row) {
        const handler = row.onkeydown;
        row.onkeydown = (e) => setTimeout(() => handler(e), 1500);
      }
    };
  });
  await page.locator(".agpa-effort-trigger").click();
  await expect(page.locator(".agpa-effort-trigger")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(
    page.locator(".agpa-effort-popup input[type=range]"),
  ).toBeVisible();
  await expect(page.locator(".agpa-effort-trigger")).not.toHaveAttribute(
    "aria-busy",
  );
  const range = page.locator(".agpa-effort-popup input[type=range]");
  await range.focus();
  await range.press("Home");
  await expect(page.locator(".agpa-effort-label")).toHaveText("Low");
});

test("a transient submenu timeout does not permanently hide effort controls", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const trigger = window.fixture.trigger,
      original = trigger.onclick;
    trigger.onclick = () => {
      original();
      const row = document
        .querySelector("[data-testid=model-selector-effort-group]")
        ?.closest("[role=menuitem]");
      if (row) {
        row.savedKeydown = row.onkeydown;
        row.onkeydown = () => {};
      }
    };
  });
  await page.locator(".agpa-effort-trigger").click();
  await expect(page.locator(".agpa-effort-trigger")).not.toHaveAttribute(
    "aria-busy",
    { timeout: 5000 },
  );
  await expect(page.locator(".agpa-effort-trigger")).toBeVisible();
  await page.evaluate(() => {
    const row = document
      .querySelector("[data-testid=model-selector-effort-group]")
      .closest("[role=menuitem]");
    row.onkeydown = row.savedKeydown;
  });
  await page.locator(".agpa-effort-trigger").click();
  await expect(page.locator(".agpa-effort-popup")).toBeVisible();
});

test("the multi-agent control follows the draft and defaults to Swarm in a fresh composer", async ({
  page,
}) => {
  await setup(page, true);
  const primary = page.locator("[data-agpa-swarm-trigger]");
  const arrow = page.getByRole("button", { name: "Multi-agent modes" });
  const menu = page.getByRole("menu", { name: "Multi-agent modes" });
  const option = (name) => menu.getByRole("menuitemcheckbox", { name });
  const chip = (mode) => page.locator(`[data-uri="slashCommand:${mode}"]`);
  await expect(primary).toHaveText("🐝");
  await expect(primary).toHaveAttribute("aria-pressed", "false");
  await arrow.click();
  await expect(
    menu.getByText("Multi-agent modes", { exact: true }),
  ).toBeVisible();
  await expect(option("Swarm")).toBeFocused();
  await page.keyboard.press("Escape");
  await primary.click();
  await expect(primary).toHaveAttribute("aria-pressed", "true");
  await arrow.click();
  await expect(arrow).toHaveAttribute("aria-expanded", "true");
  await expect(option("Swarm")).toBeFocused();
  await expect(option("Swarm")).toHaveAttribute("aria-checked", "true");
  await option("Swarm").press("ArrowDown");
  await expect(option("Boost")).toBeFocused();
  await option("Boost").press("Enter");
  await expect(primary).toHaveText("🚀");
  await expect(primary).toHaveAccessibleName("Boost");
  await expect(chip("swarm")).toHaveCount(0);
  await arrow.click();
  await expect(option("Boost")).toHaveAttribute("aria-checked", "true");
  await option("Boost").press("ArrowDown");
  await expect(option("Teamwork")).toBeFocused();
  await expect(option("Teamwork").locator("img")).toHaveAttribute(
    "src",
    teamworkIcon,
  );
  await page.keyboard.press("Escape");
  await expect(arrow).toBeFocused();
  await expect(menu).toBeHidden();
  await arrow.click();
  await option("Teamwork").click();
  await expect(primary).toHaveAccessibleName("Teamwork");
  await expect(primary.locator("img")).toHaveAttribute("src", teamworkIcon);
  await expect(chip("boost")).toHaveCount(0);
  await arrow.click();
  await option("Swarm").click();
  await expect(primary).toHaveText("🐝");
  await expect(chip("teamwork")).toHaveCount(0);
  await arrow.click();
  await option("Boost").click();
  await expect(primary).toHaveText("🚀");
  await primary.click();
  await expect(primary).toHaveText("🐝");
  await expect(chip("boost")).toHaveCount(0);
  const draft = page.locator(".surface-composer [contenteditable=true]");
  await expect(draft).toContainText("Second paragraph.");
  await expect(
    draft.locator('[data-uri="file:/fixture/report.md"]'),
  ).toHaveCount(1);
  await arrow.click();
  await option("Teamwork").click();
  await expect(primary).toHaveAccessibleName("Teamwork");
  await expect(primary.locator("img")).toHaveAttribute("src", teamworkIcon);
  await page.evaluate(() => {
    const old = window.fixture.editor;
    old.replaceWith(old.cloneNode(false));
  });
  await expect(primary).toHaveText("🐝");
  await expect(primary).toHaveAccessibleName("Swarm");
  await expect(primary).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.fixture.getSends())).toBe(0);
});
