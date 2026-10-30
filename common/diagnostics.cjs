"use strict";
/** @typedef {'debug'|'info'|'warn'|'error'|'off'} Level */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, off: 100 };
const CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOSPC",
  "EPIPE",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ABORT_ERR",
]);

/** Operational records intentionally exclude messages, stacks, paths and payloads.
 * @param {{level?: string, write?: (line: string) => unknown, now?: () => number}} options
 */
function createDiagnostics({
  level = process.env.AGPA_LOG_LEVEL || "info",
  write = (line) => process.stderr.write(line),
  now = Date.now,
} = {}) {
  const threshold =
    LEVELS[
      Object.hasOwn(LEVELS, level) ? /** @type {Level} */ (level) : "info"
    ];
  /** @type {Map<string, {time: number, suppressed: number}>} */
  const recent = new Map();
  /** @param {Level} severity @param {string} event @param {unknown} error */
  return (severity, event, error = undefined) => {
    if (LEVELS[severity] < threshold || severity === "off") return;
    if (!/^[a-z][a-z0-9_.]{1,79}$/.test(event))
      event = "diagnostic.invalid_event";
    let code;
    try {
      const value =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (typeof value === "string" && CODES.has(value)) code = value;
    } catch {
      /* Diagnostics must not turn malformed errors into service failures. */
    }
    const time = now(),
      key = `${severity}:${event}:${code || ""}`,
      previous = recent.get(key);
    if (previous && time - previous.time < 60000) {
      previous.suppressed++;
      return;
    }
    if (recent.size >= 128) recent.delete(recent.keys().next().value || "");
    recent.set(key, { time, suppressed: 0 });
    try {
      write(
        JSON.stringify({
          time: new Date(time).toISOString(),
          level: severity,
          event,
          ...(code ? { code } : {}),
          ...(previous?.suppressed ? { suppressed: previous.suppressed } : {}),
        }) + "\n",
      );
    } catch {
      /* Logging cannot interrupt the user's application. */
    }
  };
}
module.exports = { createDiagnostics };
