'use strict';
const VERSION = require('../common/versions.cjs').suite;
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { execFile, spawn } = require('node:child_process'),
  { promisify } = require('node:util');
const run = promisify(execFile);
const identity = require('../common/browser-identity.json');
const { BROWSERS } = require('../common/browser-setup.cjs');

const DAEMON_LABEL = 'com.antigravity-plugin.daemon';
const AUTOSTART_LABEL = 'com.antigravity-plugin.autostart';
const LEGACY_DAEMON_LABEL = 'com.antigravity-project-appearance.daemon';
const LEGACY_AUTOSTART_LABEL = 'com.antigravity-project-appearance.autostart';

async function optional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return null;
  }
}

async function rewrite({ old, next, home, change, remap, plain }) {
  const support = path.join(home, 'Library/Application Support');
  for (const b of BROWSERS) {
    const profile = b.profiles?.darwin;
    if (!profile) continue;
    const file = path.join(
      support,
      ...profile.split('/'),
      'NativeMessagingHosts',
      identity.host + '.json',
    );
    const data = await plain(file);
    if (!data) continue;
    const entry = JSON.parse(data.toString().trim());
    if (
      entry.name === identity.host &&
      entry.path === path.join(old.configDir, 'companion/browser-host.sh')
    ) {
      entry.path = path.join(next.configDir, 'companion/browser-host.sh');
      await change(file, JSON.stringify(entry) + '\n');
    }
  }
  const agents = path.join(home, 'Library/LaunchAgents');
  for (const [legacyLabel, canonicalLabel] of [
    [LEGACY_DAEMON_LABEL, DAEMON_LABEL],
    [LEGACY_AUTOSTART_LABEL, AUTOSTART_LABEL],
  ]) {
    const legacyBytes = await plain(path.join(agents, legacyLabel + '.plist'));
    if (legacyBytes) {
      const updated = remap(
        legacyBytes.toString().split(legacyLabel).join(canonicalLabel),
        old,
        next,
      );
      await change(path.join(agents, canonicalLabel + '.plist'), updated);
    }
    const file = path.join(agents, canonicalLabel + '.plist');
    const bytes = await plain(file);
    if (!bytes) continue;
    const text = bytes.toString();
    const updated = remap(text, old, next);
    if (updated !== text) await change(file, updated);
  }
  const customWrapper = path.join(
    home,
    'Applications/Antigravity (customized).app/Contents/MacOS/Antigravity',
  );
  const wrapperBytes = await plain(customWrapper);
  if (wrapperBytes) {
    const text = wrapperBytes.toString();
    const updated = remap(text, old, next);
    if (updated !== text) await change(customWrapper, updated);
  }
}

function lifecycle({ old, next, home, env }) {
  const clean = { ...env, ELECTRON_RUN_AS_NODE: '1' };
  delete clean.AGPA_LEGACY_RUNTIME;
  const oldEnv = { ...clean, AGPA_LEGACY_RUNTIME: '1' };
  const launch = async (root, option, environment = clean) => {
    let script = path.join(root, 'macos/launcher.cjs');
    if (!(await fs.stat(script).catch(() => null)))
      script = path.join(__dirname, 'launcher.cjs');
    return run(process.execPath, [script, option], {
      env: environment,
      timeout: 15000,
    });
  };
  let startedAt = 0;
  return async (action) => {
    if (action === 'preserve') {
      let script = path.join(old.installDir, 'common/prepare-reload.cjs');
      if (!(await fs.stat(script).catch(() => null)))
        script = path.join(__dirname, '../common/prepare-reload.cjs');
      return run(process.execPath, [script], { env: oldEnv, timeout: 12000 });
    }
    if (action === 'stop') {
      let runtime;
      try {
        runtime = JSON.parse(
          await fs.readFile(path.join(old.configDir, 'updates/runtime.json'), 'utf8'),
        );
      } catch {}
      const domain = typeof process.getuid === 'function' ? `gui/${process.getuid()}` : null;
      if (domain) {
        await run('/bin/launchctl', ['bootout', `${domain}/${LEGACY_DAEMON_LABEL}`], {
          timeout: 5000,
        }).catch(() => {});
      }
      await launch(old.installDir, '--stop', oldEnv).catch(() => {});
      if (Number.isInteger(runtime?.pid) && runtime.pid > 0) {
        for (let n = 0; n < 60; n++) {
          let alive = true;
          try {
            process.kill(runtime.pid, 0);
          } catch (e) {
            if (e.code === 'ESRCH') alive = false;
            else throw e;
          }
          if (!alive) break;
          if (n === 59)
            throw Error('The old helper is still stopping. Retry migration shortly.');
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const status = path.join(old.configDir, 'macos-native-status.json');
      let native;
      try {
        native = JSON.parse(await fs.readFile(status, 'utf8'));
      } catch {}
      if (native?.active === true) {
        const request = path.join(old.configDir, 'macos-icon-request.json');
        const temp = request + '.migration.tmp';
        await fs.writeFile(
          temp,
          JSON.stringify({ version: 1, choice: 'antigravity', restore: true }),
          { mode: 0o600 },
        );
        await fs.rename(temp, request);
        for (let n = 0; n < 40; n++) {
          let current;
          try {
            current = JSON.parse(await fs.readFile(status, 'utf8'));
          } catch {}
          if (current?.active === false) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
    if (action === 'stopNew') {
      await launch(next.installDir, '--stop').catch(() => {});
    }
    if (action === 'start' || action === 'rollback') {
      const root = action === 'start' ? next.installDir : old.installDir;
      const environment = action === 'start' ? clean : oldEnv;
      startedAt = Date.now();
      const c = spawn(
        process.execPath,
        [path.join(root, 'macos/launcher.cjs'), '--watch'],
        { env: environment, detached: true, stdio: 'ignore' },
      );
      await new Promise((r, j) => {
        c.once('spawn', r);
        c.once('error', j);
      });
      c.unref();
    }
    if (action === 'health') {
      for (let i = 0; i < 60; i++) {
        try {
          const h = JSON.parse(
            await fs.readFile(
              path.join(next.configDir, 'updates/runtime.json'),
              'utf8',
            ),
          );
          if (h.ready && h.at >= startedAt && h.version === VERSION) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      throw Error('Migrated macOS helper did not become ready.');
    }
    if (action === 'restore') {
      const root = (await optional(
        path.join(next.installDir, 'common/prepare-reload.cjs'),
      ))
        ? next.installDir
        : old.installDir;
      return run(
        process.execPath,
        [path.join(root, 'common/prepare-reload.cjs'), '--restore'],
        { env: clean, timeout: 12000 },
      );
    }
    if (action === 'finalize') {
      const agents = path.join(home, 'Library/LaunchAgents');
      for (const label of [LEGACY_DAEMON_LABEL, LEGACY_AUTOSTART_LABEL]) {
        await fs.rm(path.join(agents, label + '.plist'), { force: true }).catch(() => {});
      }
    }
  };
}

module.exports = { rewrite, lifecycle };
