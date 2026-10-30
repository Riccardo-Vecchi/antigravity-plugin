"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createDiagnostics } = require("../common/diagnostics.cjs");
test("diagnostics omit private errors, stacks, URLs and arbitrary error codes", () => {
  const lines = [],
    log = createDiagnostics({
      level: "debug",
      write: (line) => lines.push(line),
    });
  log(
    "warn",
    "config.load_failed",
    Object.assign(Error("/home/private?token=secret"), { code: "EACCES" }),
  );
  log("error", "network.failed", {
    message: "secret",
    code: "private-token",
    stack: "private",
  });
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).code),
    ["EACCES", undefined],
  );
  assert.doesNotMatch(lines.join(""), /secret|private|token|stack|message/);
});
test("levels, repetition limits and bounded events retain useful diagnostics", () => {
  const lines = [];
  let time = 0;
  const log = createDiagnostics({
    level: "warn",
    now: () => time,
    write: (line) => lines.push(JSON.parse(line)),
  });
  log("debug", "debug.event");
  for (let i = 0; i < 100; i++) log("warn", "socket.closed");
  assert.equal(lines.length, 1);
  time = 60000;
  log("warn", "socket.closed");
  assert.equal(lines[1].suppressed, 99);
  log("error", "/home/private");
  assert.equal(lines[2].event, "diagnostic.invalid_event");
  for (let i = 0; i < 200; i++) log("error", `fixture.event${i}`);
  assert.equal(lines.length, 203);
});
test("logging tolerates failing outputs and invalid configured levels", () => {
  const log = createDiagnostics({
    level: "invalid",
    write: () => {
      throw Error("output failed");
    },
  });
  assert.doesNotThrow(() => log("error", "service.failed"));
});
