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
async function setup(page, swarm = false) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(`(${models.setup.toString()})()`);
  if (swarm) await page.evaluate(`(${team.setup.toString()})()`);
  await page.evaluate(
    `globalThis.__AGPA_SWARM_FACTORY__=${createSwarmBridge.toString()};globalThis.__AGPA_MODEL_CONTROLS__={selectionFor:${rules.selectionFor.toString()},optionsFor:${rules.optionsFor.toString()},layoutFor:${rules.layoutFor.toString()}}`,
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
test("Ultra uses the native Swarm chip and preserves the draft", async ({
  page,
}) => {
  await setup(page, true);
  const result = await page.evaluate(`(${team.verify.toString()})()`);
  expect(result.checks || result.passed.length).toBeGreaterThan(10);
});

test("Hydrogen keeps Extra as a native stop before Ultra", async ({ page }) => {
  await setup(page, true);
  await page.evaluate(() =>
    window.fixture.external("Gemini 4 Hydrogen", "high"),
  );
  const trigger = page.locator(".agpa-effort-trigger");
  const slider = page.getByRole("slider");
  await trigger.click();
  await expect(slider).toHaveAttribute("max", "4");
  await expect(
    page.locator(".agpa-effort-dots [title=Extra] + [title='Ultra (Swarm)']"),
  ).toHaveCount(1);
  await slider.press("ArrowRight");
  await expect(trigger).toHaveText("Extra");
  expect(await page.evaluate(() => window.fixture.selected.effort)).toBe(
    "extra",
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
