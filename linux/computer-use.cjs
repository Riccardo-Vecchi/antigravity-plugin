'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
function helperStatus(installed, output = '', failure = '') {
  if (!installed) return 'missing';
  const state = /^\s*State:\s*([^\r\n]+)/mi.exec(output)?.[1]?.trim().toUpperCase().replace(/\s+/g, '_');
  if (['ACTIVE', 'ENABLED'].includes(state)) return 'active';
  if (state === 'DISABLED') return 'disabled';
  if (['ERROR', 'OUT_OF_DATE', 'OUT-OF-DATE'].includes(state)) return 'error';
  if (/doesn.t exist|not found|unknown extension/i.test(failure + output)) return 'signInRequired';
  return 'unknown';
}

async function extract(archive, target) {
  // Read exact, reviewed regular members; never extract archive paths or links.
  const members = ['cua-driver', 'cua-cursor-theme', 'wayland-helper/install.sh',
    'wayland-helper/README.md', 'wayland-helper/winrects@cua/metadata.json',
    'wayland-helper/winrects@cua/extension.js'];
  for (const member of members) {
    const {stdout} = await run('/usr/bin/tar', ['-xOzf', archive, '--', member], {encoding: 'buffer', maxBuffer: 180 * 1024 * 1024, timeout: 45000});
    const destination = path.join(target, member);
    await fs.mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
    await fs.writeFile(destination, stdout, {mode: member.endsWith('cua-driver') || member.endsWith('cua-cursor-theme') || member.endsWith('.sh') ? 0o700 : 0o600});
  }
}
async function environment(env = process.env) {
  const wayland = env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY;
  const gnome = /gnome|zorin/i.test(env.XDG_CURRENT_DESKTOP || '');
  let helperReady = !wayland || !gnome;
  let helperInstalled = false;
  let helperState = 'notRequired';
  if (wayland && gnome) {
    try {
      const directory = path.join(env.XDG_DATA_HOME || path.join(require('node:os').homedir(), '.local/share'), 'gnome-shell/extensions/winrects@cua');
      await fs.access(path.join(directory, 'metadata.json'));await fs.access(path.join(directory, 'extension.js'));helperInstalled = true;
    } catch {}
  }
  if (wayland && gnome) {
    try {
      const {stdout} = await run('/usr/bin/gnome-extensions', ['info', 'winrects@cua'], {env: {...env, LC_ALL: 'C'}, timeout: 4000});
      helperState = helperStatus(helperInstalled, stdout);
    } catch (error) { helperState = helperStatus(helperInstalled, '', error.stderr || ''); }
    helperReady = helperState === 'active';
  }
  return {platform: 'linux', session: wayland ? 'wayland' : env.DISPLAY ? 'x11' : 'unknown', needsHelper: wayland && gnome && !helperReady, helperInstalled, helperState,
    environment: wayland ? {CUA_DRIVER_RS_ENABLE_WAYLAND: '1'} : {}, experimental: false};
}
async function defaultApps() {
  for (const file of ['/usr/bin/gnome-calculator', '/usr/bin/kcalc']) {
    try { await fs.access(file, 1); return [await fs.realpath(file)]; } catch {}
  }
  return [];
}
async function applications() {
  const choices = [];
  for (const [name, file] of [['Calculator', '/usr/bin/gnome-calculator'], ['KCalc', '/usr/bin/kcalc'],
    ['Text Editor', '/usr/bin/gnome-text-editor'], ['Gedit', '/usr/bin/gedit'],
    ['Inkscape', '/usr/bin/inkscape'], ['LibreOffice', '/usr/lib/libreoffice/program/soffice.bin']]) {
    try { await fs.access(file, 1); choices.push({name, executable: await fs.realpath(file)}); } catch {}
  }
  return choices;
}
async function setupHelper(driverDirectory) {
  await run('/bin/bash', [path.join(driverDirectory, 'wayland-helper/install.sh')], {timeout: 15000, maxBuffer: 16000});
}
module.exports = {extract, environment, defaultApps, applications, setupHelper, helperStatus, executable: 'cua-driver'};
