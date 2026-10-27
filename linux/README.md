# 🐧 Linux installation and desktop integration

For quick setup, see the [README](../README.md). Shared settings and sessions are covered in the [configuration guide](../docs/CONFIGURATION.md).

## Tested Linux setup

- Antigravity App **2.27.0**, official Linux x86-64 AppImage.
- Zorin OS with **GNOME Shell 46**, Wayland, Zorin taskbar, and Zorin AppIndicator.
- Node.js **22+**, with built-in `fetch` and `WebSocket`.
- Python 3 with PyGObject/Gio, a user systemd session, `update-desktop-database`, and `gtk-update-icon-cache`.

The integration uses the app's existing local debugging endpoint. Other app versions, packaging formats, desktop environments, and future Google UI changes may require adjustments. Tray customization is detected at runtime and is optional; it is not claimed to work on every Linux tray implementation.

## Install on Linux

Install the latest official Antigravity AppImage first. The tested compatibility baseline is 2.27.0.

Linux discovery first reads valid Antigravity `.desktop` entries in the XDG user and system applications directories. It accepts executable AppImages with the AppImage header, including quoted paths and launcher arguments. System launchers are represented by a user override; system files are not edited.

If there is no matching launcher, discovery checks common AppImage locations (`~/.local/opt`, `~/.local/bin`, `~/Applications`, `~/AppImages`, and the configured download folder). A unique image gets a user launcher when desktop integration is applied. Multiple distinct images are not resolved by guessing a version.

To choose an installation explicitly, run `systemctl --user edit antigravity-project-appearance.service` and add:

```ini
[Service]
Environment="AGPA_APPIMAGE=/absolute/path/Antigravity.AppImage"
Environment="AGPA_DESKTOP_FILE=/absolute/path/antigravity.desktop"
```

The launcher must point directly to that AppImage; quoted paths and arguments are preserved. After saving, restart the helper with `systemctl --user restart antigravity-project-appearance.service`. Explicit invalid selections are reported rather than replaced with another app. Missing/ambiguous desktop detection leaves the other plugin controls available.

```bash
gh repo clone Riccardo-Vecchi/antigravity-plugin
cd antigravity-plugin
./linux/install.sh
```

The installer uses the current `node` executable and creates a user service. No root privileges or npm dependencies are required. Keep the selected Node.js runtime available.

```bash
systemctl --user status antigravity-project-appearance.service
journalctl --user -u antigravity-project-appearance.service -n 30 --no-pager
```

Open Antigravity normally. The helper waits when the app is closed and reapplies the UI additions to new windows.

## How the Linux live icons work

The launcher keeps its application identity and uses a stable icon file. Compatibility paths and the existing Antigravity icons in the user's hicolor theme are updated as needed. Original images are retained for restoration; Gemini's source assets are separate from the mutable display files.

GNOME can retain an old icon even after files change. To invalidate that cache, the helper briefly selects an empty internal theme inheriting the current icon theme, then restores the original preference. Its recovery record also handles an interrupted refresh, and a concurrent theme change by the user is respected. No shell restart is needed.

Tray support uses the existing Zorin/GNOME AppIndicator `custom-icons` setting for Antigravity's indicator ID. It preserves other indicators and records the previous Antigravity override. It does not replace the native tray process or its menu.

## Linux files and data

```text
~/.local/share/antigravity-project-appearance/       installed code and icon assets
~/.config/antigravity-project-appearance/projects.json
~/.config/antigravity-project-appearance/app.json
~/.config/antigravity-project-appearance/session.json  last view only
~/.config/antigravity-project-appearance/icon-originals/
~/.config/antigravity-project-appearance/asset-originals/
~/.config/antigravity-project-appearance/tray-settings-original.json
~/.config/systemd/user/antigravity-project-appearance.service
~/.config/autostart/antigravity-linux-customizations.desktop  only while enabled
~/.config/Antigravity/Partitions/agpa-gemini/         Chromium-managed Gemini session
```

Project files, conversation databases, and the official AppImage are not patched. The icon selection updates the local launcher and icon assets; autostart updates only this project's marked startup entry.

Preferences and icon backups are local and excluded from this repository. Do not delete the original-icon backups if you want exact restoration.

## Update, disable, restore on Linux

After updating the source:

```bash
./linux/install.sh
```

The installer preserves already-open Antigravity/Gemini documents while restarting the helper. If an app update changes its DOM, preload APIs, debugging endpoint, or packaging, the integration may need an updated patch.

To remove the active integration and restore original desktop/tray icons:

```bash
./linux/disable.sh
```

This disables the helper and this project's desktop autostart entry. Code, preferences, icon backups, and Google's persistent web session remain on disk for later use. Disabling removes the embedded view, so save or send any Gemini draft before doing so.

## 🖱️ Computer use

Open **Settings → Computer use** for optional Cua Driver installation, entire-desktop or selected-application access, MCP checks and disconnection. See the [computer-use guide](../docs/COMPUTER_USE.md) for setup, OS permissions and validation limits.
