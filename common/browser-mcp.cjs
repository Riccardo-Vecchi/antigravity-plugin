#!/usr/bin/env node
"use strict";
// Transparent MCP transport to the official engine. Browser tools live upstream.
const readline = require("node:readline"),
  { connect } = require("./companion-core.cjs");
async function main() {
  let connection,
    connecting,
    initialized = false;
  const pending = new Set();
  async function transport() {
    if (connection) return connection;
    connecting ||= connect(
      "mcp",
      () => {},
      () => {
        connection = null;
        connecting = null;
      },
    )
      .then((p) => (connection = p))
      .catch((e) => {
        connecting = null;
        throw e;
      });
    return connecting;
  }
  function reply(id, value) {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, ...value }) + "\n",
    );
  }
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (Buffer.byteLength(line) > 8 * 1024 * 1024) {
      input.close();
      break;
    }
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (!m || m.jsonrpc !== "2.0" || m.id === undefined) continue;
    if (pending.size >= 32) {
      reply(m.id, {
        error: { code: -32000, message: "Too many browser requests." },
      });
      continue;
    }
    const job = (async () => {
      try {
        if (m.method !== "initialize" && !initialized)
          throw Error("Initialize first.");
        if (m.method === "initialize" && initialized)
          throw Error("Already initialized.");
        const p = await transport(),
          result = await p.request(
            "rpc",
            { method: m.method, params: m.params },
            60000,
          );
        if (m.method === "initialize") initialized = true;
        reply(m.id, { result });
      } catch (e) {
        reply(m.id, { error: { code: -32000, message: e.message } });
      }
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  }
  await Promise.allSettled(pending);
  connection?.close();
}
if (require.main === module)
  main().catch(() => {
    process.exitCode = 1;
  });
module.exports = { main };
