"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const models = require("../fixtures/model-controls.cjs");
const contextRules = fs.readFileSync(
  path.join(__dirname, "../../common/context-budget.cjs"),
  "utf8",
);
const contextUI = fs.readFileSync(
  path.join(__dirname, "../../common/context-budget.js"),
  "utf8",
);

test("context stays visible in a new chat and updates when transcript data arrives", async ({
  page,
}) => {
  await page.route("https://native.test/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(`(${models.setup.toString()})()`);
  await page.evaluate(
    `(()=>{const module={exports:{}};${contextRules};globalThis.__AGPA_CONTEXT_BUDGET__=module.exports;})()`,
  );
  await page.evaluate(contextUI);
  const pill = page.locator("[data-agpa-context-budget]");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText("— tok");
  await pill.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Context estimates appear after the conversation starts.",
  );
  await page.locator(".agpa-context-close").click();
  await page.evaluate(() => {
    history.replaceState(null, "", "/c/fixture-conversation");
    const viewport = document.createElement("div");
    viewport.dataset.testid = "autoscroll-viewport";
    document.body.append(viewport);
    const api = globalThis.__AGContextBudget;
    api.hydrateFromTranscript(api.getActiveKey(), {
      maxChars: 4000,
      maxTurns: 1,
      apiTokens: 8000,
      inputTokens: 6000,
      outputTokens: 2000,
      turnsList: [],
    });
  });
  await expect(pill).not.toHaveAttribute("data-level", "pending");
  await expect(pill).not.toHaveText("— tok");
  await pill.click();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Context estimates appear after the conversation starts.",
  );
  await page.evaluate(() => globalThis.__AGContextBudget.destroy());
  await expect(pill).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
