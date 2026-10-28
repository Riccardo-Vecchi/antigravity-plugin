'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createManager, manifest, validateApps, read, atomic, SERVER, TOOLS, DESKTOP_TOOLS} = require('../common/computer-use.cjs');
const {lease, filterServerMessage, allowedClientMessage} = require('../common/computer-use-bridge.cjs');
const {VERSION, downloadVerified} = require('../common/computer-use-release.cjs');
async function fixture(t, platform = 'linux') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agpa-cu-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const app = path.join(root, 'example-app'); await fs.writeFile(app, '#!/bin/sh\n', {mode: 0o700});
  const adapter = {executable: 'cua-driver', environment: async () => ({session: 'x11', environment: {}, needsHelper: false}), defaultApps: async () => [app]};
  const manager = createManager({platform, home: root, configDir: path.join(root, 'plugin'), adapter});
  await fs.mkdir(manager.paths.driverDirectory, {recursive: true});
  await fs.writeFile(manager.paths.driver, 'driver');
  await fs.writeFile(path.join(manager.paths.driverDirectory, 'receipt.json'), JSON.stringify({version: VERSION}));
  return {root, app, manager};
}
test('bounded scope excludes desktop capture, filesystem, browser grants and arbitrary code', () => {
  const value = manifest(['/usr/bin/gnome-calculator']);
  assert.equal(value.version, 3); assert.equal(value.resources.desktop.display, false);
  assert.equal(value.expires_after, '8h'); assert.equal(value.idle_timeout, '30m');
  assert.deepEqual(value.resources.apps, [{executable: '/usr/bin/gnome-calculator', launch: true, windows: 'all'}]);
  for (const tool of ['run_script', 'run_steps', 'get_desktop_state', 'computer_run_command', 'browser_prepare', 'kill_app']) assert.ok(!TOOLS.includes(tool));
});
test('connecting preserves unrelated MCP servers and root settings; stopping revokes the lease', async t => {
  const {manager, app} = await fixture(t);
  const previous = {mcpServers: {existing: {command: 'original', env: {privateSetting: 'unchanged'}}}, other: {keep: true}};
  await fs.mkdir(path.dirname(manager.paths.mcpFile), {recursive: true});
  await fs.writeFile(manager.paths.mcpFile, JSON.stringify(previous));
  let status = await manager.perform('connect', [app]);
  assert.equal(status.error, null); assert.equal(status.enabled, true);
  const data = JSON.parse(await read(manager.paths.mcpFile));
  assert.deepEqual(data.mcpServers.existing, previous.mcpServers.existing); assert.deepEqual(data.other, previous.other);
  assert.deepEqual(data.mcpServers[SERVER].enabledTools, [...TOOLS]);
  assert.equal((await lease(manager.paths.directory)).enabled, true);
  status = await manager.perform('disconnect'); assert.equal(status.enabled, false);
  assert.equal(JSON.parse(await read(manager.paths.mcpFile)).mcpServers[SERVER], undefined);
  await assert.rejects(() => lease(manager.paths.directory), /disconnected/);
  assert.deepEqual(JSON.parse(await read(manager.paths.mcpFile)).mcpServers.existing, previous.mcpServers.existing);
});
test('an unrelated entry under the plugin server name is never overwritten', async t => {
  const {manager, app} = await fixture(t);
  const text = JSON.stringify({mcpServers: {[SERVER]: {command: 'some-other-server'}}});
  await fs.mkdir(path.dirname(manager.paths.mcpFile), {recursive: true}); await fs.writeFile(manager.paths.mcpFile, text);
  const status = await manager.perform('connect', [app]);
  assert.equal(status.enabled, false); assert.equal(status.error, 'serverConflict');
  assert.equal(await read(manager.paths.mcpFile), text);
});
test('invalid JSON and symlink configs are preserved, while an empty native config is supported', async t => {
  const {manager, app, root} = await fixture(t);
  await fs.mkdir(path.dirname(manager.paths.mcpFile), {recursive: true}); await fs.writeFile(manager.paths.mcpFile, '{ broken');
  assert.equal((await manager.perform('connect', [app])).enabled, false);
  assert.equal(await read(manager.paths.mcpFile), '{ broken');
  await fs.writeFile(manager.paths.mcpFile, ''); assert.equal((await manager.perform('connect', [app])).enabled, true);
  const target = path.join(root, 'unrelated'); await fs.writeFile(target, '{}'); await fs.rm(manager.paths.mcpFile);
  await fs.symlink(target, manager.paths.mcpFile);
  assert.equal((await manager.perform('connect', [app])).enabled, false); assert.equal(await fs.readFile(target, 'utf8'), '{}');
});
test('a manifest edit invalidates existing and new bridge sessions', async t => {
  const {manager, app} = await fixture(t); await manager.perform('connect', [app]);
  await fs.appendFile(manager.paths.policyFile, ' ');
  await assert.rejects(() => lease(manager.paths.directory), /disconnected/);
});
test('application paths reject relative paths, shell text, missing files and directories', async t => {
  const {app, root} = await fixture(t);
  assert.deepEqual(await validateApps([app, app]), [app]);
  for (const value of [[], ['calculator'], [app + '\n/bin/sh'], [root], [path.join(root, 'missing')]]) await assert.rejects(() => validateApps(value));
});
test('atomic updates refuse a changed file and leave no temporary files', async t => {
  const {root} = await fixture(t); const file = path.join(root, 'configuration'); await fs.writeFile(file, 'newer');
  await assert.rejects(() => atomic(file, 'replacement', 'older'), /configChanged/);
  assert.equal(await read(file), 'newer'); assert.ok(!(await fs.readdir(root)).some(s => s.includes('agpa-lock') || s.endsWith('.tmp')));
});
test('downloads reject altered upstream archives before any extraction', async t => {
  const {root} = await fixture(t);
  await assert.rejects(() => downloadVerified(path.join(root, 'archive'), 'linux', 'x64', async () => new Response('not the official archive')), /checksum/);
  await assert.rejects(() => downloadVerified(path.join(root, 'unsupported'), 'freebsd', 'x64'), /Unsupported/);
});
test('Windows companion uses an absolute PowerShell executable and requires no external Node package', () => {
  const adapter = require('../windows/computer-use.cjs');
  assert.equal(adapter.powershell({SystemRoot: 'D:\\Windows'}), 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(adapter.executable, 'cua-driver.exe');
});
test('the bridge exposes only the reviewed tools even when a client ignores enabledTools', () => {
  const message = {id: 2, result: {tools: [{name: 'click'}, {name: 'run_script'}, {name: 'get_desktop_state'}, {name: 'list_apps'}]}};
  assert.deepEqual(filterServerMessage(message).result.tools, [{name: 'click'}]);
  assert.equal(message.result.tools.length, 4);
});
test('launch commands are exact allowed executables, never shell text, URLs or extra arguments', () => {
  const request = args => ({method: 'tools/call', params: {name: 'launch_app', arguments: args}});
  assert.equal(allowedClientMessage(request({name: '/usr/bin/gnome-calculator'}), ['/usr/bin/gnome-calculator']), true);
  for (const args of [{name: '/bin/sh'}, {name: '/usr/bin/gnome-calculator; echo bad'}, {name: '/usr/bin/gnome-calculator', additional_arguments: ['--something']}, {name: '/usr/bin/gnome-calculator', launch_path: 'anything'}]) assert.equal(allowedClientMessage(request(args), ['/usr/bin/gnome-calculator']), false);
  assert.equal(allowedClientMessage({method: 'tools/call', params: {name: 'run_script'}}), false);
});
test('locally edited owned skills are not overwritten on reconnection', async t => {
  const {manager, app} = await fixture(t); await manager.perform('connect', [app]);
  await fs.appendFile(manager.paths.skillFile, '\nMy local instructions\n');
  const previous = await read(manager.paths.skillFile);
  assert.equal((await manager.perform('connect', [app])).error, 'skillConflict');
  assert.equal(await read(manager.paths.skillFile), previous);
});
test('native MCP adapter refreshes only this server and reports an unrecognized interface safely', async () => {
  const vm = require('node:vm'); const source = await fs.readFile(path.join(__dirname, '../common/native-mcp.js'), 'utf8');
  const calls = []; const provider = {states: [{spec: {serverName: SERVER}}], isInitialized: true, refresh: async (...args) => {calls.push(args);}};
  const anchor = {'__reactFiber$fixture': {memoizedProps: {value: provider}}};
  const context = {document: {querySelector: () => anchor, querySelectorAll: () => []}}; vm.createContext(context); vm.runInContext(source, context);
  assert.equal(await context.__AGNativeMcp.refresh(), true); assert.equal(context.__AGNativeMcp.status().detected, true);
  assert.deepEqual(calls[0], [false, SERVER]);
  delete provider.refresh; assert.equal(await context.__AGNativeMcp.refresh(), false);
});
test('an open bridge exits when its lease is revoked, without a client reconnect', {timeout: 8000}, async t => {
  const {spawn} = require('node:child_process');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agpa-cu-revoke-')); t.after(() => fs.rm(root, {recursive: true, force: true}));
  const directory = path.join(root, '.config/antigravity-plugin/computer-use');
  await fs.mkdir(path.join(directory, 'driver-' + VERSION), {recursive: true});
  const policy = '{}'; const state = {version: 1, enabled: true, revision: 'one', apps: [], manifestHash: require('node:crypto').createHash('sha256').update(policy).digest('hex')};
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify(state)); await fs.writeFile(path.join(directory, 'capabilities.json'), policy);
  const driver = path.join(directory, 'driver-' + VERSION, 'cua-driver');
  await fs.writeFile(driver, '#!' + process.execPath + '\nprocess.stdin.resume();process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,result:{ready:true}})+"\\n");process.stdin.on("end",()=>process.exit(0));\n', {mode: 0o700});
  const child = spawn(process.execPath, [path.join(__dirname, '../common/computer-use-bridge.cjs')], {env: {...process.env, HOME: root, XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: '', WAYLAND_DISPLAY: ''}, stdio: ['pipe','pipe','pipe']});
  t.after(() => child.kill()); child.stderr.resume();
  const exit = new Promise(resolve => child.once('exit', resolve));
  await new Promise((resolve,reject) => {child.stdout.once('data',resolve);child.once('error',reject);});
  await fs.writeFile(path.join(directory, 'state.json'), JSON.stringify({...state, enabled: false}));
  assert.equal(await exit, 0);
});
test('entire desktop is an explicit independent scope and can switch back to selected apps', async t => {
  const {manager, app} = await fixture(t);
  const desktop = await manager.perform('connect', {scope: 'desktop', apps: []});
  assert.equal(desktop.enabled, true);assert.equal(desktop.scope, 'desktop');assert.deepEqual(desktop.apps, []);
  assert.deepEqual(JSON.parse(await read(manager.paths.mcpFile)).mcpServers[SERVER].enabledTools, [...DESKTOP_TOOLS]);
  assert.equal((await lease(manager.paths.directory)).scope, 'desktop');
  const scoped = await manager.perform('connect', {scope: 'apps', apps: [app]});
  assert.equal(scoped.scope, 'apps');assert.deepEqual(scoped.apps, [app]);
  assert.equal(JSON.parse(await read(manager.paths.policyFile)).resources.desktop.display, false);
});
test('desktop tools are exposed only for entire-desktop sessions while code and file tools remain excluded', () => {
  const message = {result: {tools: [{name: 'get_desktop_state'}, {name: 'list_apps'}, {name: 'click'}, {name: 'run_script'}, {name: 'file_read'}]}};
  assert.deepEqual(filterServerMessage(message, 'desktop').result.tools.map(t => t.name), ['get_desktop_state','list_apps','click']);
  assert.deepEqual(filterServerMessage(message, 'apps').result.tools.map(t => t.name), ['click']);
  assert.equal(allowedClientMessage({method:'tools/call',params:{name:'get_desktop_state'}}, [], 'linux', 'desktop'), true);
  assert.equal(allowedClientMessage({method:'tools/call',params:{name:'get_desktop_state'}}, [], 'linux', 'apps'), false);
});
test('Stop cancels setup during download and cannot connect afterwards', async t => {
  const {manager: existing, root} = await fixture(t);
  await fs.rm(existing.paths.driverDirectory, {recursive:true});
  let fetching;
  const started = new Promise(resolve => {fetching = resolve;});
  const adapter = {executable:'cua-driver',environment:async()=>({session:'x11'}),defaultApps:async()=>[],extract:async()=>{throw Error('must not extract');}};
  const manager = createManager({home:root,configDir:path.join(root,'plugin'),adapter,fetcher:async(url,{signal})=>{
    fetching();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
  }});
  await manager.perform('setup',{scope:'desktop',apps:[]});await started;
  await manager.perform('disconnect');
  for(let i=0;i<20&&(await manager.status()).operation;i++)await new Promise(r=>setTimeout(r,10));
  const status=await manager.status();assert.equal(status.enabled,false);assert.equal(status.operation,null);assert.equal(status.error,null);
  assert.equal(JSON.parse(await read(manager.paths.mcpFile)).mcpServers[SERVER],undefined);
});
