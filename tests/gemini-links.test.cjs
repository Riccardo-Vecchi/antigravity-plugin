"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm");
const {
  createGeminiLinks,
  externalURL,
} = require("../common/gemini-links.cjs");
test("external destinations accept web URLs only without credentials or protocol tricks", () => {
  for (const url of [
    "file:///tmp/a",
    "javascript:alert(1)",
    "data:text/html,a",
    "https://user:pass@example.com",
    "https://gemini.google.com/app",
    "invalid",
  ])
    assert.equal(externalURL(url), null);
  assert.equal(
    externalURL("https://myactivity.google.com/product/gemini"),
    "https://myactivity.google.com/product/gemini",
  );
});
function fixture() {
  const opened = [],
    errors = [],
    clients = [];
  let proof = null,
    id = 7;
  const owner = { getWebContentsId: () => id };
  const nativeCall = async (method, params) => {
    if (params.expression.includes("executeJavaScriptInIsolatedWorld")) {
      const scope = {
        document: { querySelector: () => owner },
        electronNative: {
          executeJavaScriptInIsolatedWorld: async (guestId, world, code) => {
            const context = {};
            vm.createContext(context);
            if (!code.startsWith("delete "))
              proof =
                vm.runInContext(code, context) &&
                context.__AGPA_LINK_OWNER_PROOF__;
            else proof = null;
          },
        },
      };
      return {
        result: { value: await vm.runInNewContext(params.expression, scope) },
      };
    }
    return { result: { value: id } };
  };
  const connection = async (url, options) => {
    const client = {
      closed: false,
      call: async (method) => {
        if (method === "Runtime.enable") {
          options.onEvent({
            method: "Runtime.executionContextCreated",
            params: { context: { id: 1, auxData: { isDefault: false } } },
          });
          return {};
        }
        if (method === "Runtime.evaluate")
          return {
            result: { value: url.endsWith("/owned") ? proof : "wrong" },
          };
        return {};
      },
      close() {
        this.closed = true;
        options.onClose();
      },
      emit(params) {
        options.onEvent({ method: "Page.windowOpen", params });
      },
    };
    clients.push(client);
    return client;
  };
  const manager = createGeminiLinks({
    nativeCall,
    endpoint: "ws://127.0.0.1:9000/native",
    connection,
    fetchTargets: async () => [
      { type: "webview", webSocketDebuggerUrl: "ws://127.0.0.1:9000/other" },
      { type: "webview", webSocketDebuggerUrl: "ws://127.0.0.1:9000/owned" },
    ],
    openExternal: (url) => opened.push(url),
    report: (error) => errors.push(error),
  });
  return {
    manager,
    clients,
    opened,
    errors,
    proof: () => proof,
    setId: (value) => {
      id = value;
    },
  };
}
test("a private-world ownership proof precedes popup observation and is then removed", async () => {
  const f = fixture();
  await f.manager.sync();
  assert.equal(f.manager.status().attached, true);
  assert.equal(f.clients[0].closed, true);
  assert.equal(f.proof(), null);
  f.clients[0].emit({ url: "https://example.com/other", userGesture: true });
  f.clients[1].emit({
    url: "https://example.com/automatic",
    userGesture: false,
  });
  f.clients[1].emit({ url: "file:///tmp/a", userGesture: true });
  f.clients[1].emit({ url: "https://example.com/clicked", userGesture: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.opened, ["https://example.com/clicked"]);
  await f.manager.sync();
  assert.equal(f.clients.length, 2);
  f.manager.destroy();
  assert.equal(f.clients[1].closed, true);
});
test("guest closure and disabling release the watcher without opening queued links", async () => {
  const f = fixture();
  await f.manager.sync();
  f.setId(null);
  await f.manager.sync();
  assert.equal(f.manager.status().attached, false);
  assert.equal(f.clients[1].closed, true);
  f.setId(8);
  await f.manager.sync();
  f.manager.destroy();
  f.clients.at(-1).emit({ url: "https://example.com/late", userGesture: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.opened, []);
});
