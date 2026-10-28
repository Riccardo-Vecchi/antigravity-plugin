#!/usr/bin/env node
"use strict";
const { connect, MAX_FRAME } = require("./companion-core.cjs");
const { extensionId } = require("./browser-identity.json");
async function main() {
  if (
    !process.argv.slice(2).includes("chrome-extension://" + extensionId + "/")
  )
    throw Error("Unrecognized extension.");
  let buffer = Buffer.alloc(0),
    connection,
    stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    connection?.close();
    process.stdin.pause();
    process.exitCode = 0;
  }
  function output(message) {
    const data = Buffer.from(JSON.stringify(message));
    if (data.length > 1024 * 1024)
      throw Error("Native host message is too large.");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(data.length);
    process.stdout.write(Buffer.concat([header, data]));
  }
  connection = await connect(
    "browser",
    (message) => output(message),
    () => {
      try {
        output({ action: "disconnected" });
      } catch {}
      stop();
    },
  );
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_FRAME + 4) return stop();
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (!size || size > MAX_FRAME) return stop();
      if (buffer.length < size + 4) break;
      const data = buffer.subarray(4, 4 + size);
      buffer = buffer.subarray(4 + size);
      try {
        connection.send(JSON.parse(data));
      } catch {
        return stop();
      }
    }
  });
  process.stdin.on("end", stop);
  process.stdout.on("error", stop);
  process.on("SIGTERM", stop);
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write("Antigravity Plugin browser bridge unavailable.\n");
    process.exitCode = 1;
  });
module.exports = { main };
