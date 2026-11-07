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

async function setup(page) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(`(${models.setup.toString()})()`);
  await page.evaluate(
    `(()=>{const module={exports:{}};${contextRules};globalThis.__AGPA_CONTEXT_BUDGET__=module.exports;})()`,
  );
  await page.evaluate(contextUI);
}

test("context is hidden in new chats and appears when transcript data arrives", async ({
  page,
}) => {
  await setup(page);
  const pill = page.locator("[data-agpa-context-budget]");
  await expect(pill).toHaveCount(0);
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
    });
  });
  await page.evaluate(() => {
    const response = document.createElement("div");
    response.innerHTML =
      '<div><button aria-label="Good response">Like</button><button aria-label="Copy">Copy</button></div>';
    document
      .querySelector("[data-testid=autoscroll-viewport]")
      .append(response);
    globalThis.__AGContextBudget.refresh();
  });
  await expect(
    page.locator(".agpa-turn-token-badge,.agpa-turn-tooltip"),
  ).toHaveCount(0);
  await expect(pill).toBeVisible();
  await expect(pill.locator(".agpa-context-ring")).toBeVisible();
  await expect(pill).toHaveAttribute("aria-label", /tokens/);
  await pill.click();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Context estimates appear after the conversation starts.",
  );
  await page.evaluate(() => {
    history.replaceState(null, "", "/");
    document.querySelector("[data-testid=autoscroll-viewport]")?.remove();
    globalThis.__AGPA_CONTEXT_BUDGET__.clearCache();
    globalThis.__AGContextBudget.refresh();
  });
  await expect(pill).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => globalThis.__AGContextBudget.destroy());
  await expect(pill).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("context popup has a coherent breakdown, expandable details and responsive placement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 680, height: 540 });
  await setup(page);
  await page.evaluate(() => {
    const rules = globalThis.__AGPA_CONTEXT_BUDGET__;
    const stats = rules.extractConversationStats(document);
    rules.extractConversationStats = () => ({
      ...stats,
      tokens: 78000,
      chars: 20000,
      turns: 1,
      ceiling: 1000000,
      systemTokens: 2000,
      cacheReadTokens: 50000,
      inputTokens: 20000,
      outputTokens: 111,
      modelName: "Claude Opus 4.6 (Thinking)",
      formatted: "~78k",
      budget: rules.budgetLevelFor(78000, 1000000),
    });
    globalThis.__AGContextBudget.refresh();
  });
  const pill = page.locator("[data-agpa-context-budget]");
  await pill.click();
  const popup = page.getByRole("dialog", { name: "Context window" });
  await expect(popup.locator(".agpa-context-used")).toHaveText(
    "~78k of ~1M tokens used",
  );
  await expect(popup.locator(".agpa-context-full")).toHaveText("8% full");
  await expect(popup.locator(".agpa-context-donut")).toBeVisible();
  await expect(popup.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "8",
  );
  await expect(popup.locator(".agpa-context-instructions")).toContainText(
    "~2k",
  );
  await expect(popup.locator(".agpa-context-conversation")).toContainText(
    "~76k",
  );
  await expect(popup.locator(".agpa-context-free")).toContainText("~922k");
  await expect(popup.locator(".agpa-context-breakdown")).toBeHidden();
  await popup.screenshot({ path: "output/context-window-preview.png" });
  await popup.getByText("Usage details", { exact: true }).click();
  await expect(popup.locator(".agpa-context-breakdown")).toBeVisible();
  await expect(popup.locator(".agpa-context-breakdown")).toContainText("~50k");
  await page.setViewportSize({ width: 280, height: 380 });
  await page.evaluate(() => {
    document.querySelector(".fixture-footer").style.width = "240px";
  });
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(pill).toBeFocused();
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await pill.click();
  await popup.getByText("Usage details", { exact: true }).click();
  await expect
    .poll(async () => {
      const box = await popup.boundingBox();
      return (
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 280 &&
        box.y + box.height <= 380
      );
    })
    .toBe(true);
});

test("native context controls replace the fallback without replacing native behavior", async ({
  page,
}) => {
  await setup(page);
  const pill = page.locator("[data-agpa-context-budget]");
  const model = page.locator("[data-testid=model-selector-trigger]");
  await page.evaluate(() => {
    const rules = globalThis.__AGPA_CONTEXT_BUDGET__,
      old = rules.extractConversationStats(document);
    rules.extractConversationStats = () => ({
      ...old,
      turns: 1,
      chars: 4000,
      apiTokens: 8000,
      tokens: 8000,
      formatted: "~8k",
    });
    globalThis.__AGContextBudget.refresh();
  });
  await expect(pill).toBeVisible();
  const ringBox = await pill.boundingBox(),
    modelBox = await model.boundingBox();
  expect(ringBox.x + ringBox.width).toBeLessThanOrEqual(modelBox.x + 1);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.dataset.testid = "context-usage-indicator";
    button.innerHTML =
      '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg><span>4%</span>';
    globalThis.nativeContextClicks = 0;
    button.onclick = () => {
      globalThis.nativeContextClicks++;
    };
    document
      .querySelector("[data-testid=model-selector-trigger]")
      .before(button);
    globalThis.nativeContextMarkup = button.outerHTML;
    globalThis.__AGContextBudget.refresh();
  });
  await expect(pill).toHaveCount(0);
  await page.locator("[data-testid=context-usage-indicator]").click();
  expect(await page.evaluate(() => globalThis.nativeContextClicks)).toBe(1);
  expect(
    await page
      .locator("[data-testid=context-usage-indicator]")
      .evaluate((n) => n.outerHTML),
  ).toBe(await page.evaluate(() => globalThis.nativeContextMarkup));
  await page.evaluate(() => globalThis.__AGContextBudget.destroy());
  await expect(
    page.locator("[data-testid=context-usage-indicator]"),
  ).toBeVisible();
  await expect(model).not.toHaveAttribute("data-agpa-context-adjacent");
});
test("hover shows the graphical overview, click expands details and leaving dismisses only the preview", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const rules = globalThis.__AGPA_CONTEXT_BUDGET__,
      stats = rules.extractConversationStats(document);
    rules.extractConversationStats = () => ({
      ...stats,
      turns: 1,
      chars: 4000,
      tokens: 184400,
      ceiling: 1000000,
      formatted: "~184k",
      budget: rules.budgetLevelFor(184400, 1000000),
    });
    globalThis.__AGContextBudget.refresh();
  });
  const pill = page.locator("[data-agpa-context-budget]"),
    tip = page.getByRole("tooltip", { name: "Context window" });
  await expect(pill).not.toHaveAttribute("title");
  await pill.hover();
  await expect(tip.locator(".agpa-context-donut")).toBeVisible();
  await expect(tip.locator(".agpa-context-full")).toHaveText("18% full");
  await expect(tip.locator(".agpa-context-used")).toHaveText(
    "~184.4k of ~1M tokens used",
  );
  await expect(
    tip.locator(".agpa-context-row,.agpa-context-details,button"),
  ).toHaveCount(0);
  await expect(pill).toHaveAttribute("aria-expanded", "false");
  await expect(pill).toHaveAttribute("aria-describedby", "agpa-context-hover");
  await tip.hover();
  await expect(tip).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
  await pill.hover();
  await expect(tip).toBeVisible();
  await pill.click();
  const dialog = page.getByRole("dialog", { name: "Context window" });
  await expect(tip).toHaveCount(0);
  await expect(dialog.locator(".agpa-context-donut")).toBeVisible();
  await expect(dialog.locator(".agpa-context-row").first()).toBeVisible();
  await expect(pill).toHaveAttribute("aria-expanded", "true");
  await expect(pill).not.toHaveAttribute("aria-describedby");
  await page.mouse.move(5, 5);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await pill.hover();
  await page.evaluate(() => globalThis.__AGContextBudget.destroy());
  await page.waitForTimeout(250);
  await expect(page.locator(".agpa-context-popup")).toHaveCount(0);
});
