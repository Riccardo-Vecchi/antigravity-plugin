'use strict';
// Executed once in the app's native Electron process, with the existing Tray as `this`.
// The inspector is closed after setup. Remote webpages receive no API or credentials.
function installNativeController(options) {
  const load = process.mainModule.require.bind(process.mainModule);
  const fs = load('node:fs'),
    path = load('node:path');
  const { app, nativeImage } = load('electron');
  const tray = this && typeof this.setImage === 'function' ? this : null;
  globalThis.__AGPAMacOSNativeIcons__?.destroy();
  const original = nativeImage.createFromPath(
    path.join(process.resourcesPath, 'app.asar', 'icon.png'),
  );
  const gemini = nativeImage.createFromPath(options.geminiPng);
  const originalTray = nativeImage.createFromPath(
    path.join(process.resourcesPath, 'app.asar', 'trayTemplate.png'),
  );
  if (!originalTray.isEmpty()) originalTray.setTemplateImage(true);
  const geminiTrayRaw = nativeImage.createFromPath(options.geminiTrayPng || options.geminiPng);
  let geminiTray = geminiTrayRaw;
  if (!geminiTrayRaw.isEmpty()) {
    const oneX = geminiTrayRaw.resize({ width: 18, height: 18 });
    if (typeof nativeImage.createEmpty === 'function' && typeof oneX?.toPNG === 'function') {
      const twoX = geminiTrayRaw.resize({ width: 36, height: 36 });
      const multi = nativeImage.createEmpty();
      if (typeof multi?.addRepresentation === 'function') {
        multi.addRepresentation({ scaleFactor: 1.0, width: 18, height: 18, buffer: oneX.toPNG() });
        if (typeof twoX?.toPNG === 'function')
          multi.addRepresentation({ scaleFactor: 2.0, width: 36, height: 36, buffer: twoX.toPNG() });
        geminiTray = multi;
      } else {
        geminiTray = oneX;
      }
    } else {
      geminiTray = oneX;
    }
  }
  if (original.isEmpty() || gemini.isEmpty())
    throw Error('Application icons are unavailable.');
  let stopped = false,
    choice = 'antigravity',
    restore = false,
    inspectorClosed = false,
    lastError = null;
  function receipt() {
    const value = {
      version: 1,
      pid: process.pid,
      active: !stopped && !lastError,
      choice,
      tray: !!tray && !tray.isDestroyed(),
      nonce: options.nonce,
      inspectorPort: options.inspectorPort,
      updatedAt: Date.now(),
      inspectorClosed,
    };
    const temp = options.statusFile + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(value));
      fs.renameSync(temp, options.statusFile);
    } catch {
      try {
        fs.unlinkSync(temp);
      } catch {}
    }
    return value;
  }
  function setDock(next) {
    if (app.dock && typeof app.dock.setIcon === 'function')
      app.dock.setIcon(next === 'gemini' ? gemini : original);
  }
  function apply() {
    if (stopped) return;
    try {
      if (fs.statSync(options.requestFile).size > 2048) return;
      const data = JSON.parse(fs.readFileSync(options.requestFile, 'utf8'));
      if (data.version !== 1 || !['antigravity', 'gemini'].includes(data.choice))
        return;
      choice = data.choice;
      restore = data.restore === true;
      setDock(choice);
      if (tray && !tray.isDestroyed()) {
        const nextTray = choice === 'gemini' ? geminiTray : originalTray;
        if (nextTray && !nextTray.isEmpty()) tray.setImage(nextTray);
      }
      lastError = null;
      receipt();
      if (restore) controller.destroy();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        lastError = 'native-icon-update-failed';
        receipt();
      }
    }
  }
  const heartbeat = setInterval(receipt, 5000);
  heartbeat.unref();
  const controller = (globalThis.__AGPAMacOSNativeIcons__ = {
    destroy() {
      stopped = true;
      clearInterval(heartbeat);
      fs.unwatchFile(options.requestFile, apply);
      setDock('antigravity');
      if (tray && !tray.isDestroyed() && !originalTray.isEmpty())
        tray.setImage(originalTray);
      receipt();
      delete globalThis.__AGPAMacOSNativeIcons__;
    },
    markInspectorClosed() {
      inspectorClosed = true;
      receipt();
    },
  });
  fs.watchFile(options.requestFile, { interval: 400, persistent: false }, apply);
  apply();
  return receipt();
}
module.exports = { installNativeController };
