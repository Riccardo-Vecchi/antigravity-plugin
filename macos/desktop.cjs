'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { validate } = require('../common/app-preferences.cjs');
const installation = require('./installation.cjs');

const AUTOSTART_LABEL = 'com.antigravity-plugin.autostart';

function autostartPlist(paths, runtime = process.execPath) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const launcher = path.join(paths.installDir, 'macos', 'launcher.cjs');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${AUTOSTART_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${esc(runtime)}</string>`,
    `    <string>${esc(launcher)}</string>`,
    '    <string>--launch</string>',
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>ELECTRON_RUN_AS_NODE</key>',
    '    <string>1</string>',
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function createController({
  paths = require('../common/platform-paths.cjs').getPaths(),
  home = os.homedir(),
  runProgram = run,
  pidAlive = (pid) => process.kill(pid, 0),
  discoverInstallation = () => installation.discover({ home }),
  withoutDebugging = () => installation.appWithoutDebugging(paths.profileDir, { runCommand: runProgram }),
  runtime = process.execPath,
} = {}) {
  const session = require('../common/session-state.cjs').createSessionStore(
    path.join(paths.configDir, 'session.json'),
  );
  const preferences = path.join(paths.configDir, 'app.json');
  const requestFile = path.join(paths.configDir, 'macos-icon-request.json');
  const statusFile = path.join(paths.configDir, 'macos-native-status.json');
  const autostartFile = path.join(home, 'Library', 'LaunchAgents', `${AUTOSTART_LABEL}.plist`);
  let state = {
    version: 2,
    taskbarIcon: 'antigravity',
    startupView: 'antigravity',
    autostart: false,
    toggleShortcut: 'Ctrl+Alt+G',
  };
  let currentView = 'antigravity',
    lastView = 'antigravity',
    effectiveIcon = null,
    nativeAvailable = false,
    trayAvailable = false,
    paused = false,
    detectedApp = null;

  async function atomic(file, content, raw = false) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + '.' + process.pid + '.tmp';
    try {
      await fs.writeFile(
        temp,
        raw ? content : JSON.stringify(content, null, 2) + '\n',
        { mode: 0o600 },
      );
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function json(file, max = 8192) {
    const stat = await fs.stat(file);
    if (stat.size > max) throw Error('Invalid local state.');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }

  function desired() {
    return state.taskbarIcon === 'dynamic' ? currentView : state.taskbarIcon;
  }

  function getState() {
    return {
      ...state,
      platform: 'darwin',
      lastView,
      currentView,
      startupTarget: state.startupView === 'last' ? lastView : state.startupView,
      effectiveIcon: effectiveIcon || desired(),
      desktopIconAvailable: nativeAvailable,
      trayAvailable,
    };
  }

  async function readNative() {
    try {
      const status = await json(statusFile);
      if (
        status.version !== 1 ||
        !Number.isSafeInteger(status.pid) ||
        status.pid < 1 ||
        !Number.isFinite(status.updatedAt) ||
        Math.abs(Date.now() - status.updatedAt) > 15000
      )
        throw Error('Invalid native state.');
      pidAlive(status.pid);
      nativeAvailable = status.active === true && status.inspectorClosed === true;
      trayAvailable = nativeAvailable && status.tray === true;
      return status;
    } catch {
      nativeAvailable = false;
      trayAvailable = false;
      return null;
    }
  }

  async function renderIcon() {
    const choice = paused ? 'antigravity' : desired();
    if (effectiveIcon !== choice) {
      await atomic(requestFile, { version: 1, choice });
      effectiveIcon = choice;
    }
    await readNative();
    return getState();
  }

  async function readAutostart() {
    try {
      const stat = await fs.lstat(autostartFile);
      if (!stat.isFile() || stat.isSymbolicLink()) return false;
      const text = await fs.readFile(autostartFile, 'utf8');
      return (
        text.includes(AUTOSTART_LABEL) &&
        !/<key>\s*Disabled\s*<\/key>\s*<true\s*\/>/i.test(text)
      );
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function syncAutostart(enabled) {
    let existing = null;
    try {
      const stat = await fs.lstat(autostartFile);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw Error('Autostart entry is not a regular file.');
      existing = await fs.readFile(autostartFile, 'utf8');
      if (!existing.includes(AUTOSTART_LABEL))
        throw Error('An unrelated autostart entry already exists.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!enabled) {
      if (existing !== null) await fs.rm(autostartFile);
      return;
    }
    await atomic(autostartFile, autostartPlist(paths, runtime), true);
  }

  async function save(patch) {
    const before = state,
      next = validate({ ...state, ...patch });
    if (patch.autostart !== undefined) await syncAutostart(next.autostart);
    try {
      await atomic(preferences, next);
    } catch (error) {
      if (patch.autostart !== undefined)
        await syncAutostart(before.autostart).catch(() => {});
      throw error;
    }
    state = next;
    return renderIcon();
  }

  async function initialize({ suspended = false } = {}) {
    paused = suspended;
    try {
      state = validate(await json(preferences, 4096));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    lastView = await session.read();
    currentView = state.startupView === 'last' ? lastView : state.startupView;
    state.autostart = await readAutostart();
    detectedApp = await discoverInstallation().catch(() => null);
    return renderIcon();
  }

  async function apply(choice) {
    if (!['antigravity', 'gemini', 'dynamic'].includes(choice))
      throw Error('Invalid icon choice.');
    return save({ taskbarIcon: choice });
  }

  async function setStartupView(view) {
    if (!['antigravity', 'gemini', 'last'].includes(view))
      throw Error('Invalid startup view.');
    return save({ startupView: view });
  }

  async function setToggleShortcut(value) {
    return save({
      toggleShortcut: require('../common/shortcut-config.cjs').normalize(value),
    });
  }

  async function setAutostart(value) {
    if (typeof value !== 'boolean') throw Error('Invalid autostart value.');
    return save({ autostart: value });
  }

  async function setView(view) {
    if (!['antigravity', 'gemini'].includes(view)) throw Error('Unknown view.');
    lastView = await session.record(view);
    currentView = view;
    return renderIcon();
  }

  async function ensureTray() {
    await readNative();
    return getState();
  }

  let waitingProcess = null;
  let notifiedProcess = null;
  async function checkMissingDebugPort() {
    const pid = !paused && detectedApp ? await withoutDebugging() : null;
    if (!pid) {
      waitingProcess = null;
      return false;
    }
    if (notifiedProcess === pid) return false;
    if (waitingProcess?.pid !== pid) {
      waitingProcess = { pid, since: Date.now() };
      return false;
    }
    if (Date.now() - waitingProcess.since < 6000) return false;
    notifiedProcess = pid;
    const italian = /^it\b/i.test(
      process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '',
    );
    const title = italian
      ? 'Collegamento con Antigravity interrotto'
      : 'Antigravity plugin disconnected';
    const message = italian
      ? 'Quando hai finito le attività in corso, chiudi Antigravity dal suo menu (Quit) e riaprilo da Antigravity (customized).'
      : 'When your work is done, choose Quit in Antigravity and reopen Antigravity (customized).';
    const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
    await runProgram('/usr/bin/osascript', ['-e', script], { timeout: 2500 }).catch(
      () => {},
    );
    return true;
  }

  async function pause() {
    paused = true;
    return renderIcon();
  }

  async function resume() {
    paused = false;
    return renderIcon();
  }

  async function restoreIntegration() {
    await initialize();
    await apply('antigravity');
    await setAutostart(false);
    const activeBefore = (await readNative())?.active === true;
    await atomic(requestFile, { version: 1, choice: 'antigravity', restore: true });
    if (activeBefore) {
      for (let i = 0; i < 12; i++) {
        const current = await readNative();
        if (!current || current.active === false) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return getState();
  }

  return {
    pause,
    resume,
    initialize,
    apply,
    setStartupView,
    setAutostart,
    setToggleShortcut,
    setView,
    ensureTray,
    checkMissingDebugPort,
    getState,
    validate,
    restoreIntegration,
  };
}

module.exports = { ...createController(), createController, autostartPlist, AUTOSTART_LABEL };
