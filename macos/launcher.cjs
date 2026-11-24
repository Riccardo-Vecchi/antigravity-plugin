'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const paths = require('../common/platform-paths.cjs').getPaths();
const { discover } = require('./installation.cjs');
const { attachNative } = require('./native-attach.cjs');
const { nativePageTarget } = require('../common/cdp-connection.cjs');

function socketPath() {
  const local = path.join(paths.configDir, 'launcher.sock');
  if (Buffer.byteLength(local) < 100) return local;
  const name =
    'agpa-l-' +
    crypto.createHash('sha256').update(paths.configDir).digest('hex').slice(0, 16) +
    '.sock';
  return path.join('/tmp', name);
}

const sock = socketPath();

let daemon = null,
  daemonExit = null,
  launching = null,
  server = null,
  stopping = false;

async function installation() {
  const file = path.join(paths.configDir, 'installation.json');
  try {
    const stat = await fsp.stat(file);
    if (stat.size <= 4096) {
      const data = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (
        data.version === 1 &&
        typeof data.appExe === 'string' &&
        path.isAbsolute(data.appExe) &&
        path.basename(data.appExe) === 'Antigravity'
      ) {
        await fsp.access(data.appExe);
        return data;
      }
    }
  } catch {}
  const found = await discover();
  return {
    version: 1,
    appBundle: found.bundle,
    appExe: found.executable,
    nativeIconsSupported: true,
  };
}

function log(message) {
  try {
    fs.mkdirSync(paths.configDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      path.join(paths.configDir, 'launcher.log'),
      new Date().toISOString() + ' ' + message + '\n',
    );
  } catch {}
}

async function appRunning() {
  try {
    const value = (
      await fsp.readFile(path.join(paths.profileDir, 'DevToolsActivePort'), 'utf8')
    ).split('\n')[0];
    if (!/^\d{2,5}$/.test(value) || Number(value) > 65535) return false;
    const targets = await fetch('http://127.0.0.1:' + value + '/json/list', {
      signal: AbortSignal.timeout(1200),
    }).then((r) => r.json());
    return targets.some((t) => nativePageTarget(t, value));
  } catch {
    return false;
  }
}

function cleanEnvironment() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.NODE_INSPECT_RESUME_ON_START;
  return env;
}

async function launch() {
  if (launching) return launching;
  launching = (async () => {
    const data = await installation();
    if (await appRunning()) {
      const target = data.appBundle || data.appExe;
      const opener = spawn('/usr/bin/open', ['-a', target], {
        env: cleanEnvironment(),
        detached: true,
        stdio: 'ignore',
      });
      opener.on('error', (error) => log('Application focus failed: ' + error.code));
      opener.unref();
      log('Focused existing Antigravity; no process was restarted.');
      return;
    }
    const args = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'];
    if (data.nativeIconsSupported !== false) args.push('--inspect=127.0.0.1:0');
    const child = spawn(data.appExe, args, {
      env: cleanEnvironment(),
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    });
    child.unref();
    child.stderr.unref();
    let attached = false,
      buffer = '';
    child.on('error', (error) => log('Application launch failed: ' + error.code));
    child.stderr.on('data', async (chunk) => {
      buffer = (buffer + chunk.toString()).slice(-12000);
      const match = buffer.match(
        /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/,
      );
      if (!match || attached) return;
      attached = true;
      try {
        await attachNative(match[1], paths);
        log('Native icon controller attached; inspector cleanup scheduled.');
      } catch (error) {
        log('Native icon setup unavailable: ' + error.message);
      }
    });
    child.stderr.on('error', () => {});
    await new Promise((resolve) => {
      child.once('spawn', resolve);
      child.once('error', resolve);
    });
  })().finally(() => {
    launching = null;
  });
  return launching;
}

async function startDaemon() {
  if (stopping) return;
  await fsp.mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  const output = fs.openSync(path.join(paths.configDir, 'helper.log'), 'a');
  const runtime = process.execPath;
  const child = spawn(runtime, [path.join(__dirname, '..', 'common', 'daemon.cjs')], {
    cwd: __dirname,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', output, output],
  });
  fs.closeSync(output);
  daemon = child;
  daemonExit = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (daemon === child) {
        daemon = null;
        daemonExit = null;
      }
      resolve();
    };
    child.on('error', (error) => {
      log('Daemon spawn failed: ' + error.code);
      finish();
    });
    child.on('exit', () => {
      finish();
      if (server && !stopping)
        setTimeout(() => startDaemon().catch((e) => log(e.message)), 3000).unref();
    });
  });
}

async function stopDaemon() {
  stopping = true;
  const child = daemon;
  const exitPromise = daemonExit;
  if (!child || !exitPromise) return;
  try {
    child.kill('SIGTERM');
  } catch {}
  let timer;
  const timedOut = await Promise.race([
    exitPromise.then(() => false),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), 4000);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    try {
      child.kill('SIGKILL');
    } catch {}
    await Promise.race([
      exitPromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}

function send(command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sock);
    const timer = setTimeout(() => {
      socket.destroy(Error('Launcher timed out.'));
    }, 6000);
    socket.resume();
    socket.once('connect', () => socket.end(command));
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function cleanup() {
  try {
    await fsp.unlink(sock);
  } catch {}
}

async function main() {
  if (process.platform !== 'darwin') throw Error('This launcher is for macOS.');
  const command = process.argv.includes('--stop')
    ? 'stop'
    : process.argv.includes('--launch')
      ? 'launch'
      : 'watch';
  try {
    await send(command);
    return;
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
    if (command !== 'launch') await cleanup();
  }
  if (command === 'stop') return;
  if (command === 'launch') {
    let startedWatch = false;
    const startMs = Date.now();
    const deadline = startMs + 8000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await send('launch');
        return;
      } catch (err) {
        if (!['ENOENT', 'ECONNREFUSED'].includes(err.code)) throw err;
        if (!startedWatch && Date.now() - startMs >= 400) {
          startedWatch = true;
          const watcher = spawn(process.execPath, [__filename, '--watch'], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            detached: true,
            stdio: 'ignore',
          });
          await new Promise((resolve, reject) => {
            watcher.once('spawn', resolve);
            watcher.once('error', reject);
          });
          watcher.unref();
        }
      }
    }
    throw Error('Launcher timed out waiting for background watcher.');
  }
  await fsp.mkdir(path.dirname(sock), { recursive: true, mode: 0o700 });
  await fsp.mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 32) socket.destroy();
    });
    socket.on('error', () => {});
    socket.on('end', async () => {
      if (data === 'launch') {
        launch().catch((e) => log(e.message));
        socket.end('ok\n');
        return;
      }
      if (data === 'stop') {
        const s = server;
        server = null;
        s?.close();
        await stopDaemon();
        await cleanup();
        socket.end('ok\n');
        return;
      }
      socket.end();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(sock, resolve);
    });
    await fsp.chmod(sock, 0o600).catch(() => {});
  } catch (error) {
    server = null;
    if (error.code !== 'EADDRINUSE') throw error;
    await send(command);
    return;
  }
  const shutdown = () => {
    const s = server;
    server = null;
    s?.close();
    stopDaemon()
      .catch(() => {})
      .finally(() => cleanup().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await startDaemon();
  if (command === 'launch') await launch();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
