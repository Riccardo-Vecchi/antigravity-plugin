# Antigravity Plugin on macOS

## Install

1. Install the official [Antigravity app for macOS](https://antigravity.google/download) (placed in `/Applications/Antigravity.app` or `~/Applications/Antigravity.app`).
2. Clone or download this repository and run:

```bash
./macos/install.sh --launch
```

The installer uses Node.js 22+ if installed, or Antigravity's bundled runtime (`ELECTRON_RUN_AS_NODE=1`).

Subsequent launches: open **Antigravity (customized)** from `~/Applications` or Spotlight so remote debugging and Dock/menu bar icon synchronization are enabled.

If the official app is installed in a custom location, set `AGPA_APP_BUNDLE=/path/to/Antigravity.app` (or `AGPA_APP_EXE`) before running `./macos/install.sh`.

## Notes

- **Dock and menu bar icons:** Launching via **Antigravity (customized)** enables `app.dock.setIcon` and the native menu bar tray icon to follow **Settings → Appearance → Application icon** (Antigravity, Gemini, or Dynamic).
- **Computer use:** Uses upstream `cua-driver` (`0.58.1`) for macOS (`darwin-arm64` / `darwin-x86_64`). Grant **Accessibility** and **Screen Recording** permissions in **System Settings → Privacy & Security** when prompted.
- **External browser:** Detects Brave, Chrome, Edge, Vivaldi, Opera, and Chromium in `/Applications` and `~/Applications`. Copy the `chrome://inspect/#remote-debugging` (or browser-specific) address shown in **Settings → Browser → External browser** into your browser's address bar, enable remote debugging, then click **Connect browser**.
- **Disable / uninstall helper:** Run `./macos/disable.sh` to stop the background LaunchAgent, restore default Dock/tray icons, and remove `Antigravity (customized).app` while keeping your preferences and Gemini sessions.
