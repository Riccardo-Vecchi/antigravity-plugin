"use strict";
const { test, expect } = require("@playwright/test"),
  fs = require("node:fs"),
  path = require("node:path");
const models = require("../fixtures/model-controls.cjs"),
  team = require("../fixtures/teamwork.cjs");
const { createTeamworkBridge } = require("../../common/teamwork.cjs"),
  { createContextReader } = require("../../common/context-usage.cjs");
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
    `globalThis.__AGPA_TEAMWORK_FACTORY__=${createTeamworkBridge.toString()};globalThis.__AGPA_CONTEXT_FACTORY__=${createContextReader.toString()};globalThis.__AGPA_MODEL_CONTROLS__={selectionFor:${rules.selectionFor.toString()},optionsFor:${rules.optionsFor.toString()},layoutFor:${rules.layoutFor.toString()}}`,
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
test("context metadata updates the indicator, while request counts never fabricate a percentage", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const callbacks = new Set();
    let state = {
      trajectorySlice: {
        generatorMetadatasInSlice: [
          {
            metadata: {
              value: {
                contextWindowMetadata: {
                  estimatedTokensUsed: 291000,
                  maxContextTokens: 475000,
                },
              },
            },
          },
        ],
      },
    };
    const provider = {
      getState: () => state,
      onDidChange(fn) {
        callbacks.add(fn);
        return { dispose: () => callbacks.delete(fn) };
      },
    };
    window.fixture.trigger.__reactFiber$fixture = {
      dependencies: {
        firstContext: {
          memoizedValue: {
            cascadeContext: { state: { agentStateProvider: provider } },
          },
        },
      },
    };
    window.fixture.setContext = (next) => {
      state = next;
      for (const fn of callbacks) fn();
    };
    window.fixture.contextListeners = callbacks;
    window.fixture.trigger.setAttribute("aria-label", "Context fixture");
  });
  const indicator = page.locator(".agpa-context-trigger");
  await expect(indicator).toBeVisible();
  await indicator.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "61% of 475,000 tokens",
  );
  await page.evaluate(() =>
    window.fixture.setContext({
      trajectorySlice: {
        stepsInSlice: [
          {
            metadata: {
              modelUsage: { inputTokens: 3036n, cacheReadTokens: 34547n },
            },
          },
        ],
      },
    }),
  );
  await expect(indicator).not.toHaveAttribute("data-known");
  await expect(page.getByRole("tooltip")).toContainText(
    "Current context use is not reported.",
  );
  await expect(page.getByRole("tooltip")).toContainText("Input: 3,036 tokens");
  await expect(page.getByRole("tooltip")).toContainText(
    "Cache read: 34,547 tokens",
  );
  await page.evaluate(() => window.__AGModelControls.destroy());
  expect(await page.evaluate(() => window.fixture.contextListeners.size)).toBe(
    0,
  );
});
test("native Teamwork editing, rollback, draft preservation and cleanup still pass", async ({
  page,
}) => {
  await setup(page, true);
  const result = await page.evaluate(`(${team.verify.toString()})()`);
  expect(result.checks || result.passed.length).toBeGreaterThan(10);
});
