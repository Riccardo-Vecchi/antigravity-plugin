"use strict";
const { test, expect, chromium } = require("@playwright/test");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { connect } = require("../../common/cdp-connection.cjs");
test("shared CDP transport talks to a real isolated browser and closes pending requests", async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "agpa-cdp-browser-"));
  let context, connection;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      args: ["--remote-debugging-port=0"],
    });
    const [port] = (
      await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
    ).split("\n");
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
      (response) => response.json(),
    );
    const target = targets.find((target) => target.type === "page"),
      events = [];
    connection = await connect(target.webSocketDebuggerUrl, {
      onEvent: (event) => events.push(event.method),
    });
    await connection.call("Runtime.enable");
    const result = await connection.call("Runtime.evaluate", {
      expression: "Promise.resolve(6*7)",
      awaitPromise: true,
      returnByValue: true,
    });
    expect(result.result.value).toBe(42);
    expect(events).toContain("Runtime.executionContextCreated");
    const pending = connection.call("Runtime.evaluate", {
      expression: "new Promise(()=>{})",
      awaitPromise: true,
    });
    const rejected = expect(pending).rejects.toThrow("disconnected");
    connection.close();
    await rejected;
  } finally {
    connection?.close();
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
