'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const BUNDLE_ID = 'com.google.antigravity';

function failure(code) {
  return Object.assign(
    Error(
      `Antigravity app discovery: ${code}. Set AGPA_APP_BUNDLE or AGPA_APP_EXE to select an installation.`,
    ),
    { code: `AGPA_${code.toUpperCase()}` },
  );
}

async function readBundleId(plistPath, runCommand = run) {
  const raw = await fs.readFile(plistPath);
  if (raw.subarray(0, 8).toString('ascii') === 'bplist00') {
    const { stdout } = await runCommand(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', plistPath],
      { timeout: 1500 },
    );
    return JSON.parse(stdout)?.CFBundleIdentifier || null;
  }
  const text = raw.toString('utf8');
  const match = /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<\s]+)\s*<\/string>/i.exec(
    text,
  );
  if (match) return match[1];
  const { stdout } = await runCommand(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', plistPath],
    { timeout: 1500 },
  );
  return JSON.parse(stdout)?.CFBundleIdentifier || null;
}

async function readBundle(bundle, { runCommand = run } = {}) {
  try {
    if (!path.isAbsolute(bundle)) return null;
    const stat = await fs.stat(bundle);
    if (!stat.isDirectory()) return null;
    const plistPath = path.join(bundle, 'Contents', 'Info.plist');
    const id = await readBundleId(plistPath, runCommand);
    if (String(id || '').toLowerCase() !== BUNDLE_ID) return null;
    const executable = path.join(bundle, 'Contents', 'MacOS', 'Antigravity');
    const exeStat = await fs.stat(executable);
    if (!exeStat.isFile() || !(exeStat.mode & 0o111)) return null;
    const resources = path.join(bundle, 'Contents', 'Resources');
    const asarStat = await fs.stat(path.join(resources, 'app.asar')).catch(() => null);
    if (!asarStat) return null;
    return {
      bundle,
      executable,
      resources,
      real: await fs.realpath(bundle),
      bundleId: BUNDLE_ID,
    };
  } catch {
    return null;
  }
}

async function readExecutable(executable) {
  try {
    if (!path.isAbsolute(executable)) return null;
    const stat = await fs.stat(executable);
    if (!stat.isFile() || !(stat.mode & 0o111)) return null;
    const macosDir = path.dirname(executable);
    const contentsDir = path.dirname(macosDir);
    if (path.basename(macosDir) !== 'MacOS' || path.basename(contentsDir) !== 'Contents')
      return null;
    return await readBundle(path.dirname(contentsDir));
  } catch {
    return null;
  }
}

async function discover({ home = os.homedir(), env = process.env } = {}) {
  if (env.AGPA_APP_EXE) {
    const found = await readExecutable(env.AGPA_APP_EXE);
    if (!found) throw failure('invalid_executable');
    if (env.AGPA_APP_BUNDLE) {
      const selectedBundle = await readBundle(env.AGPA_APP_BUNDLE);
      if (!selectedBundle || selectedBundle.real !== found.real)
        throw failure('invalid_bundle');
    }
    return found;
  }
  if (env.AGPA_APP_BUNDLE) {
    const found = await readBundle(env.AGPA_APP_BUNDLE);
    if (!found) throw failure('invalid_bundle');
    return found;
  }
  const candidates = [
    '/Applications/Antigravity.app',
    path.join(home, 'Applications', 'Antigravity.app'),
  ];
  const byBundle = new Map();
  for (const candidate of candidates) {
    const found = await readBundle(candidate);
    if (found && !byBundle.has(found.real)) byBundle.set(found.real, found);
  }
  if (byBundle.size > 1) throw failure('ambiguous');
  if (!byBundle.size) throw failure('missing');
  return byBundle.values().next().value;
}

async function appWithoutDebugging(profileDir, { runCommand = run, uid = process.getuid?.() } = {}) {
  try {
    const lock = await fs.readlink(path.join(profileDir, 'SingletonLock'));
    const prefix = os.hostname() + '-';
    const pid = lock.slice(prefix.length);
    if (!lock.startsWith(prefix) || !/^[1-9]\d{0,9}$/.test(pid)) return null;
    const { stdout } = await runCommand(
      '/bin/ps',
      ['-p', pid, '-o', 'uid=,command='],
      { timeout: 2000 },
    );
    const line = stdout.trim();
    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (!match) return null;
    if (typeof uid === 'number' && Number(match[1]) !== uid) return null;
    const command = match[2];
    if (!/\/Contents\/MacOS\/Antigravity(?:\s|$)/.test(command)) return null;
    if (/(?:^|\s)--(?:type|remote-debugging-port)(?:=|\s|$)/.test(command)) return null;
    return (await fs.readlink(path.join(profileDir, 'SingletonLock'))) === lock ? pid : null;
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'EINVAL'].includes(error?.code)) return null;
    return null;
  }
}

module.exports = { discover, readBundle, readExecutable, appWithoutDebugging, BUNDLE_ID };
