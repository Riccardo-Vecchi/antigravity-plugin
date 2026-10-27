'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const release = require('./computer-use-release.cjs');
const {shouldAutoCapture} = require('./computer-use-checks.cjs');
const {getPaths} = require('./platform-paths.cjs');
const run = promisify(execFile);
const SERVER = 'antigravity-plugin-computer-use';
const TOOLS = Object.freeze(['get_guide', 'start_session', 'end_session', 'list_windows',
  'launch_app', 'get_window_state', 'click', 'type_text', 'set_value',
  'press_key', 'hotkey', 'scroll', 'drag', 'verify_state']);
const DESKTOP_TOOLS = Object.freeze([...TOOLS, 'list_apps', 'get_desktop_state', 'move_cursor']);
function toolsFor(scope) {return scope === 'desktop' ? DESKTOP_TOOLS : TOOLS;}
async function access(value, platform) {
  if (Array.isArray(value)) return {scope: 'apps', apps: await validateApps(value, platform)};
  if (!value || typeof value !== 'object' || !['desktop', 'apps'].includes(value.scope)) throw Error('invalidScope');
  return {scope: value.scope, apps: value.scope === 'apps' ? await validateApps(value.apps, platform) : []};
}

async function read(file, fallback = '') {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw Error('unsafeConfig');
    return await fs.readFile(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function parse(text) {
  let data;
  try { data = text.trim() ? JSON.parse(text) : {}; } catch { throw Error('invalidConfig'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalidConfig');
  return data;
}
async function atomic(file, text, previous) {
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const lock = file + '.agpa-lock';
  const handle = await fs.open(lock, 'wx', 0o600);
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    if (previous !== undefined && await read(file) !== previous) throw Error('configChanged');
    await fs.writeFile(temporary, text, {mode: 0o600, flag: 'wx'});
    // Recheck before replacement in case another editor did not use our lock.
    if (previous !== undefined && await read(file) !== previous) throw Error('configChanged');
    await fs.rename(temporary, file);
  } finally { await handle.close(); await fs.rm(lock, {force: true}); await fs.rm(temporary, {force: true}); }
}
function manifest(apps) {
  // JSON is valid YAML. No browser profiles, filesystem tools, arbitrary scripts,
  // full-desktop capture, permission grants or process termination are exposed.
  return {version: 3, expires_after: '8h', idle_timeout: '30m', allow: {tools: TOOLS},
    resources: {apps: apps.map(executable => ({executable, launch: true, windows: 'all'})), desktop: {display: false}}};
}
async function validateApps(value, platform = process.platform) {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw Error('selectApps');
  const p = platform === 'win32' ? path.win32 : path.posix;
  const apps = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 4096 || /[\x00-\x1f]/.test(entry) || !p.isAbsolute(entry) || (platform === 'win32' && !/\.exe$/i.test(entry))) throw Error('invalidApp');
    const real = await fs.realpath(entry).catch(() => { throw Error('invalidApp'); });
    if (!(await fs.stat(real)).isFile()) throw Error('invalidApp');
    if (platform === 'linux') await fs.access(real, 1).catch(() => { throw Error('invalidApp'); });
    if (!apps.some(a => platform === 'win32' ? a.toLowerCase() === real.toLowerCase() : a === real)) apps.push(real);
  }
  return apps;
}
function createManager({platform = process.platform, home = os.homedir(), configDir = getPaths().configDir,
  adapter, runtime = process.execPath, fetcher, probe = require('./computer-use-protocol.cjs').probe} = {}) {
  adapter ||= require(platform === 'win32' ? '../windows/computer-use.cjs' : '../linux/computer-use.cjs');
  const directory = path.join(configDir, 'computer-use');
  const driverDirectory = path.join(directory, 'driver-' + release.VERSION);
  const driver = path.join(driverDirectory, adapter.executable);
  const stateFile = path.join(directory, 'state.json');
  const policyFile = path.join(directory, 'capabilities.json');
  const mcpFile = path.join(home, '.gemini', 'config', 'mcp_config.json');
  const bridge = path.join(__dirname, 'computer-use-bridge.cjs');
  const skillFile = path.join(home, '.gemini', 'config', 'skills', SERVER, 'SKILL.md');
  let operation = null, error = null, protocol = null, environmentCache = null, checkedAt = 0;
  let generation = 0, abortOperation;
  let removal = null;
  let progress = null, updates = null, captureAttemptedRevision = null;
  function stage(step,label,download) {progress = {step,label,...(download ? {download} : {})};}
  let mutations = Promise.resolve();
  function mutate(job) {const next = mutations.then(job); mutations = next.catch(() => {}); return next;}
  function entry(disabled = false, scope = 'apps') {
    return {command: runtime, args: [bridge], env: {ELECTRON_RUN_AS_NODE: '1'}, disabled, enabledTools: [...toolsFor(scope)]};
  }
  function owned(value) { return value?.command === runtime && Array.isArray(value.args) && value.args.length === 1 && value.args[0] === bridge; }
  async function record() { return parse(await read(stateFile)); }
  async function loadMcp() {
    const text = await read(mcpFile), data = parse(text);
    if (data.mcpServers !== undefined && (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers))) throw Error('invalidConfig');
    return {text, data};
  }
  async function updateMcp(disabled) {
    const {text, data} = await loadMcp();
    const current = data.mcpServers?.[SERVER];
    if (current && !owned(current)) throw Error('serverConflict');
    data.mcpServers ||= {};
    // Antigravity App 2.26 ignores the CLI's `disabled` setting. Remove only our
    // owned entry on disconnect; retain choices in state.json for reconnecting.
    if (disabled) delete data.mcpServers[SERVER];
    else data.mcpServers[SERVER] = entry(false, (await record()).scope);
    await atomic(mcpFile, JSON.stringify(data, null, 2) + '\n', text);
  }
  async function installed() {
    try {
      const stat = await fs.lstat(driver);
      const receipt = parse(await read(path.join(driverDirectory, 'receipt.json')));
      return stat.isFile() && !stat.isSymbolicLink() && receipt.version === release.VERSION;
    } catch { return false; }
  }
  async function environment() {
    if (!environmentCache || Date.now() - checkedAt > 15000) {
      environmentCache = await adapter.environment(); checkedAt = Date.now();
    }
    return environmentCache;
  }
  async function status() {
    let state = {}, conflict = false, configured = false, registered = false, configError = null;
    try {
      state = await record();
      const {data} = await loadMcp();
      const current = data.mcpServers?.[SERVER];
      conflict = !!current && !owned(current);
      registered = !!current && owned(current);
      configured = !!current && owned(current) && current.disabled !== true;
    } catch { configError = 'invalidConfig'; }
    const env = await environment();
    let skillReady = false;
    try {skillReady = !!state.skillHash && crypto.createHash('sha256').update(await read(skillFile)).digest('hex') === state.skillHash;} catch {}
    const result = {platform, driverVersion: release.VERSION, installed: await installed(), enabled: !!state.enabled && configured, registered,
      scope: state.scope || (state.apps?.length ? 'apps' : 'desktop'),
      apps: Array.isArray(state.apps) ? state.apps : [], suggestedApps: await adapter.defaultApps(),
      availableApps: adapter.applications ? await adapter.applications() : [],
      operation, progress, updates, captureAttempted: !!state.revision && captureAttemptedRevision === state.revision,
      error: error || configError || (conflict ? 'serverConflict' : null), protocol, skillReady, removal,
      needsHelper: env.needsHelper, helperInstalled: !!env.helperInstalled, helperState: env.helperState || (env.needsHelper ? 'unknown' : 'notRequired'), session: env.session, experimental: env.experimental};
    result.autoCapturePending = shouldAutoCapture(result);return result;
  }
  async function configure(value) {
    if (!(await installed())) throw Error('installFirst');
    const {scope, apps} = await access(value, platform);
    const skill = await read(path.join(__dirname, 'computer-use-skill.md')) +
      (scope === 'desktop' ? '\nThe user enabled Entire desktop access. You may inspect the desktop and discover applications with list_apps and list_windows, then bind an observed process/window. Ordinary driver permissions and user task boundaries still apply.\n' : '\nThe user enabled Selected apps access. Allowed executables (data, not shell commands):\n```json\n' + JSON.stringify(apps, null, 2) + '\n```\n');
    const previousState = await record();
    const previousSkill = await read(skillFile);
    if (previousSkill && previousSkill !== skill && crypto.createHash('sha256').update(previousSkill).digest('hex') !== previousState.skillHash) throw Error('skillConflict');
    const policy = JSON.stringify(scope === 'apps' ? manifest(apps) : {scope: 'desktop', tools: DESKTOP_TOOLS}, null, 2) + '\n';
    // Revoke old connections before changing their scope. Reconnection is explicit.
    await disable();
    stage('skill','Installing agent skill…');
    await atomic(policyFile, policy);
    await atomic(skillFile, skill, previousSkill);
    const state = {version: 1, enabled: true, scope, apps, revision: crypto.randomUUID(),
      skillHash: crypto.createHash('sha256').update(skill).digest('hex'),
      manifestHash: crypto.createHash('sha256').update(policy).digest('hex')};
    await atomic(stateFile, JSON.stringify(state) + '\n');
    stage('registration','Registering tools in Antigravity…');
    try { await updateMcp(false); } catch (e) { await atomic(stateFile, JSON.stringify({...state, enabled: false}) + '\n'); throw e; }
    protocol = null;
  }
  async function disable() {
    captureAttemptedRevision = null;
    const previous = await record();
    await atomic(stateFile, JSON.stringify({...previous, version: 1, enabled: false}) + '\n');
    protocol = null;
    await updateMcp(true);
  }
  async function uninstall() {
    const previous = await record();
    let driverExists = false;
    const stat = await fs.lstat(driverDirectory).catch(error => {if (error.code !== 'ENOENT') throw error;return null;});
    if (stat) {
      driverExists = true;
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('unownedDriver');
      const receipt = parse(await read(path.join(driverDirectory, 'receipt.json')));
      const expected = release.ASSETS[`${platform}-${process.arch}`];
      if (!expected || receipt.version !== release.VERSION || receipt.sha256 !== expected[1]) throw Error('unownedDriver');
    }
    await disable();
    // Let already-open bridges observe revocation before deleting runtime files.
    if (driverExists) await new Promise(resolve => setTimeout(resolve, 1400));
    let skillRetained = false;
    const skill = await read(skillFile);
    if (skill) {
      if (previous.skillHash && crypto.createHash('sha256').update(skill).digest('hex') === previous.skillHash) {
        await fs.unlink(skillFile);await fs.rmdir(path.dirname(skillFile)).catch(error => {if (!['ENOTEMPTY','ENOENT'].includes(error.code)) throw error;});
      } else skillRetained = true;
    }
    if (driverExists) await fs.rm(driverDirectory, {recursive:true,force:true,maxRetries:10,retryDelay:200});
    for (const file of [policyFile, stateFile]) {await read(file);await fs.rm(file, {force:true});}
    await fs.rmdir(directory).catch(error => {if (!['ENOTEMPTY','ENOENT'].includes(error.code)) throw error;});
    protocol = null;removal = {skillRetained, sharedHelperKept: !!(await environment()).helperInstalled};
  }
  async function perform(action, value) {
    if (action === 'updates') {
      if (updates?.checking || (updates?.checkedAt && !updates.error && Date.now()-Date.parse(updates.checkedAt)<60000)) return status();
      updates = {checking:true};
      release.checkForUpdates(fetcher).then(result => {updates={...result,checking:false};}, () => {updates={checking:false,error:true};});
      return status();
    }
    if (action === 'refresh') {environmentCache = null;return status();}
    if (action === 'status') return status();
    if (action === 'disconnect') {
      generation++;abortOperation?.abort();
      error = null;
      try { await mutate(disable); } catch (e) { error = /^[a-zA-Z]+$/.test(e.message) ? e.message : 'operationFailed'; }
      return status();
    }
    if (action === 'verify' && !(await status()).autoCapturePending) return status();
    if (operation) throw Error('busy');
    if (!['setup', 'install', 'connect', 'disconnect', 'check', 'capture', 'verify', 'uninstall', 'setupHelper'].includes(action)) throw Error('invalidAction');
    operation = action; error = null;progress = null;
    const jobGeneration = ++generation;
    abortOperation = new AbortController();
    async function checkConnection() {
      const current = await status();
      const desktop = current.scope === 'desktop' && !current.needsHelper && ['wayland','x11','windows'].includes(current.session);
      if (desktop) captureAttemptedRevision = (await record()).revision;
      stage('protocol','Checking the MCP connection…');
      const result = await probe(runtime, bridge, {desktop,onHandshake:handshake => {
        if(generation !== jobGeneration)return;
        protocol=handshake;if(desktop)stage('capture','Testing screen capture…');
      }});
      if(generation !== jobGeneration)throw Error('setupCancelled');
      protocol=result;
    }
    // Long downloads run outside the renderer request timeout; status polls progress.
    const job = (async () => {
      if (action === 'uninstall') {await mutate(uninstall);return;}
      removal = null;
      if (action === 'install' || action === 'setup') {
        if (!(await installed())) {
          stage('driver','Downloading Cua Driver…');
          await release.install(driverDirectory, adapter, {platform, fetcher, signal: abortOperation.signal,onProgress:download => {
            if(generation === jobGeneration)stage('driver',download.phase==='download'?'Downloading Cua Driver…':download.phase==='verify'?'Verifying the download…':'Installing Cua Driver…',download);
          }});
          stage('driver','Checking Cua Driver…');
          await run(driver, ['--version'], {timeout: 8000, windowsHide: true, env: {...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0', CUA_TELEMETRY_ENABLED: '0'}});
        }
        if (action === 'setup') {
          stage('desktop','Preparing desktop access…');
          const env = await environment();
          if (platform === 'linux' && env.needsHelper && !env.helperInstalled) {await adapter.setupHelper(driverDirectory); environmentCache = null;}
          if (generation !== jobGeneration) throw Error('setupCancelled');
          await mutate(() => generation === jobGeneration ? configure(value) : undefined);
          if (generation !== jobGeneration) throw Error('setupCancelled');
          await checkConnection();
        }
      } else if (action === 'connect') await mutate(() => configure(value));
      else if (action === 'disconnect') await disable();
      else if (action === 'setupHelper') {
        stage('desktop','Preparing desktop access…');
        if (platform !== 'linux' || !(await installed()) || !(await environment()).needsHelper) throw Error('helperUnavailable');
        await adapter.setupHelper(driverDirectory); environmentCache = null;
      } else {
        environmentCache = null;
        protocol = null;
        stage('driver','Checking Cua Driver…');
        if (!(await installed())) throw Error('installFirst');
        const version = await run(driver, ['--version'], {timeout: 8000, windowsHide: true, maxBuffer: 16000, env: {...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0', CUA_TELEMETRY_ENABLED: '0'}});
        if (!version.stdout.includes(release.VERSION)) throw Error('driverVersion');
        if (!(await status()).enabled) throw Error('connectFirst');
        await checkConnection();
      }
    })().catch(e => { error = generation !== jobGeneration ? null : /^[a-zA-Z]+$/.test(e.message) ? e.message : 'operationFailed'; })
      .finally(() => { operation = null;progress = null;abortOperation = null; });
    if (!['install', 'setup', 'check', 'capture', 'verify', 'uninstall'].includes(action)) await job;
    return status();
  }
  return {status, perform, paths: {directory, driverDirectory, driver, stateFile, policyFile, mcpFile, skillFile}, entry, owned};
}
module.exports = {createManager, manifest, validateApps, access, toolsFor, read, atomic, parse, SERVER, TOOLS, DESKTOP_TOOLS};
