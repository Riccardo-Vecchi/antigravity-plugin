"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs"),
  path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../../common/model-ui.js"),
  "utf8",
);
async function setup(page) {
  await page.route("https://native.test/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<style>body{margin:0;background:#171717;color:#ccc}button{height:30px}.glass{backdrop-filter:blur(20px) saturate(1.6)}[role=menu]{background:#222;padding:5px;width:300px}</style><div style="position:fixed;bottom:20px;left:8px;width:180px"><button data-testid="settings-button" style="width:180px">Settings</button></div><button data-testid="model-selector-trigger" aria-expanded="false" style="position:fixed;left:500px;bottom:10px"><span>Gemini Fixture</span></button>',
    }),
  );
  await page.goto("https://native.test/");
  await page.evaluate(() => {
    globalThis.__AGPAI18n = {
      t: (k, p = {}) =>
        k.replace(/\{(\w+)\}/g, (_, name) => String(p[name] ?? `{${name}}`)),
      attrs() {},
      set(n, k, p = {}, a = "text") {
        if (a === "text") n.textContent = k;
        else n.setAttribute(a, k);
      },
      subscribe: () => () => {},
    };
    globalThis.__AGPAProviderFor = () => null;
    globalThis.__AGPAPermissionFor = () => null;
    globalThis.__AGPA_LAB_ICONS__ = {};
    const trigger = document.querySelector(
      "[data-testid=model-selector-trigger]",
    );
    let portal;
    trigger.onclick = () => {
      if (portal) {
        portal.remove();
        portal = null;
        trigger.setAttribute("aria-expanded", "false");
        return;
      }
      trigger.setAttribute("aria-expanded", "true");
      portal = document.createElement("div");
      portal.style.cssText =
        "position:absolute;left:0;top:0;transform:translate(500px,400px);will-change:transform";
      portal.innerHTML =
        '<div role="menu" data-open class="glass"><div data-testid="model-selector-panel"><div><button role="menuitem" aria-haspopup="menu">View Usage</button></div></div></div>';
      document.body.append(portal);
      portal.querySelector("button").onclick = () => {
        const wrapper = document.createElement("div");
        wrapper.setAttribute("role", "presentation");
        wrapper.style.cssText =
          "position:fixed;left:0;top:0;transform:translate(308px,190px);will-change:transform";
        wrapper.innerHTML =
          '<div role="menu" data-open data-nested style="width:310px;height:180px">Usage</div>';
        portal.querySelector("button").parentElement.append(wrapper);
      };
    };
  });
  await page.evaluate(source);
}
for (const compact of [false, true])
  test(`Usage stays docked from first paint with native glass and transform hints (${compact ? "compact" : "expanded"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 720 });
    await setup(page);
    const samples = await page.evaluate(async (compact) => {
      let button = document.querySelector("[data-agpa-view-usage]");
      if (compact) {
        button = document.createElement("button");
        button.style.cssText =
          "position:fixed;left:8px;bottom:80px;width:36px;height:36px";
        button.textContent = "Usage";
        document.body.append(button);
      }
      const anchor = button.getBoundingClientRect().toJSON();
      globalThis.__AGModelUI.openUsage(button);
      const frames = [];
      for (let i = 0; i < 12; i++) {
        await new Promise(requestAnimationFrame);
        const menu = document.querySelector("[data-agpa-usage-menu]");
        if (menu && getComputedStyle(menu).visibility === "visible") {
          const r = menu.getBoundingClientRect();
          frames.push({ x: r.x, y: r.y, bottom: r.bottom });
        }
      }
      return { anchor, frames };
    }, compact);
    expect(samples.frames.length).toBeGreaterThan(5);
    for (const frame of samples.frames) {
      expect(frame.y).toBeGreaterThan(8);
      expect(Math.abs(frame.bottom - samples.anchor.bottom)).toBeLessThan(1.5);
    }
    await page.evaluate(() =>
      document.dispatchEvent(
        new PointerEvent("pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    await expect(page.locator("[data-agpa-usage-menu]")).toHaveCount(0);
    await page.locator("[data-testid=model-selector-trigger]").click();
    await expect(page.locator("[data-agpa-usage-root]")).toBeVisible();
    expect(
      await page
        .locator("[data-agpa-usage-root]")
        .evaluate((n) => getComputedStyle(n).backdropFilter),
    ).toContain("blur");
  });
test("Usage stays available on Automations without creating a conversation or opening the model menu", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    document.querySelector("[data-testid=model-selector-trigger]").remove();
    const settings = document.querySelector("[data-testid=settings-button]");
    const service = {
      async retrieveUserQuotaSummary() {
        return {
          response: {
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    window: "weekly",
                    remaining: { case: "remainingFraction", value: 0.37 },
                    resetTime: {
                      seconds: Math.floor(Date.now() / 1000) + 3600,
                    },
                  },
                ],
              },
            ],
          },
        };
      },
    };
    settings.__reactFiber$fixture = {
      memoizedProps: { value: { core: { cloudCodeService: service } } },
    };
  });
  await page.locator("[data-agpa-view-usage]").hover();
  const popup = page.locator(".agpa-standalone-usage");
  await expect(popup).toContainText("37% left");
  await expect(popup).toContainText("Weekly limit");
  const rect = await popup.boundingBox(),
    anchor = await page.locator("[data-agpa-view-usage]").boundingBox();
  expect(
    Math.abs(rect.y + rect.height - anchor.y - anchor.height),
  ).toBeLessThan(2);
  await expect(page.locator("[data-testid=model-selector-panel]")).toHaveCount(
    0,
  );
  await page.mouse.move(900, 200);
  await expect(popup).toHaveCount(0);
  await page.locator("[data-agpa-view-usage]").click();
  await expect(popup).toContainText("37% left");
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
});
test("Usage shows an actionable unavailable state instead of silent failure outside conversations", async ({
  page,
}) => {
  await setup(page);
  await page
    .locator("[data-testid=model-selector-trigger]")
    .evaluate((n) => n.remove());
  await page.locator("[data-agpa-view-usage]").hover();
  await expect(page.locator(".agpa-standalone-usage")).toContainText(
    "Could not load usage",
  );
  await expect(
    page.getByRole("button", { name: "Refresh usage" }),
  ).toBeVisible();
});

test("sidebar View Usage inherits the Settings typography", async ({
  page,
}) => {
  await setup(page);
  await page.addStyleTag({
    content: "button{font-size:14px;line-height:20px}.text-sm{font-size:12px}",
  });
  const label = page.locator("[data-agpa-view-usage] > span").last();
  await expect(label).toHaveCSS("font-size", "14px");
  await expect(label).toHaveCSS("line-height", "20px");
});
