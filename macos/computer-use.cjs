'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function extract(archive, target, { runCommand = run } = {}) {
  const { stdout: listing } = await runCommand(
    '/usr/bin/tar',
    ['-tzf', archive],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 },
  );
  const entries = listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const name of entries) {
    if (name.startsWith('/') || name.includes('\0') || name.split('/').includes('..'))
      throw Error('Invalid driver archive entry.');
  }
  const wanted = ['cua-driver', 'cua-cursor-theme'];
  for (const baseName of wanted) {
    const member = entries.find((entry) => {
      const normalized = entry.startsWith('./') ? entry.slice(2) : entry;
      return (
        normalized === baseName ||
        (/^cua-driver-rs-[^/]+\/$/.test(normalized.slice(0, normalized.indexOf('/') + 1)) &&
          normalized.slice(normalized.indexOf('/') + 1) === baseName)
      );
    });
    if (!member) {
      if (baseName === 'cua-cursor-theme') continue;
      throw Error('Missing driver executable in archive.');
    }
    const { stdout } = await runCommand(
      '/usr/bin/tar',
      ['-xOzf', archive, '--', member],
      { encoding: 'buffer', maxBuffer: 180 * 1024 * 1024, timeout: 45000 },
    );
    if (!stdout?.length) throw Error('Missing driver executable in archive.');
    const destination = path.join(target, baseName);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.writeFile(destination, stdout, { mode: 0o700 });
  }
}

async function environment() {
  return {
    platform: 'darwin',
    session: 'macos',
    needsHelper: false,
    helperInstalled: false,
    helperState: 'notRequired',
    environment: {},
    experimental: false,
  };
}

const KNOWN_APPS = [
  ['Calculator', '/System/Applications/Calculator.app/Contents/MacOS/Calculator'],
  ['TextEdit', '/System/Applications/TextEdit.app/Contents/MacOS/TextEdit'],
  ['Notes', '/System/Applications/Notes.app/Contents/MacOS/Notes'],
  ['Preview', '/System/Applications/Preview.app/Contents/MacOS/Preview'],
  ['Inkscape', '/Applications/Inkscape.app/Contents/MacOS/inkscape'],
  ['LibreOffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'],
];

async function defaultApps() {
  for (const file of [
    '/System/Applications/Calculator.app/Contents/MacOS/Calculator',
    '/System/Applications/TextEdit.app/Contents/MacOS/TextEdit',
  ]) {
    try {
      await fs.access(file, 1);
      return [await fs.realpath(file)];
    } catch {}
  }
  return [];
}

async function applications() {
  const choices = [];
  for (const [name, file] of KNOWN_APPS) {
    try {
      await fs.access(file, 1);
      choices.push({ name, executable: await fs.realpath(file) });
    } catch {}
  }
  return choices;
}

module.exports = {
  extract,
  environment,
  defaultApps,
  applications,
  executable: 'cua-driver',
};
