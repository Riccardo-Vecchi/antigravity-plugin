'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
function powershell(env = process.env) {
  return path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
async function extract(archive, target) {
  await run(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'extract-driver.ps1'), '-Archive', archive, '-Destination', target], {timeout: 45000, windowsHide: true, maxBuffer: 16000});
}
async function environment() {
  return {platform: 'win32', session: 'windows', needsHelper: false, environment: {}, experimental: true};
}
async function defaultApps() {
  const file = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
  try { await fs.access(file); return [file]; } catch { return []; }
}
async function applications() {
  return (await defaultApps()).map(executable => ({name: 'Notepad', executable}));
}
async function stopRuntime(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await run(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000}).catch(() => {});
}
module.exports = {extract, environment, defaultApps, applications, stopRuntime, executable: 'cua-driver.exe', powershell};
