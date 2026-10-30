#!/usr/bin/env node
'use strict';
// One scope-controlled driver per MCP connection. No HTTP listener or daemon.
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {getPaths} = require('./platform-paths.cjs');
const {read, parse, toolsFor} = require('./computer-use.cjs');
const {VERSION} = require('./computer-use-release.cjs');
async function lease(directory) {
  const state = parse(await read(path.join(directory, 'state.json')));
  const policy = await read(path.join(directory, 'capabilities.json'));
  if (state.version !== 1 || state.enabled !== true || typeof state.revision !== 'string' || !policy ||
      crypto.createHash('sha256').update(policy).digest('hex') !== state.manifestHash) throw Error('Computer use is disconnected.');
  return state;
}
async function main() {
  const directory = path.join(getPaths().configDir, 'computer-use');
  const initial = await lease(directory);
  const adapter = require(process.platform === 'win32' ? '../windows/computer-use.cjs' : '../linux/computer-use.cjs');
  const driver = path.join(directory, 'driver-' + VERSION, adapter.executable);
  const env = {...process.env};
  const restrictivePolicies = Object.fromEntries(['CUA_DRIVER_MANAGED_POLICY_FILE', 'CUA_DRIVER_POLICY_FILE'].filter(key => env[key]).map(key => [key, env[key]]));
  // Do not inherit a permissive runtime, remote daemon, browser grant or policy.
  for (const key of Object.keys(env)) if (/^(CUA_|ELECTRON_|NODE_OPTIONS$)/.test(key)) delete env[key];
  Object.assign(env, restrictivePolicies);
  Object.assign(env, (await adapter.environment()).environment, {CUA_DRIVER_PERMISSION_MODE: initial.scope === 'desktop' ? 'standard' : 'bounded',
    CUA_DRIVER_RS_TELEMETRY_ENABLED: '0', CUA_TELEMETRY_ENABLED: '0'});
  if (initial.scope !== 'desktop') Object.assign(env, {CUA_DRIVER_CAPABILITY_MANIFEST_FILE: path.join(directory, 'capabilities.json'), CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: '1'});
  const child = spawn(driver, ['mcp'], {env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  let stopped = false;
  function stop() {
    if (stopped) return; stopped = true;
    clearInterval(timer); child.stdin.end();
    // Give native runtime/UIA helpers a chance to close on EOF before forcing exit.
    setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (adapter.stopRuntime) adapter.stopRuntime(child).catch(() => child.kill());
      else {child.kill(); setTimeout(() => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');}, 500).unref();}
    }, 750).unref();
  }
  const timer = setInterval(async () => {
    try { if ((await lease(directory)).revision !== initial.revision) stop(); } catch { stop(); }
  }, 300);
  // Expose only our reviewed tools even if the native client ignores enabledTools.
  function lines(stream, onMessage) {
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 32 * 1024 * 1024) return stop();
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {onMessage(JSON.parse(line));} catch {stop();}
      }
    });
  }
  lines(process.stdin, message => {
    if (stopped) return;
    if (!allowedClientMessage(message, initial.apps, process.platform, initial.scope)) {
      if (message.id !== undefined) process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: message.id, error: {code: -32602, message: 'Tool is outside this integration scope.'}}) + '\n');
      return;
    }
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  lines(child.stdout, message => {process.stdout.write(JSON.stringify(filterServerMessage(message, initial.scope)) + '\n');});
  child.stderr.pipe(process.stderr);
  child.stdin.on('error', () => {});
  child.on('error', () => { stop(); process.exitCode = 1; });
  child.on('exit', code => { clearInterval(timer); process.stdin.unpipe(child.stdin); process.stdin.pause(); process.exitCode = stopped ? 0 : code || 0; });
  process.stdin.on('end', stop); process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (require.main === module) main().catch(() => { console.error('Computer use unavailable. Open the plugin setup in Settings.'); process.exitCode = 1; });
function filterServerMessage(message, scope) {
  if (Array.isArray(message.result?.tools)) return {...message, result: {...message.result, tools: message.result.tools.filter(t => toolsFor(scope).includes(t.name))}};
  return message;
}
function allowedClientMessage(message, apps = [], platform = process.platform, scope = 'apps') {
  if (message.method !== 'tools/call') return true;
  if (!toolsFor(scope).includes(message.params?.name)) return false;
  if (message.params.name !== 'launch_app') return true;
  const args = message.params.arguments;
  if (!args || Object.keys(args).some(key => !['name', 'session'].includes(key)) || typeof args.name !== 'string') return false;
  if (scope === 'desktop') return args.name.length > 0 && args.name.length < 4096 && !/[\x00-\x1f;&|`$<>]/.test(args.name);
  return apps.some(app => platform === 'win32' ? app.toLowerCase() === args.name.toLowerCase() : app === args.name);
}
module.exports = {lease, filterServerMessage, allowedClientMessage};
