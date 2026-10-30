"use strict";
const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
const models = require("../fixtures/model-controls.cjs"),
  team = require("../fixtures/teamwork.cjs");
const { createTeamworkBridge } = require("../../common/teamwork.cjs");
const rules = require("../../common/model-controls.cjs");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/model-controls.js"),
  "utf8",
);
async function setup(page, teamwork = false) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(`(${models.setup.toString()})()`);
  if (teamwork) await page.evaluate(`(${team.setup.toString()})()`);
  await page.evaluate(
    `globalThis.__AGPA_TEAMWORK_FACTORY__=${createTeamworkBridge.toString()};globalThis.__AGPA_MODEL_CONTROLS__={selectionFor:${rules.selectionFor.toString()},optionsFor:${rules.optionsFor.toString()},layoutFor:${rules.layoutFor.toString()}}`,
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
test("Ultra is compact in the composer and fully named in the slider", async ({
  page,
}) => {
  await setup(page, true);
  await page.evaluate(() => window.fixture.addManual());
  await expect(page.locator(".agpa-effort-label")).toHaveText("Ultra");
  await page.locator(".agpa-effort-trigger").click();
  await expect(page.locator(".agpa-effort-popup")).toBeVisible();
  await expect(page.locator(".agpa-effort-popup strong")).toHaveText(
    "Ultra (Teamwork)",
  );
  expect(
    await page.locator(".agpa-effort-trigger svg path").getAttribute("d"),
  ).toBe("M3 8.5 7 4.5 11 8.5");
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
test("native Teamwork editing, rollback, draft preservation and cleanup still pass", async ({
  page,
}) => {
  await setup(page, true);
  const result = await page.evaluate(`(${team.verify.toString()})()`);
  expect(result.checks || result.passed.length).toBeGreaterThan(10);
});
