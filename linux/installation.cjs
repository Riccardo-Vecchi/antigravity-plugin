'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
function failure(code) { return Object.assign(Error(`Antigravity AppImage discovery: ${code}. Set AGPA_APPIMAGE and AGPA_DESKTOP_FILE to select an installation.`), {code: `AGPA_${code.toUpperCase()}`}); }
function parseDesktop(text) {
  const data = {}; let active = false, seen = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*\]$/.test(line)) { active = line === '[Desktop Entry]'; if (active && seen) return null; if (active) seen = true; continue; }
    if (active) { const m = /^(Type|Name|Exec|Icon|Hidden)=(.*)$/.exec(line); if (m) { if (Object.hasOwn(data, m[1])) return null; data[m[1]] = m[2]; } }
  }
  if (data.Type !== 'Application' || data.Hidden === 'true' || !data.Exec) return null;
  const match = /^(?:"((?:\\.|[^"\\])*)"|([^\s"]+))(?:\s|$)/.exec(data.Exec);
  if (!match) return null;
  const executable = (match[1] ?? match[2]).replace(/\\([\\"`$ ])/g, '$1').replace(/%%/g, '%');
  if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable) || /%[A-Za-z]/.test(executable)) return null;
  return {...data, executable};
}
async function appImage(file) {
  let handle;
  try {
    if (!path.isAbsolute(file)) return null;
    const stat = await fs.stat(file);
    if (!stat.isFile() || !(stat.mode & 0o111)) return null;
    handle = await fs.open(file, 'r'); const bytes = Buffer.alloc(11);
    await handle.read(bytes, 0, 11, 0);
    if (!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes[8] !== 65 || bytes[9] !== 73 || ![1, 2].includes(bytes[10])) return null;
    return {executable: file, real: await fs.realpath(file)};
  } catch { return null; } finally { await handle?.close(); }
}
async function readDesktop(file) {
  try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.size > 131072) return null;
    const text = await fs.readFile(file, 'utf8'), entry = parseDesktop(text);
    if (!entry || !/antigravity/i.test((entry.Name || '') + ' ' + path.basename(entry.executable))) return null;
    const image = await appImage(entry.executable); return image ? {...image, text, entry, source: file} : null;
  } catch { return null; }
}
async function names(directory, pattern) {
  try { return (await fs.readdir(directory)).filter(n => pattern.test(n)).sort().slice(0, 2048).map(n => path.join(directory, n)); } catch { return []; }
}
async function discover({home = os.homedir(), env = process.env} = {}) {
  const userApps = path.join(env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local/share'), 'applications');
  const selected = env.AGPA_APPIMAGE ? await appImage(env.AGPA_APPIMAGE) : null;
  if (env.AGPA_APPIMAGE && !selected) throw failure('invalid_appimage');
  if (env.AGPA_DESKTOP_FILE) {
    if (!path.isAbsolute(env.AGPA_DESKTOP_FILE)) throw failure('invalid_launcher');
    const entry = await readDesktop(env.AGPA_DESKTOP_FILE);
    if (!entry || (selected && selected.real !== entry.real)) throw failure('invalid_launcher');
    return {...entry, desktopFile: env.AGPA_DESKTOP_FILE, generated: false};
  }
  const directories = [userApps, ...(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(p => path.isAbsolute(p)).map(p => path.join(p, 'applications'))];
  const entries = [];
  for (const directory of [...new Set(directories)]) {
    for (const file of await names(directory, /\.desktop$/i)) {
      const entry = await readDesktop(file);
      if (entry && (!selected || entry.real === selected.real)) {
        const target = path.join(userApps, path.basename(file));
        // A user override shadows a system entry, even when it points elsewhere.
        if (directory !== userApps && await fs.lstat(target).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) continue;
        entries.push({...entry, desktopFile: target, generated: directory !== userApps});
      }
    }
  }
  const byImage = new Map(); for (const entry of entries) if (!byImage.has(entry.real)) byImage.set(entry.real, entry);
  if (byImage.size > 1) throw failure('ambiguous');
  if (byImage.size === 1) return byImage.values().next().value;
  const images = new Map(); if (selected) images.set(selected.real, selected);
  if (!selected) {
    let downloads = env.XDG_DOWNLOAD_DIR || path.join(home, 'Downloads');
    try { const text = await fs.readFile(path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'user-dirs.dirs'), 'utf8');
      const value = /^XDG_DOWNLOAD_DIR="([^"\n]+)"/m.exec(text)?.[1];
      if (value?.startsWith('$HOME/')) downloads = path.join(home, value.slice(6)); else if (value && path.isAbsolute(value)) downloads = value;
    } catch {}
    for (const directory of new Set([path.join(home, '.local/opt'), path.join(home, '.local/bin'), path.join(home, 'Applications'), path.join(home, 'AppImages'), downloads])) {
      for (const file of await names(directory, /antigravity.*\.appimage$/i)) { const image = await appImage(file); if (image) images.set(image.real, image); }
    }
  }
  if (images.size > 1) throw failure('ambiguous');
  if (!images.size) throw failure('missing');
  const image = images.values().next().value;
  const desktopFile = path.join(userApps, 'antigravity-appimage.desktop');
  if (await fs.lstat(desktopFile).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw failure('conflicting_launcher');
  const quoted = '"' + image.executable.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&') + '"';
  const text = `[Desktop Entry]\nType=Application\nName=Antigravity\nExec=${quoted}\nIcon=antigravity\nTerminal=false\nStartupWMClass=Antigravity\n`;
  return {...image, text, entry: parseDesktop(text), desktopFile, generated: true};
}
module.exports = {discover, parseDesktop, appImage};
