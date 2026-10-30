"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { connect, loopbackSocket } = require("../common/cdp-connection.cjs");
function fixture(options = {}) {
  let socket;
  class Socket {
    readyState = 0;
    sent = [];
    closed = false;
    constructor() {
      socket = this;
      queueMicrotask(() => {
        if (options.fail) this.onerror?.();
        else if (!options.hang) {
          this.readyState = 1;
          this.onopen?.();
        }
      });
    }
    send(value) {
      if (options.sendError) throw Error("send failed");
      this.sent.push(JSON.parse(value));
    }
    message(value) {
      this.onmessage?.({
        data: typeof value === "string" ? value : JSON.stringify(value),
      });
    }
    close() {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return {
    open: (extra) =>
      connect("ws://127.0.0.1:1234/id", { WebSocketClass: Socket, ...extra }),
    socket: () => socket,
  };
}
test("CDP accepts local endpoints only", () => {
  for (const value of [
    "wss://127.0.0.1:1234",
    "ws://evil.test:1234",
    "ws://127.0.0.1",
    "ws://user:secret@127.0.0.1:1234",
    "ws://[::1]:1234",
    "invalid",
  ])
    assert.throws(() => loopbackSocket(value));
  assert.equal(
    loopbackSocket("ws://127.0.0.1:1234/id"),
    "ws://127.0.0.1:1234/id",
  );
});
test("CDP separates events and out-of-order replies, tolerating malformed messages", async () => {
  const f = fixture(),
    events = [];
  const c = await f.open({ onEvent: (event) => events.push(event.method) });
  const a = c.call("first"),
    b = c.call("second");
  for (const data of [
    "bad json",
    "null",
    "[]",
    { id: 99 },
    { method: "Page.changed" },
  ])
    f.socket().message(data);
  f.socket().message({ id: 2, result: { second: true } });
  f.socket().message({ id: 1, result: { first: true } });
  assert.deepEqual(await Promise.all([a, b]), [
    { first: true },
    { second: true },
  ]);
  assert.deepEqual(events, ["Page.changed"]);
  c.close();
});
test("disconnect rejects pending calls and notifies its owner once", async () => {
  const f = fixture();
  let count = 0;
  const c = await f.open({ onClose: () => count++ });
  const rejected = assert.rejects(c.call("pending"), /disconnected/);
  f.socket().close();
  c.close();
  await rejected;
  await assert.rejects(c.call("late"), /disconnected/);
  assert.equal(count, 1);
});
test("timeouts, send exceptions and CDP errors do not poison later calls", async () => {
  const f = fixture(),
    c = await f.open({ requestTimeout: 5 });
  await assert.rejects(c.call("slow"), /timed out/);
  f.socket().message({ id: 1, result: "late" });
  const rejected = assert.rejects(c.call("reject"), /denied/);
  f.socket().message({ id: 2, error: { message: "denied" } });
  await rejected;
  const ok = c.call("success");
  f.socket().message({ id: 3, result: "ok" });
  assert.equal(await ok, "ok");
  c.close();
  const g = fixture({ sendError: true }),
    d = await g.open();
  await assert.rejects(d.call("send"), /send failed/);
  d.close();
});
test("failed and timed-out handshakes close sockets", async () => {
  for (const options of [{ fail: true }, { hang: true }]) {
    const f = fixture(options);
    await assert.rejects(
      f.open({ connectTimeout: 5 }),
      /unavailable|timed out/,
    );
    assert.equal(f.socket().closed, true);
  }
});
test("listener failures do not prevent subsequent replies", async () => {
  const f = fixture(),
    failures = [];
  const c = await f.open({
    onEvent: () => {
      throw Error("listener");
    },
    onListenerError: (error) => failures.push(error.message),
  });
  f.socket().message({ method: "Runtime.changed" });
  const result = c.call("works");
  f.socket().message({ id: 1, result: true });
  assert.equal(await result, true);
  assert.deepEqual(failures, ["listener"]);
  c.close();
});
