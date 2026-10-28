"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  primaryLayout,
  createHoverIntent,
} = require("../common/sidebar-layout.cjs");
test("primary navigation never uses the file viewer sidebar toggle, even when it is first in the document", () => {
  const primary = {},
    secondary = {},
    panel = {},
    navigation = { parentElement: { parentElement: panel } },
    brand = { parentElement: { querySelector: () => primary } };
  const document = {
    querySelector(selector) {
      if (selector.includes("app-icon-new")) return brand;
      if (selector.includes("settings-button"))
        return { closest: () => navigation };
      return secondary;
    },
  };
  const result = primaryLayout(document);
  assert.equal(result.toggle, primary);
  assert.equal(result.panel, panel);
  assert.notEqual(result.toggle, secondary);
  assert.equal(primaryLayout({ querySelector: () => null }).toggle, undefined);
});
function fixture() {
  let id = 0,
    time = 0;
  const timers = new Map(),
    events = [];
  let allowed = true;
  const intent = createHoverIntent({
    open: () => {
      events.push("open");
      return true;
    },
    close: () => events.push("close"),
    canClose: () => allowed,
    setTimer: (fn, delay) => {
      timers.set(++id, { fn, at: time + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const tick = (ms) => {
    time += ms;
    for (const [id, timer] of [...timers])
      if (timer.at <= time) {
        timers.delete(id);
        timer.fn();
      }
  };
  return { intent, tick, events, timers, allow: (value) => (allowed = value) };
}
test("passing the edge briefly does not open the sidebar", () => {
  const f = fixture();
  f.intent.enter();
  f.tick(50);
  f.intent.leave();
  f.tick(500);
  assert.deepEqual(f.events, []);
});
test("re-entry cancels a pending close and the following departure can close normally", () => {
  const f = fixture();
  f.intent.enter();
  f.tick(110);
  f.intent.leave();
  f.tick(100);
  f.intent.enter();
  f.tick(500);
  assert.deepEqual(f.events, ["open"]);
  f.intent.leave();
  f.tick(220);
  assert.deepEqual(f.events, ["open", "close"]);
  f.intent.enter();
  f.tick(110);
  assert.deepEqual(f.events, ["open", "close", "open"]);
});
test("menus and active input can defer closing; disposal cancels pending opening", () => {
  const f = fixture();
  f.intent.enter();
  f.tick(110);
  f.allow(false);
  f.intent.leave();
  f.tick(220);
  assert.deepEqual(f.events, ["open"]);
  f.allow(true);
  f.intent.leave();
  f.tick(220);
  assert.deepEqual(f.events, ["open", "close"]);
  f.intent.enter();
  f.intent.destroy();
  f.tick(1000);
  assert.equal(f.events.filter((x) => x === "open").length, 1);
  assert.equal(f.timers.size, 0);
});
test("coupled transitions start on one clock without resetting running animations or unrelated effects", () => {
  const { startSidebarMotion } = require("../common/sidebar-layout.cjs");
  const make = (property) => ({
    pending: true,
    startTime: null,
    playState: "running",
    transitionProperty: property,
  });
  const width = make("width"),
    transform = make("transform"),
    other = make("color"),
    running = { ...make("width"), pending: false, startTime: 17 };
  startSidebarMotion(
    [
      { getAnimations: () => [width, other, running] },
      { getAnimations: () => [transform] },
      null,
    ],
    { currentTime: 200 },
  );
  assert.equal(width.startTime, 200);
  assert.equal(transform.startTime, 200);
  assert.equal(other.startTime, null);
  assert.equal(running.startTime, 17);
});
