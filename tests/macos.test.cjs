'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const macInstall = require('../macos/installation.cjs');
const { createController } = require('../macos/desktop.cjs');
const { installNativeController } = require('../macos/native-controller.cjs');
const macBrowser = require('../macos/browser.cjs');
const macCu = require('../macos/computer-use.cjs');
const macMigration = require('../macos/migration.cjs');
const { createUpdater } = require('../common/plugin-update.cjs');
const updateCore = require('../common/plugin-update-core.cjs');
const { build } = require('../scripts/build-update.cjs');
const manifest = require('../common/distribution.json');

async function makeTempDir(t, prefix = 'agpa-mac-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function makeFakeApp(root, name = 'Antigravity.app', bundleId = 'com.google.antigravity') {
  const bundle = path.join(root, name);
  const exe = path.join(bundle, 'Contents', 'MacOS', 'Antigravity');
  const resources = path.join(bundle, 'Contents', 'Resources');
  await fs.mkdir(path.dirname(exe), { recursive: true });
  await fs.mkdir(resources, { recursive: true });
  await fs.writeFile(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(path.join(resources, 'app.asar'), 'asar');
  await fs.writeFile(
    path.join(bundle, 'Contents', 'Info.plist'),
    `<plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`,
  );
  return { bundle, exe, resources };
}

test('macOS installation discovery validates bundle identifier, executable and overrides', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-app-');
  const good = await makeFakeApp(root, 'Antigravity.app', 'com.google.antigravity');
  const other = await makeFakeApp(root, 'Antigravity IDE.app', 'com.google.antigravity.ide');

  const found = await macInstall.discover({ home: root, env: { AGPA_APP_BUNDLE: good.bundle } });
  assert.equal(found.bundle, good.bundle);
  assert.equal(found.executable, good.exe);
  assert.equal(found.resources, good.resources);

  const byExe = await macInstall.discover({ home: root, env: { AGPA_APP_EXE: good.exe } });
  assert.equal(byExe.bundle, good.bundle);

  await assert.rejects(
    macInstall.discover({ home: root, env: { AGPA_APP_BUNDLE: other.bundle } }),
    { code: 'AGPA_INVALID_BUNDLE' },
  );
  await assert.rejects(
    macInstall.discover({ home: root, env: { AGPA_APP_BUNDLE: path.join(root, 'Missing.app') } }),
    { code: 'AGPA_INVALID_BUNDLE' },
  );
});

test('macOS appWithoutDebugging inspects SingletonLock and ps command arguments', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-lock-');
  const lock = path.join(root, 'SingletonLock');
  await fs.symlink(`${os.hostname()}-4321`, lock);

  const missingPort = await macInstall.appWithoutDebugging(root, {
    uid: 501,
    runCommand: async () => ({
      stdout: '501 /Applications/Antigravity.app/Contents/MacOS/Antigravity\n',
    }),
  });
  assert.equal(missingPort, '4321');

  const withPort = await macInstall.appWithoutDebugging(root, {
    uid: 501,
    runCommand: async () => ({
      stdout:
        '501 /Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=0\n',
    }),
  });
  assert.equal(withPort, null);

  const helperProc = await macInstall.appWithoutDebugging(root, {
    uid: 501,
    runCommand: async () => ({
      stdout:
        '501 /Applications/Antigravity.app/Contents/MacOS/Antigravity --type=renderer\n',
    }),
  });
  assert.equal(helperProc, null);
});

test('macOS desktop controller manages Dock/tray requests, LaunchAgent autostart, and rollback', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-desk-');
  const configDir = path.join(root, 'config');
  const installDir = path.join(root, 'install');
  const osascriptCalls = [];
  const make = () =>
    createController({
      paths: { configDir, installDir, profileDir: path.join(root, 'profile') },
      home: root,
      pidAlive: (pid) => {
        if (pid !== 777) throw Error('ESRCH');
      },
      discoverInstallation: async () => ({ bundle: '/Applications/Antigravity.app' }),
      withoutDebugging: async () => '888',
      runProgram: async (exe, args) => {
        osascriptCalls.push([exe, args]);
        return { stdout: '' };
      },
      runtime: '/usr/local/bin/node',
    });

  const c = make();
  await c.initialize();
  assert.equal(c.getState().platform, 'darwin');
  assert.equal(c.getState().autostart, false);

  await c.apply('gemini');
  await c.setStartupView('last');
  await c.setView('gemini');
  await c.setAutostart(true);

  const plist = path.join(root, 'Library/LaunchAgents/com.antigravity-plugin.autostart.plist');
  const plistText = await fs.readFile(plist, 'utf8');
  assert.ok(plistText.includes('com.antigravity-plugin.autostart'));
  assert.ok(plistText.includes(path.join(installDir, 'macos', 'launcher.cjs')));

  const next = make();
  await next.initialize();
  assert.equal(next.getState().startupTarget, 'gemini');
  assert.equal(next.getState().taskbarIcon, 'gemini');
  assert.equal(next.getState().autostart, true);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(configDir, 'macos-icon-request.json'), 'utf8')),
    { version: 1, choice: 'gemini' },
  );

  const statusFile = path.join(configDir, 'macos-native-status.json');
  await fs.writeFile(
    statusFile,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      pid: 777,
      active: true,
      tray: true,
      inspectorClosed: true,
    }),
  );
  await next.ensureTray();
  assert.equal(next.getState().desktopIconAvailable, true);
  assert.equal(next.getState().trayAvailable, true);

  await next.pause();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(configDir, 'macos-icon-request.json'), 'utf8')).choice,
    'antigravity',
  );
  await next.resume();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(configDir, 'macos-icon-request.json'), 'utf8')).choice,
    'gemini',
  );

  // Rollback autostart when app.json cannot be written.
  await c.setAutostart(false);
  await fs.rm(path.join(configDir, 'app.json'));
  await fs.mkdir(path.join(configDir, 'app.json'));
  await assert.rejects(c.setAutostart(true));
  await assert.rejects(fs.stat(plist), { code: 'ENOENT' });

  // restoreIntegration waits for active native controller to acknowledge restore.
  await fs.rm(path.join(configDir, 'app.json'), { recursive: true, force: true });
  const r = make();
  await fs.writeFile(
    statusFile,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      pid: 777,
      active: true,
      tray: true,
      inspectorClosed: true,
    }),
  );
  setTimeout(() => {
    fs.writeFile(
      statusFile,
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        pid: 777,
        active: false,
        tray: true,
        inspectorClosed: true,
      }),
    ).catch(() => {});
  }, 150);
  const restored = await r.restoreIntegration();
  assert.equal(restored.desktopIconAvailable, false);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(configDir, 'macos-icon-request.json'), 'utf8')).restore,
    true,
  );
});

test('macOS native controller updates Dock and tray images and restores on destroy', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-native-');
  const requestFile = path.join(root, 'macos-icon-request.json');
  const statusFile = path.join(root, 'macos-native-status.json');
  await fs.writeFile(requestFile, JSON.stringify({ version: 1, choice: 'gemini' }));

  const dockCalls = [];
  const trayImages = [];
  let templateCalled = false;
  const fakeImage = (tag) => ({
    tag,
    isEmpty: () => false,
    setTemplateImage: () => {
      templateCalled = true;
    },
    resize: ({ width, height }) => ({ tag: `${tag}:${width}x${height}`, isEmpty: () => false }),
  });

  const Module = require('node:module');
  const fakeTray = {
    isDestroyed: () => false,
    setImage: (img) => trayImages.push(img.tag),
  };
  const fakeElectron = {
    app: { dock: { setIcon: (img) => dockCalls.push(img.tag) } },
    nativeImage: { createFromPath: (p) => fakeImage(path.basename(p)) },
  };
  const origMain = process.mainModule;
  const origResources = process.resourcesPath;
  process.resourcesPath = root;
  process.mainModule = {
    require(name) {
      if (name === 'electron') return fakeElectron;
      return Module.prototype.require.call(this, name);
    },
  };
  t.after(() => {
    globalThis.__AGPAMacOSNativeIcons__?.destroy();
    process.mainModule = origMain;
    process.resourcesPath = origResources;
  });

  const status = installNativeController.call(fakeTray, {
    requestFile,
    statusFile,
    geminiPng: '/icons/gemini-512.png',
    geminiTrayPng: '/icons/gemini-64.png',
    nonce: 'test-nonce',
    inspectorPort: 9999,
  });

  assert.equal(status.active, true);
  assert.equal(status.choice, 'gemini');
  assert.equal(status.tray, true);
  assert.equal(templateCalled, true);
  assert.deepEqual(dockCalls, ['gemini-512.png']);
  assert.deepEqual(trayImages, ['gemini-64.png:18x18']);

  globalThis.__AGPAMacOSNativeIcons__.markInspectorClosed();
  const saved = JSON.parse(await fs.readFile(statusFile, 'utf8'));
  assert.equal(saved.inspectorClosed, true);

  globalThis.__AGPAMacOSNativeIcons__.destroy();
  assert.deepEqual(dockCalls, ['gemini-512.png', 'icon.png']);
  assert.deepEqual(trayImages, ['gemini-64.png:18x18', 'trayTemplate.png']);
});

test('macOS native controller builds Retina @2x tray image when createEmpty and toPNG are available', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-retina-');
  const requestFile = path.join(root, 'macos-icon-request.json');
  const statusFile = path.join(root, 'macos-native-status.json');
  await fs.writeFile(requestFile, JSON.stringify({ version: 1, choice: 'gemini' }));

  const reps = [];
  const trayImages = [];
  const fakeImage = (tag) => ({
    tag,
    isEmpty: () => false,
    setTemplateImage: () => {},
    toPNG: () => Buffer.from(tag),
    resize: ({ width, height }) => fakeImage(`${tag}:${width}x${height}`),
  });
  const Module = require('node:module');
  const fakeTray = { isDestroyed: () => false, setImage: (img) => trayImages.push(img) };
  const fakeElectron = {
    app: { dock: { setIcon: () => {} } },
    nativeImage: {
      createFromPath: (p) => fakeImage(path.basename(p)),
      createEmpty: () => ({
        tag: 'multi',
        isEmpty: () => reps.length === 0,
        addRepresentation: (rep) => reps.push(rep),
      }),
    },
  };
  const origMain = process.mainModule;
  const origResources = process.resourcesPath;
  process.resourcesPath = root;
  process.mainModule = {
    require(name) {
      if (name === 'electron') return fakeElectron;
      return Module.prototype.require.call(this, name);
    },
  };
  t.after(() => {
    globalThis.__AGPAMacOSNativeIcons__?.destroy();
    process.mainModule = origMain;
    process.resourcesPath = origResources;
  });

  installNativeController.call(fakeTray, {
    requestFile,
    statusFile,
    geminiPng: '/icons/gemini-512.png',
    geminiTrayPng: '/icons/gemini-64.png',
    nonce: 'retina',
    inspectorPort: 9999,
  });
  assert.equal(reps.length, 2);
  assert.deepEqual(
    reps.map((r) => [r.scaleFactor, r.width, r.height]),
    [
      [1, 18, 18],
      [2, 36, 36],
    ],
  );
  assert.equal(trayImages[0].tag, 'multi');
});

test('macOS browser adapter detects installed .app bundles and LaunchServices default browser', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-browser-');
  const appsDir = path.join(root, 'Applications');
  for (const [app, bin] of [
    ['Google Chrome.app', 'Contents/MacOS/Google Chrome'],
    ['Brave Browser.app', 'Contents/MacOS/Brave Browser'],
  ]) {
    const exe = path.join(appsDir, app, bin);
    await fs.mkdir(path.dirname(exe), { recursive: true });
    await fs.writeFile(exe, '#!/bin/sh\n', { mode: 0o755 });
  }

  const detected = await macBrowser.detect({
    home: root,
    applicationsDirs: [appsDir],
    plistPath: path.join(root, 'ls.plist'),
    runCommand: async () => ({
      stdout: JSON.stringify({
        LSHandlers: [
          { LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'com.brave.browser' },
        ],
      }),
    }),
  });
  assert.deepEqual(detected.available, [
    { id: 'brave', label: 'Brave' },
    { id: 'chrome', label: 'Chrome' },
  ]);
  assert.equal(detected.defaultBrowser, 'brave');

  const spawned = [];
  await macBrowser.openDebug('chrome', {
    home: root,
    applicationsDirs: [appsDir],
    spawnProcess: (cmd, args) => {
      spawned.push([cmd, args]);
      const ee = new (require('node:events').EventEmitter)();
      ee.unref = () => {};
      queueMicrotask(() => ee.emit('spawn'));
      return ee;
    },
  });
  assert.deepEqual(spawned, [
    ['/usr/bin/open', ['-a', path.join(appsDir, 'Google Chrome.app')]],
  ]);
});

test('macOS computer-use extracts prefixed release tarballs and rejects path traversal', async (t) => {
  assert.equal((await macCu.environment()).session, 'macos');
  assert.equal((await macCu.environment()).needsHelper, false);

  const root = await makeTempDir(t, 'agpa-mac-cu-');
  const staging = path.join(root, 'cua-driver-rs-0.58.1-darwin-arm64');
  await fs.mkdir(staging, { recursive: true });
  await fs.writeFile(path.join(staging, 'cua-driver'), 'driver-bytes');
  await fs.writeFile(path.join(staging, 'cua-cursor-theme'), 'cursor-bytes');
  const archive = path.join(root, 'driver.tar.gz');
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', root, 'cua-driver-rs-0.58.1-darwin-arm64']);

  const target = path.join(root, 'extracted');
  await macCu.extract(archive, target);
  assert.equal(await fs.readFile(path.join(target, 'cua-driver'), 'utf8'), 'driver-bytes');
  assert.equal(await fs.readFile(path.join(target, 'cua-cursor-theme'), 'utf8'), 'cursor-bytes');

  await assert.rejects(
    macCu.extract(archive, target, {
      runCommand: async () => ({ stdout: '../evil/cua-driver\n' }),
    }),
    /Invalid driver archive entry/,
  );
});

test('macOS migration rewrites LaunchAgents and NativeMessagingHosts', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-mig-');
  const old = {
    platform: 'darwin',
    installDir: path.join(root, '.local/share/antigravity-project-appearance'),
    configDir: path.join(root, 'Library/Application Support/antigravity-project-appearance'),
  };
  const next = {
    platform: 'darwin',
    installDir: path.join(root, '.local/share/antigravity-plugin'),
    configDir: path.join(root, 'Library/Application Support/antigravity-plugin'),
  };
  const plist = path.join(root, 'Library/LaunchAgents/com.antigravity-plugin.daemon.plist');
  await fs.mkdir(path.dirname(plist), { recursive: true });
  await fs.writeFile(plist, `<string>${old.installDir}/macos/launcher.cjs</string>`);

  const identity = require('../common/browser-identity.json');
  const nmh = path.join(
    root,
    'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    identity.host + '.json',
  );
  await fs.mkdir(path.dirname(nmh), { recursive: true });
  await fs.writeFile(
    nmh,
    JSON.stringify({
      name: identity.host,
      path: path.join(old.configDir, 'companion/browser-host.sh'),
    }),
  );

  const changes = [];
  const remap = (v, a, b) =>
    v.split(a.installDir).join(b.installDir).split(a.configDir).join(b.configDir);
  await macMigration.rewrite({
    old,
    next,
    home: root,
    remap,
    plain: async (p) => fs.readFile(p).catch(() => null),
    change: async (file, text) => {
      changes.push(file);
      await fs.writeFile(file, text);
    },
  });

  assert.equal(changes.length, 2);
  assert.ok((await fs.readFile(plist, 'utf8')).includes(next.installDir));
  assert.equal(
    JSON.parse(await fs.readFile(nmh, 'utf8')).path,
    path.join(next.configDir, 'companion/browser-host.sh'),
  );
});

test('plugin updates build, validate and install universal darwin payloads on arm64 and x64', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-upd-');
  const sourceRoot = path.join(root, 'src');
  const repoRoot = path.resolve(__dirname, '..');
  for (const name of new Set([
    ...manifest.common,
    ...manifest.linux,
    ...manifest.windows,
    ...manifest.macos,
  ])) {
    const target = path.join(sourceRoot, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(repoRoot, name), target);
  }
  const versions = await fs.readFile(path.join(sourceRoot, 'common/versions.cjs'), 'utf8');
  const stableVersion = require('../common/versions.cjs').suite.split('-')[0];
  await fs.writeFile(
    path.join(sourceRoot, 'common/versions.cjs'),
    versions.replace(/suite\s*:\s*['"][^'"]+['"]/, `suite: ${JSON.stringify(stableVersion)}`),
  );

  const out = path.join(root, 'out');
  const packages = await build(sourceRoot, out);
  assert.equal(packages.darwin.arch, 'universal');
  const compressed = await fs.readFile(path.join(out, packages.darwin.name));
  const data = JSON.parse(zlib.gunzipSync(compressed));
  const validated = updateCore.validatePackage(data, {
    version: stableVersion,
    platform: 'darwin',
  });
  assert.ok(validated.some((f) => f.name === 'macos/desktop.cjs'));
  assert.ok(!validated.some((f) => f.name.startsWith('linux/') && !f.name.endsWith('README.md')));

  const installDir = path.join(root, 'installed');
  const configDir = path.join(root, 'cfg');
  for (const item of data.files) {
    const dest = path.join(installDir, item.name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(item.data, 'base64'));
  }
  await updateCore.receipt(installDir, 'darwin', stableVersion);
  assert.equal(await updateCore.pristine(installDir), true);

  const meta = JSON.parse(await fs.readFile(path.join(out, 'plugin-update.json'), 'utf8'));
  const updater = createUpdater({
    current: '1.0.0',
    paths: { configDir, installDir },
    platform: 'darwin',
    arch: 'arm64',
    managed: true,
    fetcher: async (url) => {
      if (url.includes('/releases/latest'))
        return new Response(
          JSON.stringify({
            tag_name: 'v' + stableVersion,
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'plugin-update.json',
                browser_download_url: `https://github.com/${updateCore.REPO}/releases/download/v${stableVersion}/plugin-update.json`,
              },
              {
                name: meta.packages.darwin.name,
                browser_download_url: `https://github.com/${updateCore.REPO}/releases/download/v${stableVersion}/${meta.packages.darwin.name}`,
              },
            ],
          }),
        );
      if (url.endsWith('plugin-update.json')) return new Response(JSON.stringify(meta));
      if (url.endsWith('.json.gz')) return new Response(compressed);
      throw Error('unexpected');
    },
  });
  await updater.initialize();
  const s = await updater.perform('check');
  assert.equal(s.supported, true);
  assert.equal(s.available, true);
  updater.close();
});

test('macos/launcher.cjs --stop waits for daemon exit and ignores differing TMPDIR', { skip: process.platform !== 'darwin' }, async (t) => {
  const { spawn } = require('node:child_process');
  const root = await makeTempDir(t, 'agpa-mac-lch-');
  const install = path.join(root, 'install');
  await fs.mkdir(path.join(install, 'macos'), { recursive: true });
  await fs.mkdir(path.join(install, 'common'), { recursive: true });
  const repoRoot = path.resolve(__dirname, '..');
  for (const rel of [
    'macos/launcher.cjs',
    'macos/installation.cjs',
    'macos/native-attach.cjs',
    'macos/native-controller.cjs',
    'common/platform-paths.cjs',
    'common/cdp-connection.cjs',
    'common/icon-path.cjs',
  ]) {
    await fs.copyFile(path.join(repoRoot, rel), path.join(install, rel));
  }
  const pidFile = path.join(root, 'daemon.pid');
  await fs.writeFile(
    path.join(install, 'common/daemon.cjs'),
    `const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on('SIGTERM', () => {
  setTimeout(() => { try { fs.unlinkSync(${JSON.stringify(pidFile)}); } catch {} process.exit(0); }, 250);
});
setInterval(() => {}, 1000);
`,
  );
  const envWatch = { ...process.env, HOME: root, TMPDIR: path.join(root, 't1') };
  const envStop = { ...process.env, HOME: root, TMPDIR: path.join(root, 't2') };
  await fs.mkdir(envWatch.TMPDIR, { recursive: true });
  await fs.mkdir(envStop.TMPDIR, { recursive: true });

  const watch = spawn(process.execPath, [path.join(install, 'macos/launcher.cjs'), '--watch'], {
    env: envWatch,
    stdio: 'ignore',
  });
  t.after(() => watch.kill('SIGKILL'));

  for (let i = 0; i < 40; i++) {
    if (await fs.stat(pidFile).catch(() => null)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(await fs.stat(pidFile));

  execFileSync(process.execPath, [path.join(install, 'macos/launcher.cjs'), '--stop'], {
    env: envStop,
    timeout: 8000,
  });
  await assert.rejects(fs.stat(pidFile), { code: 'ENOENT' });
  const exitCode = await new Promise((resolve) => {
    if (watch.exitCode !== null) return resolve(watch.exitCode);
    watch.once('exit', resolve);
  });
  assert.equal(exitCode, 0);
});

test('macos/installation.cjs reads binary Info.plist via plutil and common companion socket stays under 100 bytes', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-bplist-');
  const app = await makeFakeApp(root, 'Antigravity.app', 'com.google.antigravity');
  await fs.writeFile(path.join(app.bundle, 'Contents', 'Info.plist'), Buffer.from('bplist00binary'));
  const found = await macInstall.readBundle(app.bundle, {
    runCommand: async () => ({
      stdout: JSON.stringify({ CFBundleIdentifier: 'com.google.antigravity' }),
    }),
  });
  assert.equal(found?.bundleId, 'com.google.antigravity');

  const core = require('../common/companion-core.cjs');
  const longConfig = path.join(root, 'a'.repeat(110));
  const loc = core.locations(longConfig, 'darwin');
  assert.ok(Buffer.byteLength(loc.endpoint) < 100);
});

test('locales.json includes macOS autostart and update strings for all supported languages', () => {
  const locales = require('../common/locales.json');
  for (const [lang, catalog] of Object.entries(locales)) {
    assert.ok(catalog.strings['Start the app automatically when you sign in to macOS.'], lang);
    assert.ok(catalog.strings['Automatic updates support Linux x86-64, Windows x64, and macOS.'], lang);
  }
});

test('macOS full migration moves legacy tree, rewrites plists/wrapper/NMH, and cleans legacy agents', async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-fullmig-');
  const { migrate } = require('../common/migration.cjs');
  const { getLegacyPaths, getCanonicalPaths } = require('../common/platform-paths.cjs');
  const old = getLegacyPaths({ platform: 'darwin', home: root, env: {} });
  const next = getCanonicalPaths({ platform: 'darwin', home: root, env: {} });
  await fs.mkdir(path.join(old.installDir, 'common'), { recursive: true });
  await fs.mkdir(path.join(old.configDir), { recursive: true });
  await fs.writeFile(path.join(old.installDir, 'common/daemon.cjs'), 'legacy');
  await fs.writeFile(path.join(old.configDir, 'app.json'), '{"taskbarIcon":"gemini"}\n');

  const legacyPlist = path.join(root, 'Library/LaunchAgents/com.antigravity-project-appearance.daemon.plist');
  await fs.mkdir(path.dirname(legacyPlist), { recursive: true });
  await fs.writeFile(legacyPlist, `<string>com.antigravity-project-appearance.daemon</string><string>${old.installDir}/macos/launcher.cjs</string>`);

  const wrapper = path.join(root, 'Applications/Antigravity (customized).app/Contents/MacOS/Antigravity');
  await fs.mkdir(path.dirname(wrapper), { recursive: true });
  await fs.writeFile(wrapper, `exec node '${old.installDir}/macos/launcher.cjs' --launch\n`, { mode: 0o755 });

  const calls = [];
  const res = await migrate({
    home: root,
    platform: 'darwin',
    env: {},
    lifecycle: async (action) => {
      calls.push(action);
    },
  });
  assert.equal(res.migrated, true);
  assert.ok(calls.includes('finalize'));
  assert.equal(
    await fs.readFile(path.join(next.configDir, 'app.json'), 'utf8'),
    '{"taskbarIcon":"gemini"}\n',
  );
  const newPlist = path.join(root, 'Library/LaunchAgents/com.antigravity-plugin.daemon.plist');
  assert.ok((await fs.readFile(newPlist, 'utf8')).includes(next.installDir));
  assert.ok((await fs.readFile(wrapper, 'utf8')).includes(next.installDir));
  await assert.rejects(fs.stat(old.configDir), { code: 'ENOENT' });
});

test('macos/install.sh deploys runtime, receipt, customized .app and LaunchAgent, and macos/disable.sh cleans up', { skip: process.platform !== 'darwin' }, async (t) => {
  const root = await makeTempDir(t, 'agpa-mac-sh-');
  const fakeHome = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  const launchctlLog = path.join(root, 'launchctl.log');
  await fs.mkdir(fakeHome, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  const fakeApp = await makeFakeApp(root, 'Antigravity.app', 'com.google.antigravity');
  await fs.writeFile(path.join(fakeApp.resources, 'icon.icns'), 'icns');

  const launchctlStub = path.join(binDir, 'launchctl');
  await fs.writeFile(
    launchctlStub,
    `#!/bin/sh
echo "$*" >> ${JSON.stringify(launchctlLog)}
if [ "$1" = "bootstrap" ] && [ -f "$3" ]; then
  ELECTRON_RUN_AS_NODE=1 ${JSON.stringify(process.execPath)} "${path.join(fakeHome, '.local/share/antigravity-plugin/macos/launcher.cjs')}" --watch >/dev/null 2>&1 &
fi
exit 0
`,
    { mode: 0o755 },
  );

  const repoRoot = path.resolve(__dirname, '..');
  const env = {
    ...process.env,
    HOME: fakeHome,
    PATH: `${binDir}:${process.env.PATH}`,
    AGPA_APP_BUNDLE: fakeApp.bundle,
  };
  t.after(() => {
    const launcher = path.join(
      fakeHome,
      '.local/share/antigravity-plugin/macos/launcher.cjs',
    );
    if (!require('node:fs').existsSync(launcher)) return;
    try {
      execFileSync(process.execPath, [launcher, '--stop'], { env, timeout: 5000 });
    } catch {}
  });

  execFileSync('/bin/bash', [path.join(repoRoot, 'macos/install.sh')], { env });

  const targetDir = path.join(fakeHome, '.local/share/antigravity-plugin');
  const configDir = path.join(fakeHome, 'Library/Application Support/antigravity-plugin');
  const customApp = path.join(fakeHome, 'Applications/Antigravity (customized).app');
  const daemonPlist = path.join(fakeHome, 'Library/LaunchAgents/com.antigravity-plugin.daemon.plist');

  assert.equal(await updateCore.pristine(targetDir), true);
  const inst = JSON.parse(await fs.readFile(path.join(configDir, 'installation.json'), 'utf8'));
  assert.equal(inst.appBundle, fakeApp.bundle);
  assert.equal(inst.appExe, fakeApp.exe);
  await fs.access(path.join(customApp, 'Contents/MacOS/Antigravity'));
  await fs.access(path.join(customApp, 'Contents/Info.plist'));
  await fs.access(path.join(customApp, 'Contents/Resources/icon.icns'));
  const plistText = await fs.readFile(daemonPlist, 'utf8');
  assert.ok(plistText.includes('com.antigravity-plugin.daemon'));
  assert.ok(plistText.includes(path.join(targetDir, 'macos/launcher.cjs')));

  const checkOut = execFileSync(
    process.execPath,
    [path.join(targetDir, 'common/daemon.cjs'), '--check-config'],
    { env, encoding: 'utf8' },
  );
  assert.equal(JSON.parse(checkOut).configPath, path.join(configDir, 'projects.json'));

  const ctlCalls = await fs.readFile(launchctlLog, 'utf8');
  assert.ok(ctlCalls.includes('bootstrap'));

  execFileSync('/bin/bash', [path.join(repoRoot, 'macos/disable.sh')], { env });
  await assert.rejects(fs.stat(daemonPlist), { code: 'ENOENT' });
  await assert.rejects(fs.stat(customApp), { code: 'ENOENT' });
});

test('macos/install.sh detects an existing launcher.sock Unix socket even when launcher.cjs is absent', { skip: process.platform !== 'darwin' }, async (t) => {
  const net = require('node:net');
  const { execFile } = require('node:child_process');
  const root = await fs.mkdtemp('/tmp/agpa-ms-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const fakeHome = path.join(root, 'h');
  const configDir = path.join(fakeHome, 'Library/Application Support/antigravity-plugin');
  const binDir = path.join(root, 'b');
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  const fakeApp = await makeFakeApp(root, 'Antigravity.app', 'com.google.antigravity');
  const launchctlStub = path.join(binDir, 'launchctl');
  await fs.writeFile(
    launchctlStub,
    `#!/bin/sh
if [ "$1" = "bootstrap" ] && [ -f "$3" ]; then
  ELECTRON_RUN_AS_NODE=1 ${JSON.stringify(process.execPath)} "${path.join(fakeHome, '.local/share/antigravity-plugin/macos/launcher.cjs')}" --watch >/dev/null 2>&1 &
fi
exit 0
`,
    { mode: 0o755 },
  );

  const sock = path.join(configDir, 'launcher.sock');
  assert.ok(Buffer.byteLength(sock) < 100);
  const received = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    socket.on('end', () => {
      received.push(data);
      socket.end('ok\n');
      if (data === 'stop') {
        server.close();
        fs.unlink(sock).catch(() => {});
      }
    });
  });
  await new Promise((resolve) => server.listen(sock, resolve));
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const repoRoot = path.resolve(__dirname, '..');
  const env = {
    ...process.env,
    HOME: fakeHome,
    PATH: `${binDir}:${process.env.PATH}`,
    AGPA_APP_BUNDLE: fakeApp.bundle,
  };
  t.after(() => {
    const launcher = path.join(fakeHome, '.local/share/antigravity-plugin/macos/launcher.cjs');
    if (!require('node:fs').existsSync(launcher)) return;
    try {
      execFileSync(process.execPath, [launcher, '--stop'], { env, timeout: 5000 });
    } catch {}
  });

  await new Promise((resolve, reject) => {
    execFile('/bin/bash', [path.join(repoRoot, 'macos/install.sh')], { env }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve();
    });
  });
  assert.deepEqual(received, ['stop']);
});

test('macos/launcher.cjs --launch exits promptly when --watch is not yet running and launches app with debug flags', { skip: process.platform !== 'darwin' }, async (t) => {
  const { execFile } = require('node:child_process');
  const root = await makeTempDir(t, 'agpa-mac-launch-');
  const install = path.join(root, 'install');
  const configDir = path.join(root, 'Library/Application Support/antigravity-plugin');
  await fs.mkdir(path.join(install, 'macos'), { recursive: true });
  await fs.mkdir(path.join(install, 'common'), { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  const repoRoot = path.resolve(__dirname, '..');
  for (const rel of [
    'macos/launcher.cjs',
    'macos/installation.cjs',
    'macos/native-attach.cjs',
    'macos/native-controller.cjs',
    'common/platform-paths.cjs',
    'common/cdp-connection.cjs',
    'common/icon-path.cjs',
  ]) {
    await fs.copyFile(path.join(repoRoot, rel), path.join(install, rel));
  }
  await fs.writeFile(path.join(install, 'common/daemon.cjs'), 'setInterval(() => {}, 1000);\n');
  const argsLog = path.join(root, 'app-args.log');
  const fakeApp = await makeFakeApp(root, 'Antigravity.app', 'com.google.antigravity');
  await fs.writeFile(
    fakeApp.exe,
    `#!/bin/sh\necho "$*" >> ${JSON.stringify(argsLog)}\nexit 0\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(configDir, 'installation.json'),
    JSON.stringify({ version: 1, appBundle: fakeApp.bundle, appExe: fakeApp.exe, nativeIconsSupported: true }),
  );
  const env = { ...process.env, HOME: root, AGPA_APP_BUNDLE: fakeApp.bundle };
  const launcherBin = path.join(install, 'macos/launcher.cjs');
  t.after(() => {
    if (!require('node:fs').existsSync(launcherBin)) return;
    try {
      execFileSync(process.execPath, [launcherBin, '--stop'], { env, timeout: 5000 });
    } catch {}
  });

  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(install, 'macos/launcher.cjs'), '--launch'],
      { env, timeout: 6000 },
      (err, stdout, stderr) => {
        if (err) return reject(Object.assign(err, { stdout, stderr }));
        resolve();
      },
    );
  });

  let launchedArgs = '';
  for (let i = 0; i < 30; i++) {
    launchedArgs = await fs.readFile(argsLog, 'utf8').catch(() => '');
    if (launchedArgs) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.match(launchedArgs, /--remote-debugging-port=0/);
  assert.match(launchedArgs, /--inspect=127\.0\.0\.1:0/);

  execFileSync(process.execPath, [path.join(install, 'macos/launcher.cjs'), '--stop'], {
    env,
    timeout: 5000,
  });
});

test('macos/install.sh --launch completes with delayed launchd startup and stops hashed /tmp socket for long HOME paths', { skip: process.platform !== 'darwin' }, async (t) => {
  const crypto = require('node:crypto');
  const net = require('node:net');
  const { execFile } = require('node:child_process');
  const root = await makeTempDir(t, 'agpa-mac-longhome-');
  const fakeHome = path.join(root, 'very-long-home-directory-segment-to-exceed-unix-socket-limit');
  const configDir = path.join(fakeHome, 'Library/Application Support/antigravity-plugin');
  const binDir = path.join(root, 'bin');
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  const localSock = path.join(configDir, 'launcher.sock');
  assert.ok(Buffer.byteLength(localSock) >= 100);
  const hashedSock = path.join(
    '/tmp',
    'agpa-l-' + crypto.createHash('sha256').update(configDir).digest('hex').slice(0, 16) + '.sock',
  );

  const fakeApp = await makeFakeApp(root, 'Antigravity.app', 'com.google.antigravity');
  const argsLog = path.join(root, 'app-args.log');
  await fs.writeFile(
    fakeApp.exe,
    `#!/bin/sh\necho "$*" >> ${JSON.stringify(argsLog)}\nexit 0\n`,
    { mode: 0o755 },
  );
  const launchctlStub = path.join(binDir, 'launchctl');
  await fs.writeFile(
    launchctlStub,
    `#!/bin/sh
if [ "$1" = "bootstrap" ] && [ -f "$3" ]; then
  (sleep 0.25; ELECTRON_RUN_AS_NODE=1 ${JSON.stringify(process.execPath)} "${path.join(fakeHome, '.local/share/antigravity-plugin/macos/launcher.cjs')}" --watch) >/dev/null 2>&1 &
fi
exit 0
`,
    { mode: 0o755 },
  );

  const received = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    socket.on('end', () => {
      received.push(data);
      socket.end('ok\n');
      if (data === 'stop') {
        server.close();
        fs.unlink(hashedSock).catch(() => {});
      }
    });
  });
  await new Promise((resolve) => server.listen(hashedSock, resolve));
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  t.after(() => fs.unlink(hashedSock).catch(() => {}));

  const repoRoot = path.resolve(__dirname, '..');
  const env = {
    ...process.env,
    HOME: fakeHome,
    TMPDIR: path.join(root, 't1'),
    PATH: `${binDir}:${process.env.PATH}`,
    AGPA_APP_BUNDLE: fakeApp.bundle,
  };
  await fs.mkdir(env.TMPDIR, { recursive: true });
  t.after(() => {
    const launcher = path.join(fakeHome, '.local/share/antigravity-plugin/macos/launcher.cjs');
    if (!require('node:fs').existsSync(launcher)) return;
    try {
      execFileSync(process.execPath, [launcher, '--stop'], {
        env: { ...env, TMPDIR: path.join(root, 't2') },
        timeout: 5000,
      });
    } catch {}
  });

  await new Promise((resolve, reject) => {
    execFile(
      '/bin/bash',
      [path.join(repoRoot, 'macos/install.sh'), '--launch'],
      { env, timeout: 10000 },
      (err, stdout, stderr) => {
        if (err) return reject(Object.assign(err, { stdout, stderr }));
        resolve();
      },
    );
  });
  assert.deepEqual(received, ['stop']);

  let launchedArgs = '';
  for (let i = 0; i < 30; i++) {
    launchedArgs = await fs.readFile(argsLog, 'utf8').catch(() => '');
    if (launchedArgs) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.match(launchedArgs, /--remote-debugging-port=0/);

  const installedLauncher = path.join(fakeHome, '.local/share/antigravity-plugin/macos/launcher.cjs');
  execFileSync(process.execPath, [installedLauncher, '--stop'], {
    env: { ...env, TMPDIR: path.join(root, 't2') },
    timeout: 5000,
  });
});


