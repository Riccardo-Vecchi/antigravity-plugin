"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { filterItems } = require("../../common/library.cjs");
const { createBrowserPicker } = require("../../common/browser-picker.cjs");
const root = path.join(__dirname, "../..");

async function mountLibrary(
  page,
  files,
  { failBundleOnce = false, delayBundle = false } = {},
) {
  const requests = [],
    network = [];
  let release;
  const gate = delayBundle
    ? new Promise((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  await page.route("**/*", (route) => {
    if (route.request().url() === "https://native.test/")
      return route.fulfill({
        contentType: "text/html",
        body: '<button data-testid="automations-button">Automations</button>',
      });
    network.push(route.request().url());
    return route.abort();
  });
  await page.goto("https://native.test/");
  const items = files.map((file, index) => ({
    id: `file-${index}`,
    name: `sample-${index}.${file.extension}`,
    path: `/fixture/sample-${index}.${file.extension}`,
    extension: file.extension,
    category: file.category,
    source: "generated",
    size: file.bytes.length,
    modified: 0,
    favorite: false,
  }));
  await page.exposeFunction("__fixtureRequest", async (payload) => {
    requests.push(payload.action);
    if (payload.action === "list" || payload.action === "refresh")
      return { items };
    if (payload.action === "viewerBundle") {
      await gate;
      if (failBundleOnce) {
        failBundleOnce = false;
        throw Error("temporary");
      }
      return fs.readFileSync(
        path.join(root, "assets/viewers/viewers.js"),
        "utf8",
      );
    }
    const index = items.findIndex((item) => item.id === payload.value);
    if (index < 0) throw Error("unknown fixture");
    return {
      ...items[index],
      data: Buffer.from(files[index].bytes).toString("base64"),
    };
  });
  await page.evaluate(
    (catalogs) => {
      window.__AGPA_TRANSLATIONS__ = catalogs;
    },
    JSON.parse(fs.readFileSync(path.join(root, "common/locales.json"))),
  );
  await page.evaluate(
    fs.readFileSync(path.join(root, "common/i18n.js"), "utf8"),
  );
  await page.evaluate(
    `window.__AGPA_FILTER_LIBRARY__=${filterItems.toString()};window.__AGPA_LIBRARY_PICKER__=${createBrowserPicker.toString()}`,
  );
  await page.evaluate(() => {
    window.__AGPAPrimaryLayout = () => ({});
    window.__agpaLibrary = (raw) => {
      const payload = JSON.parse(raw);
      window.__fixtureRequest(payload).then(
        (result) =>
          window.__AGLibrary?.onResult(payload.requestId, true, result),
        () =>
          window.__AGLibrary?.onResult(payload.requestId, false, {
            error: "unavailable",
          }),
      );
    };
  });
  await page.evaluate(
    fs.readFileSync(path.join(root, "common/library-ui.js"), "utf8"),
  );
  await page.evaluate(() => __AGLibrary.open());
  return { requests, network, release, items };
}
module.exports = { mountLibrary };
